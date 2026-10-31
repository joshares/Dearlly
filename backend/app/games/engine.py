"""The rules of a game, with no network or storage: a state and the moves players make.

The server keeps the state (in Redis while live) and is the only one that changes it, so nobody can
cheat, and a phone only ever sees its own view (`view`): the current question, its own answer, and
the other player's answer only once both have answered (or the host moves on).
"""

import random
import time
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, Field

from app.games.bank import Bank, GameFormat, Intensity, Question
from app.services.experiences import ExperienceError, clean_text

MIX = "mix"
TEXT_MAX = 200
LANGUAGE_NAMES = {
    "words": "Words of affirmation",
    "time": "Quality time",
    "gifts": "Receiving gifts",
    "acts": "Acts of service",
    "touch": "Physical touch",
}


class MoveError(ValueError):
    """A move that isn't allowed right now (shown to that player only)."""


class Player(BaseModel):
    id: str
    name: str
    ready: bool = False
    skips_left: int = 0


class Round(BaseModel):
    number: int
    format: str
    key: str | None = None  # None while a truth-or-dare turn hasn't picked yet
    # How well do you know me: who answers about themselves. Truth or dare: whose turn it is.
    subject: str | None = None
    choice: Literal["truth", "dare"] | None = None
    answers: dict[str, int | str] = Field(default_factory=dict)
    revealed: bool = False
    skipped: bool = False
    deadline: float | None = None


class GameState(BaseModel):
    version: int = 0
    status: Literal["lobby", "playing", "ended"] = "lobby"
    format: str
    intensity: Intensity
    total: int
    host: str
    players: dict[str, Player] = Field(default_factory=dict)
    round: Round | None = None
    history: list[Round] = Field(default_factory=list)
    used: list[str] = Field(default_factory=list)  # questions dealt in this game
    seed: str = ""  # varies the order of games in a Mix


# Picks a question: (format, kind for truth or dare, wanted depth, keys to avoid) -> question.
Picker = Callable[[str, str | None, int, set[str]], Question | None]


def target_depth(number: int, total: int) -> int:
    """Rounds build from a light warm-up to the deepest questions, then cool down."""
    if total <= 1:
        return 1
    place = (number - 1) / (total - 1)
    depth = 1 + 4 * place / 0.75 if place <= 0.75 else 5 - 2 * (place - 0.75) / 0.25
    return max(1, min(5, round(depth)))


class Game:
    """Moves on a game's state. Every successful move bumps `version`."""

    def __init__(self, state: GameState, bank: Bank, pick: Picker, now: float | None = None):
        self.state = state
        self.bank = bank
        self.picker = pick
        self.now = time.time() if now is None else now

    # --- helpers -----------------------------------------------------------------------------

    def _format(self, key: str) -> GameFormat:
        return self.bank.formats[key]

    def _other(self, player_id: str) -> str | None:
        return next((p for p in self.state.players if p != player_id), None)

    def _changed(self) -> None:
        self.state.version += 1

    def _player(self, player_id: str) -> Player:
        player = self.state.players.get(player_id)
        if player is None:
            raise MoveError("You're not in this game.")
        return player

    def _round_format(self, number: int) -> str:
        if self.state.format != MIX:
            return self.state.format
        mix = sorted(k for k, f in self.bank.formats.items() if f.in_mix)
        # A steady shuffle per game: every format comes round before any repeats.
        # (Not security-related, so the standard generator is fine.)
        order = random.Random(self.state.seed).sample(mix, len(mix))  # noqa: S311
        return order[(number - 1) % len(order)]

    def _subject(self, number: int) -> str:
        """Alternates between the players: the host goes first."""
        ids = [self.state.host] + [p for p in self.state.players if p != self.state.host]
        return ids[(number - 1) % len(ids)]

    def _deal(self, number: int) -> None:
        fmt = self._format(self._round_format(number))
        round_ = Round(number=number, format=fmt.key)
        if fmt.scoring == "guess" or fmt.answer == "truth_dare":
            round_.subject = self._subject(number)
        if fmt.answer != "truth_dare":  # truth or dare waits for the pick
            self._fill(round_, kind=None)
        self.state.round = round_

    def _fill(self, round_: Round, kind: str | None) -> None:
        question = self.picker(
            round_.format, kind, target_depth(round_.number, self.state.total), set(self.state.used)
        )
        if question is None:
            raise MoveError("We ran out of questions for this game. Try another level or game.")
        round_.key = question.key
        self.state.used.append(question.key)
        seconds = self._format(round_.format).seconds
        round_.deadline = self.now + seconds if seconds else None

    def _required(self, round_: Round) -> list[str]:
        if self._format(round_.format).answer == "truth_dare":
            return [round_.subject] if round_.subject else []
        return list(self.state.players)

    def _maybe_reveal(self) -> None:
        round_ = self.state.round
        if (
            round_
            and not round_.revealed
            and all(p in round_.answers for p in self._required(round_))
        ):
            round_.revealed = True

    def _finish_round(self) -> None:
        if self.state.round is not None:
            self.state.history.append(self.state.round)
            self.state.round = None

    # --- moves -------------------------------------------------------------------------------

    def join(self, player_id: str, name: str) -> None:
        if player_id in self.state.players:
            return
        if len(self.state.players) >= 2:
            raise MoveError("This game already has two players.")
        skips = 0 if self.state.format == MIX else self._format(self.state.format).skips
        self.state.players[player_id] = Player(id=player_id, name=name, skips_left=skips)
        self._changed()

    def ready(self, player_id: str) -> None:
        self._player(player_id).ready = True
        everyone = len(self.state.players) == 2 and all(
            p.ready for p in self.state.players.values()
        )
        if self.state.status == "lobby" and everyone:
            self.state.status = "playing"
            self._deal(1)
        self._changed()

    def answer(self, player_id: str, value: object) -> None:
        self._player(player_id)
        round_ = self._live_round()
        if player_id not in self._required(round_):
            raise MoveError("It's not your turn to answer.")
        if round_.key is None:
            raise MoveError("Pick Truth or Dare first.")
        if player_id in round_.answers:
            raise MoveError("You've already answered.")
        question = self.bank.questions[round_.key]
        fmt = self._format(round_.format)
        if fmt.answer == "choice":
            if not isinstance(value, int) or isinstance(value, bool):
                raise MoveError("Pick one of the answers.")
            if not 0 <= value < len(question.options):
                raise MoveError("Pick one of the answers.")
            round_.answers[player_id] = value
        else:
            if value is None and round_.choice == "dare":
                value = ""  # "Done": a dare needs no words
            if not isinstance(value, str):
                raise MoveError("Type your answer.")
            try:
                text = clean_text(
                    value, label="Your answer", max_len=TEXT_MAX, required=round_.choice != "dare"
                )
            except ExperienceError as exc:
                raise MoveError(str(exc)) from exc
            round_.answers[player_id] = text or ""
        self._maybe_reveal()
        self._changed()

    def pick(self, player_id: str, kind: object) -> None:
        round_ = self._live_round()
        if self._format(round_.format).answer != "truth_dare":
            raise MoveError("There's nothing to pick in this game.")
        if round_.subject != player_id:
            raise MoveError("It's not your turn.")
        if round_.key is not None:
            raise MoveError("You've already picked.")
        if kind not in ("truth", "dare"):
            raise MoveError("Pick Truth or Dare.")
        round_.choice = kind
        self._fill(round_, kind=kind)
        self._changed()

    def skip(self, player_id: str) -> None:
        """Deep talk: spend a skip for a different question (same round)."""
        player = self._player(player_id)
        round_ = self._live_round()
        if self._format(round_.format).skips == 0:
            raise MoveError("This game has no skips.")
        if player.skips_left <= 0:
            raise MoveError("You've used all your skips.")
        player.skips_left -= 1
        skipped = round_.model_copy(update={"skipped": True})
        self.state.history.append(skipped)
        fresh = Round(number=round_.number, format=round_.format, subject=round_.subject)
        self._fill(fresh, kind=round_.choice)
        self.state.round = fresh
        self._changed()

    def next(self, player_id: str) -> None:
        """The host moves on, answered or not."""
        if player_id != self.state.host:
            raise MoveError("Only the host can move to the next question.")
        round_ = self._current()
        if not round_.revealed:
            round_.skipped = True
        number = round_.number
        self._finish_round()
        if number >= self.state.total:
            self.state.status = "ended"
        else:
            self._deal(number + 1)
        self._changed()

    def end(self, player_id: str) -> None:
        if player_id != self.state.host:
            raise MoveError("Only the host can end the game.")
        if self.state.status == "ended":
            return
        if self.state.round is not None:
            if not self.state.round.revealed:
                self.state.round.skipped = True
            self._finish_round()
        self.state.status = "ended"
        self._changed()

    def tick(self) -> bool:
        """Time's up on a timed question: reveal what's in. True if anything changed."""
        round_ = self.state.round
        if (
            self.state.status == "playing"
            and round_ is not None
            and not round_.revealed
            and round_.deadline is not None
            and self.now >= round_.deadline
        ):
            round_.revealed = True
            self._changed()
            return True
        return False

    def _current(self) -> Round:
        if self.state.status != "playing" or self.state.round is None:
            raise MoveError("The game isn't on right now.")
        self.tick()
        return self.state.round

    def _live_round(self) -> Round:
        """The current round, still open for answers."""
        round_ = self._current()
        if round_.revealed:
            # Answers are already showing: nothing to change until the host moves on.
            raise MoveError("Answers are showing. Waiting for the next question.")
        return round_


# --- what each player sees ----------------------------------------------------------------


def _answer_text(question: Question, value: int | str) -> str:
    if isinstance(value, int):
        return question.options[value].text
    return value


def _is_match(question: Question, round_: Round, players: list[str]) -> bool | None:
    if len(players) != 2 or not all(p in round_.answers for p in players):
        return None
    a, b = (round_.answers[p] for p in players)
    return a == b if question.options else None


def summary(state: GameState, bank: Bank) -> dict[str, object]:
    """Matches, guesses and love languages from the rounds played."""
    players = list(state.players)
    matched = scored = 0
    guesses: dict[str, int] = dict.fromkeys(players, 0)
    love: dict[str, dict[str, int]] = {p: {} for p in players}
    for round_ in state.history:
        if round_.skipped or round_.key is None:
            continue
        question = bank.questions[round_.key]
        scoring = bank.formats[round_.format].scoring
        match = _is_match(question, round_, players)
        if scoring == "match" and match is not None:
            scored += 1
            matched += int(match)
        elif scoring == "guess" and match is not None and round_.subject:
            guesser = next(p for p in players if p != round_.subject)
            guesses[guesser] += int(match)
        elif scoring == "love_language":
            for player, value in round_.answers.items():
                if isinstance(value, int) and question.options[value].lang:
                    lang = str(question.options[value].lang)
                    love[player][lang] = love[player].get(lang, 0) + 1
    top = {
        p: LANGUAGE_NAMES[max(counts, key=lambda k: counts[k])] if counts else None
        for p, counts in love.items()
    }
    return {
        "rounds": sum(1 for r in state.history if not r.skipped),
        "matched": matched,
        "scored": scored,
        "guesses": guesses,
        "love_languages": top,
    }


def view(state: GameState, bank: Bank, me: str, online: set[str], now: float) -> dict[str, object]:
    """Everything this player may see, and nothing more."""
    names = {p.id: p.name for p in state.players.values()}
    round_view: dict[str, object] | None = None
    round_ = state.round
    if round_ is not None:
        fmt = bank.formats[round_.format]
        question = bank.questions[round_.key] if round_.key else None
        subject = round_.subject
        text = None
        if question is not None:
            text = question.text
            if fmt.scoring == "guess" and subject and subject != me and question.guess:
                text = question.guess.replace("{name}", names.get(subject, "them"))
        required = [subject] if fmt.answer == "truth_dare" and subject else list(state.players)
        round_view = {
            "number": round_.number,
            "format": fmt.key,
            "format_name": fmt.name,
            "answer": fmt.answer,
            "text": text,
            "options": [o.text for o in question.options] if question else [],
            "subject": subject,
            "choice": round_.choice,
            "can_answer": me in required and me not in round_.answers and not round_.revealed,
            "answered": [p for p in required if p in round_.answers],
            "my_answer": (
                _answer_text(question, round_.answers[me])
                if question and me in round_.answers
                else None
            ),
            "my_choice": round_.answers.get(me) if fmt.answer == "choice" else None,
            "revealed": round_.revealed,
            # The other player's answer only once both are in (or time ran out).
            "answers": (
                {p: _answer_text(question, v) for p, v in round_.answers.items()}
                if round_.revealed and question
                else None
            ),
            "match": _is_match(question, round_, list(state.players))
            if round_.revealed and question
            else None,
            "seconds_left": max(0, round(round_.deadline - now)) if round_.deadline else None,
        }
    return {
        "version": state.version,
        "status": state.status,
        "format": state.format,
        "intensity": state.intensity,
        "total": state.total,
        "host": state.host,
        "me": me,
        "players": [
            {
                "id": p.id,
                "name": p.name,
                "ready": p.ready,
                "online": p.id in online,
                "skips_left": p.skips_left,
            }
            for p in state.players.values()
        ],
        "round": round_view,
        "summary": summary(state, bank) if state.status == "ended" else None,
    }

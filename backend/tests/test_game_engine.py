"""The rules of a game, tested without any network: moves, reveals, scores and what each sees."""

from typing import Any

import pytest

from app.games.bank import Bank, GameFormat, Question, load_bank
from app.games.engine import MIX, Game, GameState, MoveError, summary, target_depth, view

HOST, GUEST = "h", "g"


def _fmt(key: str, **kw: Any) -> GameFormat:
    base = {
        "key": key,
        "name": key,
        "blurb": "",
        "answer": "choice",
        "scoring": "match",
        "seconds": 0,
        "skips": 0,
        "in_mix": True,
    }
    return GameFormat.model_validate({**base, **kw})


def _q(key: str, fmt: str, depth: int = 1, **kw: Any) -> Question:
    base: dict[str, Any] = {"key": key, "format": fmt, "levels": ["romantic"], "depth": depth}
    base["text"] = kw.pop("text", f"Question {key}?")
    return Question.model_validate({**base, **kw})


TWO = [{"text": "Tea"}, {"text": "Coffee"}]
BANK = Bank(
    formats={
        f.key: f
        for f in [
            _fmt("same_page"),
            _fmt("this_or_that", seconds=10),
            _fmt("know_me", scoring="guess"),
            _fmt("deep_talk", answer="text", scoring="none", skips=2),
            _fmt("truth_dare", answer="truth_dare", scoring="none", in_mix=False),
            _fmt("love_language", scoring="love_language", in_mix=False),
        ]
    },
    questions={
        q.key: q
        for q in [
            *[_q(f"sp{i}", "same_page", depth=1 + i % 5, options=TWO) for i in range(12)],
            *[_q(f"tt{i}", "this_or_that", options=TWO) for i in range(6)],
            *[
                _q(
                    f"km{i}",
                    "know_me",
                    text="Your drink?",
                    guess="{name}'s drink?",
                    options=TWO,
                )
                for i in range(6)
            ],
            *[_q(f"dt{i}", "deep_talk") for i in range(6)],
            *[_q(f"tr{i}", "truth_dare", kind="truth") for i in range(4)],
            *[_q(f"da{i}", "truth_dare", kind="dare") for i in range(4)],
            *[
                _q(
                    f"ll{i}",
                    "love_language",
                    options=[
                        {"text": "A hug", "lang": "touch"},
                        {"text": "A note", "lang": "words"},
                    ],
                )
                for i in range(6)
            ],
        ]
    },
)


def pick(fmt: str, kind: str | None, depth: int, avoid: set[str]) -> Question | None:
    pool = [
        q
        for q in BANK.questions.values()
        if q.format == fmt and q.kind == kind and q.key not in avoid
    ]
    return min(pool, key=lambda q: (abs(q.depth - depth), q.key)) if pool else None


def _game(fmt: str, total: int = 4, now: float = 1000.0) -> Game:
    state = GameState(format=fmt, intensity="romantic", total=total, host=HOST, seed="s")
    game = Game(state, BANK, pick, now=now)
    game.join(HOST, "Ada")
    game.join(GUEST, "Tolu")
    game.ready(HOST)
    game.ready(GUEST)
    return game


def _view(game: Game, who: str) -> dict[str, Any]:
    return view(game.state, BANK, who, {HOST, GUEST}, game.now)


def test_lobby_two_players_then_ready() -> None:
    state = GameState(format="same_page", intensity="romantic", total=3, host=HOST)
    game = Game(state, BANK, pick)
    game.join(HOST, "Ada")
    game.join(GUEST, "Tolu")
    with pytest.raises(MoveError, match="two players"):
        game.join("x", "Bisi")
    game.ready(HOST)
    assert state.status == "lobby"
    game.ready(GUEST)
    assert state.status == "playing" and state.round and state.round.key


def test_answers_stay_private_until_both_are_in() -> None:
    game = _game("same_page")
    game.answer(HOST, 0)
    guest = _view(game, GUEST)["round"]
    assert guest["answered"] == [HOST]  # "Ada answered ✓"
    assert guest["answers"] is None and guest["my_answer"] is None
    assert "Tea" not in str({k: v for k, v in guest.items() if k != "options"})
    with pytest.raises(MoveError, match="already answered"):
        game.answer(HOST, 1)
    game.answer(GUEST, 0)
    shown = _view(game, GUEST)["round"]
    assert shown["revealed"] and shown["answers"] == {HOST: "Tea", GUEST: "Tea"}
    assert shown["match"] is True


def test_only_the_host_moves_on_even_before_answers() -> None:
    game = _game("same_page", total=2)
    with pytest.raises(MoveError, match="Only the host"):
        game.next(GUEST)
    game.next(HOST)  # nobody answered: skipped
    assert game.state.history[0].skipped
    game.answer(HOST, 1)
    game.answer(GUEST, 0)
    game.next(HOST)
    assert game.state.status == "ended"
    result = summary(game.state, BANK)
    assert (result["matched"], result["scored"], result["rounds"]) == (0, 1, 1)


def test_bad_answers_are_refused() -> None:
    game = _game("same_page")
    for bad in (5, -1, "Tea", True, None):
        with pytest.raises(MoveError):
            game.answer(HOST, bad)


def test_questions_never_repeat_in_a_game_and_build_up() -> None:
    game = _game("same_page", total=8)
    seen = []
    for _ in range(8):
        assert game.state.round is not None
        seen.append(game.state.round.key)
        game.next(HOST)
    assert len(set(seen)) == 8
    shape = [target_depth(n, 10) for n in range(1, 11)]
    assert shape[0] == 1 and max(shape) == 5 and shape[-1] == 3  # warm up, peak, cool down
    peak = shape.index(5)
    assert shape[: peak + 1] == sorted(shape[: peak + 1])


def test_timed_questions_reveal_when_time_is_up() -> None:
    game = _game("this_or_that")
    assert _view(game, HOST)["round"]["seconds_left"] == 10
    game.answer(HOST, 1)
    game.now += 11
    assert game.tick() is True
    shown = _view(game, GUEST)["round"]
    assert shown["revealed"] and shown["answers"] == {HOST: "Coffee"}
    with pytest.raises(MoveError, match="Answers are showing"):
        game.answer(GUEST, 0)


def test_know_me_swaps_roles_and_scores_the_guesser() -> None:
    game = _game("know_me", total=2)
    assert game.state.round and game.state.round.subject == HOST
    assert _view(game, HOST)["round"]["text"] == "Your drink?"
    assert _view(game, GUEST)["round"]["text"] == "Ada's drink?"
    game.answer(HOST, 1)
    game.answer(GUEST, 1)  # Tolu guessed right
    game.next(HOST)
    assert game.state.round and game.state.round.subject == GUEST
    assert _view(game, HOST)["round"]["text"] == "Tolu's drink?"
    game.answer(HOST, 0)
    game.answer(GUEST, 1)  # Ada guessed wrong
    game.next(HOST)
    assert summary(game.state, BANK)["guesses"] == {HOST: 0, GUEST: 1}


def test_deep_talk_skips() -> None:
    game = _game("deep_talk")
    first = game.state.round.key if game.state.round else None
    game.skip(GUEST)
    assert game.state.round and game.state.round.key != first and game.state.round.number == 1
    assert game.state.players[GUEST].skips_left == 1
    game.skip(GUEST)
    with pytest.raises(MoveError, match="used all your skips"):
        game.skip(GUEST)
    with pytest.raises(MoveError, match="Type your answer"):
        game.answer(HOST, 3)
    game.answer(HOST, "  Honestly? Leaving home at 18.  ")
    game.answer(GUEST, "Learning to say no.")
    assert _view(game, HOST)["round"]["answers"][HOST] == "Honestly? Leaving home at 18."


def test_truth_or_dare_turns() -> None:
    game = _game("truth_dare", total=2)
    round_ = game.state.round
    assert round_ and round_.subject == HOST and round_.key is None
    with pytest.raises(MoveError, match="not your turn"):
        game.pick(GUEST, "truth")
    with pytest.raises(MoveError, match="Pick Truth or Dare first"):
        game.answer(HOST, "x")
    game.pick(HOST, "dare")
    assert game.state.round and game.state.round.key and game.state.round.key.startswith("da")
    with pytest.raises(MoveError, match="not your turn"):
        game.answer(GUEST, "x")
    game.answer(HOST, None)  # "Done"
    assert _view(game, GUEST)["round"]["revealed"] is True
    game.next(HOST)
    assert game.state.round and game.state.round.subject == GUEST
    game.pick(GUEST, "truth")
    with pytest.raises(MoveError, match="required"):
        game.answer(GUEST, "   ")


def test_love_language_summary() -> None:
    game = _game("love_language", total=3)
    for host_pick, guest_pick in ((0, 1), (0, 1), (1, 1)):
        game.answer(HOST, host_pick)
        game.answer(GUEST, guest_pick)
        game.next(HOST)
    assert summary(game.state, BANK)["love_languages"] == {
        HOST: "Physical touch",
        GUEST: "Words of affirmation",
    }


def test_mix_rotates_games_and_leaves_out_turn_games() -> None:
    game = _game(MIX, total=8)
    formats = []
    for _ in range(8):
        assert game.state.round is not None
        formats.append(game.state.round.format)
        game.next(HOST)
    in_mix = {"same_page", "this_or_that", "know_me", "deep_talk"}
    assert set(formats) == in_mix
    assert formats[:4] != formats[4:] or len(set(formats[:4])) == 4


def test_host_can_end_early() -> None:
    game = _game("same_page", total=5)
    with pytest.raises(MoveError):
        game.end(GUEST)
    game.end(HOST)
    assert game.state.status == "ended" and game.state.round is None


def test_running_out_of_questions_is_explained() -> None:
    game = _game("same_page", total=20)
    with pytest.raises(MoveError, match="ran out of questions"):
        for _ in range(20):
            game.next(HOST)


def test_the_real_question_files_load() -> None:
    bank = load_bank()
    assert set(bank.formats) == {
        "same_page",
        "would_you_rather",
        "this_or_that",
        "know_me",
        "finish_sentence",
        "deep_talk",
        "truth_dare",
        "love_language",
    }
    for key in bank.formats:
        assert bank.pool(key, "romantic"), f"no romantic questions for {key}"


def test_the_bank_is_big_enough_for_every_game_and_level() -> None:
    bank = load_bank()
    assert len(bank.questions) >= 1900
    for key in bank.formats:
        for level in ("friendship", "talking", "romantic", "intense"):
            pool = bank.pool(key, level)
            if key == "truth_dare":
                # Every turn needs a fresh truth or dare, whichever is picked.
                assert sum(q.kind == "truth" for q in pool) >= 20, (key, level)
                assert sum(q.kind == "dare" for q in pool) >= 20, (key, level)
            else:
                assert len(pool) >= 60, (key, level)


def test_no_question_is_written_twice_in_a_game() -> None:
    bank = load_bank()
    seen: set[tuple[str, str, tuple[str, ...]]] = set()
    for q in bank.questions.values():
        sig = (q.format, q.text.lower(), tuple(sorted(o.text.lower() for o in q.options)))
        assert sig not in seen, q.key
        seen.add(sig)

"""The game list (config/game_formats.yaml) and the question bank (config/questions/*.yaml).

Questions stay on the server: the browser only ever receives the one question being played. The
files are checked when the app starts, so a typo refuses to boot rather than breaking a game.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.registries import CONFIG_DIR, load_registry

Intensity = Literal["friendship", "talking", "romantic", "intense"]
INTENSITIES: tuple[Intensity, ...] = ("friendship", "talking", "romantic", "intense")
Language = Literal["words", "time", "gifts", "acts", "touch"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class GameFormat(_Strict):
    key: str = Field(pattern=r"^[a-z_]+$")
    name: str
    blurb: str
    answer: Literal["choice", "text", "truth_dare"]
    scoring: Literal["match", "guess", "love_language", "none"]
    seconds: int = Field(ge=0, le=120)
    skips: int = Field(ge=0, le=10)
    in_mix: bool


class Option(_Strict):
    text: str = Field(min_length=1, max_length=80)
    lang: Language | None = None  # love language quiz only


class Question(_Strict):
    key: str = Field(pattern=r"^[a-z0-9_]+$")
    format: str
    levels: tuple[Intensity, ...] = Field(min_length=1)
    depth: int = Field(ge=1, le=5)  # 1 = light warm-up ... 5 = the deepest
    text: str = Field(min_length=3, max_length=200)
    # "How well do you know me": the guesser's version, with {name} for the other player.
    guess: str | None = Field(default=None, max_length=200)
    options: tuple[Option, ...] = ()
    kind: Literal["truth", "dare"] | None = None  # truth or dare only

    @field_validator("options", mode="before")
    @classmethod
    def _plain_options(cls, value: object) -> object:
        """In the files, a plain option can be written as just its text."""
        if isinstance(value, list | tuple):
            return [{"text": o} if isinstance(o, str) else o for o in value]
        return value


class _QuestionFile(_Strict):
    questions: list[dict[str, object]]


def _check(question: Question, game: GameFormat) -> None:
    where = f"{game.key}/{question.key}"
    if game.answer == "choice" and not 2 <= len(question.options) <= 4:
        raise ValueError(f"{where}: choice questions need 2 to 4 options")
    if game.answer != "choice" and question.options:
        raise ValueError(f"{where}: only choice questions have options")
    if game.scoring == "guess" and not (question.guess and "{name}" in question.guess):
        raise ValueError(f"{where}: needs a guess version with {{name}}")
    if game.scoring == "love_language":
        if len(question.options) != 2 or any(o.lang is None for o in question.options):
            raise ValueError(f"{where}: love language questions need 2 options, each with a lang")
    elif any(o.lang for o in question.options):
        raise ValueError(f"{where}: lang is only for love language questions")
    if (game.answer == "truth_dare") != (question.kind is not None):
        raise ValueError(f"{where}: kind (truth/dare) is only and always for truth or dare")


class Bank(BaseModel):
    formats: dict[str, GameFormat]
    questions: dict[str, Question]

    def pool(self, format_key: str, intensity: Intensity) -> list[Question]:
        return [
            q for q in self.questions.values() if q.format == format_key and intensity in q.levels
        ]


def load_bank(config_dir: Path = CONFIG_DIR) -> Bank:
    formats = {
        f.key: f
        for f in (GameFormat.model_validate(e) for e in load_registry("game_formats", config_dir))
    }
    questions: dict[str, Question] = {}
    folder = config_dir / "questions"
    for path in sorted(folder.glob("*.yaml")) if folder.is_dir() else []:
        game = formats.get(path.stem)
        if game is None:
            raise ValueError(f"questions/{path.name}: no game called {path.stem!r}")
        data = _QuestionFile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
        for entry in data.questions:
            question = Question.model_validate({**entry, "format": game.key})
            _check(question, game)
            if question.key in questions:
                raise ValueError(f"questions/{path.name}: key {question.key!r} is used twice")
            questions[question.key] = question
    return Bank(formats=formats, questions=questions)


@lru_cache
def bank() -> Bank:
    return load_bank()

"""Curated date places per city, from config/cities.yaml.

Each place names the published guides it came from (and its rank there), so the app can say
"Featured in 3 guides". The file is checked when the app starts: a typo refuses to boot rather than
showing a broken list.
"""

from datetime import date
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from app.core.registries import load_registry

Vibe = Literal[
    "romantic_dinner",
    "rooftop",
    "waterfront",
    "beach",
    "outdoors",
    "art",
    "playful",
    "lounge",
    "spa",
    "getaway",
    "proposal",
    "budget",
    "luxury",
]
Kind = Literal["restaurant", "rooftop", "art", "outdoors", "beach", "activity", "spa", "getaway"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Source(_Strict):
    title: str
    publisher: str
    url: HttpUrl
    published: date | None
    ranked: bool


class Mention(_Strict):
    source: str
    rank: int | None = Field(default=None, ge=1)


class Place(_Strict):
    key: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    area: str
    address: str | None = None
    kind: Kind
    vibes: tuple[Vibe, ...] = Field(min_length=1)
    price: int | None = Field(default=None, ge=1, le=4)
    price_note: str | None = None
    sources: tuple[Mention, ...] = Field(min_length=1)

    @property
    def best_rank(self) -> int | None:
        ranks = [m.rank for m in self.sources if m.rank is not None]
        return min(ranks) if ranks else None


class City(_Strict):
    key: str = Field(pattern=r"^[a-z0-9-]+$")
    name: str
    currency: str
    timezone: str
    sources: dict[str, Source]
    places: tuple[Place, ...]

    @model_validator(mode="after")
    def _check(self) -> "City":
        keys = [p.key for p in self.places]
        if len(keys) != len(set(keys)):
            raise ValueError(f"{self.key}: two places share a key")
        for place in self.places:
            for mention in place.sources:
                source = self.sources.get(mention.source)
                if source is None:
                    raise ValueError(f"{self.key}/{place.key}: unknown source {mention.source!r}")
                if (mention.rank is not None) != source.ranked:
                    raise ValueError(
                        f"{self.key}/{place.key}: {mention.source} "
                        + ("needs a rank" if source.ranked else "has no ranks")
                    )
        return self


@lru_cache
def cities() -> dict[str, City]:
    found = {c.key: c for c in (City.model_validate(e) for e in load_registry("cities"))}
    if len(found) != len(load_registry("cities")):
        raise ValueError("cities.yaml: two cities share a key")
    return found


def ordered(places: tuple[Place, ...] | list[Place]) -> list[Place]:
    """Most-recommended first: named by more guides, then a better rank, then by name."""
    return sorted(
        places,
        key=lambda p: (-len(p.sources), p.best_rank or 10_000, p.name.lower()),
    )

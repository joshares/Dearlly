"""Curated date places: the file is checked, and the list is public and ordered."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.services import places


def test_both_cities_have_enough_places() -> None:
    found = places.cities()
    assert len(found["lagos"].places) >= 40
    assert len(found["abuja"].places) >= 15
    # The plan's bar for Stage 5: 50+ curated places.
    assert sum(len(c.places) for c in found.values()) >= 50


def test_every_place_is_sourced() -> None:
    for city in places.cities().values():
        for place in city.places:
            assert place.sources, place.key
            for mention in place.sources:
                assert str(city.sources[mention.source].url).startswith("https://")


def _city(**place: Any) -> dict[str, Any]:
    base = {"key": "x", "name": "X", "area": "VI", "kind": "restaurant", "vibes": ["rooftop"]}
    return {
        "key": "test",
        "name": "Test",
        "currency": "NGN",
        "timezone": "Africa/Lagos",
        "sources": {
            "list": {
                "title": "T",
                "publisher": "P",
                "url": "https://example.com/list",
                "published": "2026-01-01",
                "ranked": True,
            }
        },
        "places": [{**base, "sources": [{"source": "list", "rank": 1}], **place}],
    }


@pytest.mark.parametrize(
    "bad",
    [
        {"vibes": ["sparkly"]},
        {"kind": "nightclub"},
        {"sources": [{"source": "nowhere", "rank": 1}]},
        {"sources": [{"source": "list"}]},  # a ranked list needs the rank
        {"price": 5},
        {"surprise": "field"},
    ],
)
def test_mistakes_in_the_file_are_refused(bad: dict[str, Any]) -> None:
    places.City.model_validate(_city())
    with pytest.raises(ValidationError):
        places.City.model_validate(_city(**bad))


def test_places_are_public_and_ordered(client: TestClient) -> None:
    cities = client.get("/cities").json()
    assert {c["key"] for c in cities} == {"lagos", "abuja"}

    lagos = client.get("/cities/lagos/places").json()
    counts = [len(p["sources"]) for p in lagos]
    assert counts == sorted(counts, reverse=True)  # most-recommended first
    assert lagos[0]["sources"][0]["url"].startswith("https://")

    rooftops = client.get("/cities/lagos/places?vibe=rooftop").json()
    assert rooftops and all("rooftop" in p["vibes"] for p in rooftops)
    assert client.get("/cities/kano/places").status_code == 404

from pathlib import Path

import pytest
from fastapi import HTTPException

from app.core.plans import PLAN_FEATURES, Feature, Plan, has_feature, require_feature
from app.core.registries import REGISTRIES, RegistryError, load_all_registries, load_registry


def test_every_plan_has_a_feature_list() -> None:
    assert set(PLAN_FEATURES) == set(Plan)


def test_premium_has_every_feature() -> None:
    assert all(has_feature(Plan.PREMIUM, feature) for feature in Feature)


def test_free_plan_is_gated_server_side() -> None:
    assert has_feature(Plan.FREE, Feature.SCHEDULED_SEND)
    with pytest.raises(HTTPException) as error:
        require_feature(Plan.FREE, Feature.NO_WATERMARK)
    assert error.value.status_code == 403


def test_registries_load() -> None:
    registries = load_all_registries()
    assert set(registries) == set(REGISTRIES)
    assert len(registries["game_formats"]) == 9
    assert {c["key"] for c in registries["cities"]} == {"lagos", "abuja"}
    assert any(t["key"] == "love_note" for t in registries["experience_types"])
    assert len(registries["quotes"]) >= 40


def test_quotes_are_tidy() -> None:
    quotes = load_registry("quotes")
    keys = [q["key"] for q in quotes]
    assert len(keys) == len(set(keys)), "two quotes share a key"
    # Every mood needs a button label in the write page (frontend en.json, write.moods).
    moods = {"sweet", "romantic", "poetic", "playful", "deep", "birthday", "anniversary",
             "friendship", "missing_you", "apology"}  # fmt: skip
    assert {q["mood"] for q in quotes} == moods
    # They must fit the letter: title up to 80 characters, message up to 600.
    assert all(len(q["title"]) <= 80 and len(q["text"]) <= 600 for q in quotes)


def test_broken_registry_is_refused(tmp_path: Path) -> None:
    (tmp_path / "cities.yaml").write_text("wrong_key: []\n")
    with pytest.raises(RegistryError):
        load_registry("cities", tmp_path)


def test_unknown_registry_is_refused() -> None:
    with pytest.raises(RegistryError):
        load_registry("planets")


def test_email_rules() -> None:
    from app.services.profiles import ProfileFieldError, normalize_email

    assert normalize_email("  Ada_Demo@Example.COM ") == "ada_demo@example.com"
    for bad in ("", "ada", "ada@", "@x.com", "a@b", "a@b.", "a@.com", "a b@x.com", "a@b@c.com"):
        with pytest.raises(ProfileFieldError):
            normalize_email(bad)
    # The pattern CodeQL flagged as slow now returns instantly.
    with pytest.raises(ProfileFieldError):
        normalize_email("!@!." + "!." * 120)


def test_tests_clear_every_table_between_runs() -> None:
    """A table missing here keeps rows from one test to the next (counts then drift)."""
    from app.models import Base

    from .conftest import TABLES

    assert set(Base.metadata.tables) == set(TABLES)

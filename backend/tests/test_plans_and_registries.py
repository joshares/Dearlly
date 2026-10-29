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


def test_registries_load_and_start_empty() -> None:
    registries = load_all_registries()
    assert set(registries) == set(REGISTRIES)
    assert all(entries == () for entries in registries.values())


def test_broken_registry_is_refused(tmp_path: Path) -> None:
    (tmp_path / "cities.yaml").write_text("wrong_key: []\n")
    with pytest.raises(RegistryError):
        load_registry("cities", tmp_path)


def test_unknown_registry_is_refused() -> None:
    with pytest.raises(RegistryError):
        load_registry("planets")

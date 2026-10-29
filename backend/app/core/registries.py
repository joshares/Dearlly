"""YAML registries: experience types, cities and game formats.

Adding a type, city or format is a config change plus a form, not a rebuild. Each file holds one
top-level key with a list; the entry shapes are defined in the stage that first uses them.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"

REGISTRIES = {
    "experience_types": "experience_types.yaml",
    "cities": "cities.yaml",
    "game_formats": "game_formats.yaml",
    "quotes": "quotes.yaml",
}


class RegistryError(ValueError):
    pass


@lru_cache
def load_registry(name: str, config_dir: Path = CONFIG_DIR) -> tuple[dict[str, Any], ...]:
    if name not in REGISTRIES:
        raise RegistryError(f"Unknown registry {name!r}")
    path = config_dir / REGISTRIES[name]
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict) or set(data) != {name}:
        raise RegistryError(f"{path.name} must have exactly one top-level key: {name}")
    entries = data[name] or []
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        raise RegistryError(f"{path.name}: {name} must be a list of mappings")
    return tuple(entries)


def load_all_registries(config_dir: Path = CONFIG_DIR) -> dict[str, tuple[dict[str, Any], ...]]:
    return {name: load_registry(name, config_dir) for name in REGISTRIES}

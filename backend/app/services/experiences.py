"""The experience engine: one set of rules for every type (love note, date invitation, ...).

- Types come from config/experience_types.yaml; content is validated against the type's fields.
- Private links: 192 random bits. The database stores a SHA-256 hash to find the letter and an
  encrypted copy (key derived from SECRET_KEY) so the sender can copy their link again later.
- Fields are plain text unless the type says otherwise: a date and time, a city, or a curated
  place (whose name and address the server copies in, so the invitation never changes later).
- Text is plain text only. Links and long digit runs (bank account numbers) are refused: these
  letters reach people who never signed up, and that's where scams start.
"""

import base64
import hashlib
import hmac
import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import Settings
from app.core.registries import load_registry
from app.core.security import hash_token, new_token
from app.services import places

LINK_TOKEN_BYTES = 24  # 192 bits; the plan asks for at least 128
NAME_MAX = 60
TITLE_MAX = 60
REPLY_NOTE_MAX = 280
MAX_AHEAD = timedelta(days=366)
FIELD_KINDS = ("text", "datetime", "date", "city", "place", "photo")
MAX_TRIP_DAYS = 60
WAT = timedelta(hours=1)  # dates are days in West Africa Time (UTC+1, no daylight saving)

_LINK_RE = re.compile(r"(?i)(https?://|www\.|\b[a-z0-9-]+\.(com|ng|net|org|app|io|co|me|ly)\b)")
_ACCOUNT_NUMBER_RE = re.compile(r"\d[\d\s-]{8,}\d")


class ExperienceError(ValueError):
    pass


@dataclass(frozen=True)
class FieldSpec:
    key: str
    max: int
    required: bool
    kind: str = "text"


@dataclass(frozen=True)
class ExperienceType:
    key: str
    name: str
    fields: tuple[FieldSpec, ...]
    themes: tuple[str, ...]
    reply: str
    reactions: tuple[tuple[str, str], ...]
    email_subject: str = "{sender} sealed a letter for you 💌"


@lru_cache
def experience_types() -> dict[str, ExperienceType]:
    types: dict[str, ExperienceType] = {}
    for entry in load_registry("experience_types"):
        fields = tuple(
            FieldSpec(
                key,
                int(spec.get("max", 64)),
                bool(spec.get("required", False)),
                str(spec.get("kind", "text")),
            )
            for key, spec in (entry.get("fields") or {}).items()
        )
        for spec in fields:
            if spec.kind not in FIELD_KINDS:
                raise ValueError(f"{entry['key']}.{spec.key}: unknown kind {spec.kind!r}")
        reactions = tuple((r["key"], r["label"]) for r in entry.get("reactions") or [])
        types[entry["key"]] = ExperienceType(
            key=entry["key"],
            name=entry["name"],
            fields=fields,
            themes=tuple(entry.get("themes") or ["cream"]),
            reply=entry.get("reply", "reaction"),
            reactions=reactions,
            email_subject=str(entry.get("email_subject") or ExperienceType.email_subject),
        )
    return types


@lru_cache
def quotes() -> tuple[dict[str, str], ...]:
    return tuple(
        {k: str(v) for k, v in q.items() if k in {"key", "mood", "title", "text"}}
        for q in load_registry("quotes")
    )


def clean_text(value: str | None, *, label: str, max_len: int, required: bool) -> str | None:
    """Plain text: tidy spaces and lines; no hidden characters, links or account numbers."""
    if value is None:
        if required:
            raise ExperienceError(f"{label} is required.")
        return None
    lines = [" ".join(line.split()) for line in unicodedata.normalize("NFC", value).splitlines()]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if not text:
        if required:
            raise ExperienceError(f"{label} is required.")
        return None
    if len(text) > max_len:
        raise ExperienceError(f"{label} can be up to {max_len} characters.")
    if any(unicodedata.category(c).startswith("C") and c != "\n" for c in text):
        raise ExperienceError(f"{label} can't contain hidden characters.")
    if _LINK_RE.search(text):
        raise ExperienceError(f"{label} can't contain links.")
    if _ACCOUNT_NUMBER_RE.search(text):
        raise ExperienceError(f"{label} can't contain long numbers like account numbers.")
    return text


def validate_content(
    kind: ExperienceType, content: dict[str, Any], now: datetime | None = None
) -> dict[str, str]:
    unknown = set(content) - {f.key for f in kind.fields}
    if unknown:
        raise ExperienceError(f"Unknown fields: {', '.join(sorted(unknown))}.")
    now = now or datetime.now(UTC)
    cleaned: dict[str, str] = {}
    for spec in kind.fields:
        raw = content.get(spec.key)
        if raw is not None and not isinstance(raw, str):
            raise ExperienceError(f"{spec.key} must be text.")
        label = spec.key.replace("_", " ").capitalize()
        if spec.kind == "text":
            value = clean_text(raw, label=label, max_len=spec.max, required=spec.required)
        elif raw is None or not raw.strip():
            if spec.required:
                raise ExperienceError(f"{label} is required.")
            value = None
        elif spec.kind == "datetime":
            value = _future_time(raw.strip(), now)
        elif spec.kind == "date":
            value = _coming_day(raw.strip(), now)
        elif spec.kind == "photo":
            # Who owns it and whether it's free is checked against the database when sealing.
            try:
                value = str(uuid.UUID(raw))
            except ValueError as exc:
                raise ExperienceError("Add the photo again.") from exc
        elif spec.kind == "city":
            if raw not in places.cities():
                raise ExperienceError("Pick a city we cover.")
            value = raw
        else:  # place: checked below, once the city is known
            value = raw
        if value is not None:
            cleaned[spec.key] = value
    _fill_place(kind, cleaned)
    _check_trip(cleaned)
    return cleaned


def _coming_day(raw: str, now: datetime) -> str:
    try:
        day = date.fromisoformat(raw)
    except ValueError as exc:
        raise ExperienceError("Pick a date.") from exc
    today = (now + WAT).date()
    if not today <= day <= today + MAX_AHEAD:
        raise ExperienceError("Pick a date from today, within a year.")
    return day.isoformat()


def _check_trip(cleaned: dict[str, str]) -> None:
    if "start_date" not in cleaned or "end_date" not in cleaned:
        return
    start, end = date.fromisoformat(cleaned["start_date"]), date.fromisoformat(cleaned["end_date"])
    if end < start:
        raise ExperienceError("The trip has to end on or after the day it starts.")
    if (end - start).days >= MAX_TRIP_DAYS:
        raise ExperienceError(f"Trips can be up to {MAX_TRIP_DAYS} days.")


def _future_time(raw: str, now: datetime) -> str:
    try:
        when = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ExperienceError("Pick a date and time.") from exc
    if when.tzinfo is None:
        raise ExperienceError("Pick a date and time.")
    if not now < when <= now + MAX_AHEAD:
        raise ExperienceError("Pick a date and time in the future, within a year.")
    return when.isoformat()


def _fill_place(kind: ExperienceType, cleaned: dict[str, str]) -> None:
    """A curated place's details come from our list, not the browser; otherwise a name is needed."""
    place_fields = [f.key for f in kind.fields if f.kind == "place"]
    if not place_fields:
        return
    key = cleaned.get(place_fields[0])
    if key is None:
        if "place_name" not in cleaned:
            raise ExperienceError("Pick a place, or type where you'll go.")
        return
    city = places.cities().get(cleaned.get("city", ""))
    place = next((p for p in city.places if p.key == key), None) if city else None
    if place is None:
        raise ExperienceError("That place isn't on our list. Pick another or type it in.")
    cleaned["place_name"] = place.name
    cleaned["place_area"] = place.area
    if place.address:
        cleaned["place_address"] = place.address
    else:
        cleaned.pop("place_address", None)


# --- private links ---------------------------------------------------------------------------


def new_link_token() -> str:
    return new_token(LINK_TOKEN_BYTES)


def link_hash(token: str) -> str:
    return hash_token(token)


def _fernet(settings: Settings, purpose: bytes = b"dearlly-link-tokens") -> Fernet:
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=purpose).derive(
        settings.secret_key.get_secret_value().encode()
    )
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_token(settings: Settings, token: str) -> str:
    return _fernet(settings).encrypt(token.encode()).decode()


def decrypt_token(settings: Settings, encrypted: str) -> str | None:
    try:
        return _fernet(settings).decrypt(encrypted.encode()).decode()
    except InvalidToken:
        return None


# --- recipient emails ------------------------------------------------------------------------
# Kept encrypted only until the letter is emailed, then deleted. What stays is a keyed
# fingerprint, so "Stop messages" and "Never email me" can be honoured without keeping the address.

_EMAIL_PURPOSE = b"dearlly-recipient-emails"


def encrypt_email(settings: Settings, email: str) -> str:
    return _fernet(settings, _EMAIL_PURPOSE).encrypt(email.encode()).decode()


def decrypt_email(settings: Settings, encrypted: str) -> str | None:
    try:
        return _fernet(settings, _EMAIL_PURPOSE).decrypt(encrypted.encode()).decode()
    except InvalidToken:
        return None


def email_fingerprint(settings: Settings, email: str) -> str:
    key = settings.secret_key.get_secret_value().encode()
    return hmac.new(key, f"recipient-email:{email}".encode(), hashlib.sha256).hexdigest()


def letter_url(settings: Settings, token: str) -> str:
    return f"{settings.public_web_url.rstrip('/')}/l/{token}"

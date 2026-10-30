"""The experience engine: one set of rules for every type (love note now; more in Stage 5).

- Types come from config/experience_types.yaml; content is validated against the type's fields.
- Private links: 192 random bits. The database stores a SHA-256 hash to find the letter and an
  encrypted copy (key derived from SECRET_KEY) so the sender can copy their link again later.
- Text is plain text only. Links and long digit runs (bank account numbers) are refused: these
  letters reach people who never signed up, and that's where scams start.
"""

import base64
import hashlib
import hmac
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import Settings
from app.core.registries import load_registry
from app.core.security import hash_token, new_token

LINK_TOKEN_BYTES = 24  # 192 bits; the plan asks for at least 128
NAME_MAX = 60
TITLE_MAX = 60
REPLY_NOTE_MAX = 280

_LINK_RE = re.compile(r"(?i)(https?://|www\.|\b[a-z0-9-]+\.(com|ng|net|org|app|io|co|me|ly)\b)")
_ACCOUNT_NUMBER_RE = re.compile(r"\d[\d\s-]{8,}\d")


class ExperienceError(ValueError):
    pass


@dataclass(frozen=True)
class FieldSpec:
    key: str
    max: int
    required: bool


@dataclass(frozen=True)
class ExperienceType:
    key: str
    name: str
    fields: tuple[FieldSpec, ...]
    themes: tuple[str, ...]
    reply: str
    reactions: tuple[tuple[str, str], ...]


@lru_cache
def experience_types() -> dict[str, ExperienceType]:
    types: dict[str, ExperienceType] = {}
    for entry in load_registry("experience_types"):
        fields = tuple(
            FieldSpec(key, int(spec["max"]), bool(spec.get("required", False)))
            for key, spec in (entry.get("fields") or {}).items()
        )
        reactions = tuple((r["key"], r["label"]) for r in entry.get("reactions") or [])
        types[entry["key"]] = ExperienceType(
            key=entry["key"],
            name=entry["name"],
            fields=fields,
            themes=tuple(entry.get("themes") or ["cream"]),
            reply=entry.get("reply", "reaction"),
            reactions=reactions,
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


def validate_content(kind: ExperienceType, content: dict[str, Any]) -> dict[str, str]:
    unknown = set(content) - {f.key for f in kind.fields}
    if unknown:
        raise ExperienceError(f"Unknown fields: {', '.join(sorted(unknown))}.")
    cleaned: dict[str, str] = {}
    for spec in kind.fields:
        raw = content.get(spec.key)
        if raw is not None and not isinstance(raw, str):
            raise ExperienceError(f"{spec.key} must be text.")
        label = spec.key.replace("_", " ").capitalize()
        value = clean_text(raw, label=label, max_len=spec.max, required=spec.required)
        if value is not None:
            cleaned[spec.key] = value
    return cleaned


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

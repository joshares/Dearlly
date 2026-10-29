"""Rules for public profile fields: usernames, display names and emails."""

import re
import unicodedata

USERNAME_MIN, USERNAME_MAX = 3, 20
DISPLAY_NAME_MAX = 40
EMAIL_MAX = 254

_USERNAME_RE = re.compile(r"^[a-z][a-z0-9_]*$")
# Links and phone numbers in public names are a scam risk.
_LINK_RE = re.compile(r"(?i)(https?:|www\.|\.(com|ng|net|org|app|io|co)\b)")
_PHONE_RE = re.compile(r"\d[\d\s\-().+]{6,}\d")

RESERVED_USERNAMES = frozenset(
    {
        "admin",
        "administrator",
        "dearlly",
        "help",
        "hello",
        "mod",
        "moderator",
        "official",
        "partners",
        "postman",
        "root",
        "security",
        "staff",
        "support",
        "system",
        "team",
    }
)


class ProfileFieldError(ValueError):
    pass


def normalize_email(value: str) -> str:
    # Checked by splitting, not a regex, so no input can make it slow.
    email = value.strip().lower()
    local, _, domain = email.rpartition("@")
    labels = domain.split(".")
    if (
        len(email) > EMAIL_MAX
        or not local
        or "@" in local
        or any(char.isspace() for char in email)
        or len(labels) < 2
        or not all(labels)
    ):
        raise ProfileFieldError("Enter a valid email address.")
    return email


def normalize_username(value: str) -> str:
    username = value.strip().lower()
    if not USERNAME_MIN <= len(username) <= USERNAME_MAX:
        raise ProfileFieldError(f"Usernames are {USERNAME_MIN} to {USERNAME_MAX} characters long.")
    if not _USERNAME_RE.match(username):
        raise ProfileFieldError(
            "Use letters, numbers and underscores only, starting with a letter."
        )
    if username in RESERVED_USERNAMES or username.startswith("dearlly"):
        raise ProfileFieldError("That username isn't available.")
    return username


def normalize_display_name(value: str | None) -> str | None:
    if value is None:
        return None
    name = unicodedata.normalize("NFC", " ".join(value.split()))
    if not name:
        return None
    if len(name) > DISPLAY_NAME_MAX:
        raise ProfileFieldError(f"Display names are up to {DISPLAY_NAME_MAX} characters.")
    if any(unicodedata.category(char).startswith("C") for char in name):
        raise ProfileFieldError("Display names can't contain hidden characters.")
    if _LINK_RE.search(name) or _PHONE_RE.search(name):
        raise ProfileFieldError("Display names can't contain links or phone numbers.")
    return name

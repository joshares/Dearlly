"""JSON logs with a redaction list, so secrets and personal tokens never reach log storage."""

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

REDACTED = "[REDACTED]"

# Any log field whose name contains one of these is replaced with [REDACTED].
REDACT_KEYS = (
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "session",
    "dsn",
    "database_url",
    "redis_url",
    "otp",
    "private_key",
)

_KEY_PATTERN = "|".join(re.escape(key) for key in REDACT_KEYS)
# key=value / key: value pairs inside free-text messages.
_PAIR_RE = re.compile(
    rf"(?i)\b([\w-]*(?:{_KEY_PATTERN})[\w-]*)(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|\S+)"
)
# Credentials inside URLs: scheme://user:password@host
_URL_CREDENTIALS_RE = re.compile(r"(://[^/\s:@]+:)[^@\s/]+@")
# Bearer tokens.
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[\w.~+/-]+=*")

# Attributes every LogRecord has; anything else was passed via `extra=`.
_STANDARD_ATTRS = frozenset(
    vars(logging.LogRecord("", 0, "", 0, "", None, None)).keys() | {"message", "asctime"}
)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(marker in lowered for marker in REDACT_KEYS)


def redact_text(text: str) -> str:
    text = _URL_CREDENTIALS_RE.sub(rf"\1{REDACTED}@", text)
    text = _BEARER_RE.sub(f"Bearer {REDACTED}", text)
    return _PAIR_RE.sub(rf"\1\2{REDACTED}", text)


def redact(value: Any, key: str | None = None) -> Any:
    if key is not None and _is_sensitive_key(key):
        return REDACTED
    if isinstance(value, dict):
        return {k: redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [redact(item) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    if value is None or isinstance(value, bool | int | float):
        return value
    return redact_text(str(value))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_text(record.getMessage()),
        }
        request_id = request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        for key, value in vars(record).items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = redact(value, key)
        if record.exc_info:
            payload["exception"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # Route uvicorn and celery through the same JSON handler.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "celery"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True

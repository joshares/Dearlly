"""Error reporting to Sentry (EU). Off unless SENTRY_DSN is set.

Privacy first: no personal data by default, no request bodies, no local variables (they can
hold passwords or login codes), cookies and auth headers removed, and every event goes through
the same redaction list as our logs before it leaves the server.
"""

import logging
import re
from typing import Any

import sentry_sdk

from app.core.config import Settings
from app.core.logging import redact

logger = logging.getLogger(__name__)

_DROP_HEADERS = {
    "cookie",
    "authorization",
    "x-csrf-token",
    "cf-connecting-ip",
    "x-forwarded-for",
    "referer",  # can repeat a private letter link
}


# "?code=123456", "?token=…": query strings can carry private links and codes.
_QUERY_RE = re.compile(r"\?[^\s\"']*")
# "/l/<token>", "/letters/<token>/open": the token is the only key to a private letter.
_LINK_RE = re.compile(r"/(l|letters)/[A-Za-z0-9_-]+")


def scrub_url(text: str) -> str:
    return _LINK_RE.sub(r"/\1/[link]", _QUERY_RE.sub("", text))


def scrub_breadcrumb(crumb: Any, _hint: Any = None) -> Any:
    if isinstance(crumb.get("message"), str):
        crumb["message"] = scrub_url(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        for key in ("url", "http.query", "http.fragment"):
            if isinstance(data.get(key), str):
                data[key] = scrub_url(data[key]) if key == "url" else ""
    return redact(crumb)


def scrub_event(event: Any, _hint: Any = None) -> Any:
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("cookies", None)
        request.pop("data", None)
        request.pop("query_string", None)  # private links and codes can live in URLs
        if isinstance(request.get("url"), str):
            request["url"] = scrub_url(request["url"])
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                k: v for k, v in headers.items() if k.lower() not in _DROP_HEADERS
            }
    if isinstance(event.get("transaction"), str):
        event["transaction"] = scrub_url(event["transaction"])
    user = event.get("user")
    if isinstance(user, dict):
        # Keep only the internal account id, never email or IP.
        event["user"] = {"id": user["id"]} if "id" in user else {}
    return redact(event)


def init_sentry(settings: Settings, component: str, transport: Any = None) -> bool:
    if settings.sentry_dsn is None:
        return False
    sentry_sdk.init(
        dsn=settings.sentry_dsn.get_secret_value(),
        environment=settings.environment,
        release=settings.app_version or None,
        server_name=component,
        # Personal data stays off: Sentry's default is to send none, and scrub_event enforces it.
        include_local_variables=False,
        # File, line and function are enough; source lines could quote sensitive text.
        include_source_context=False,
        max_request_body_size="never",
        traces_sample_rate=0.0,
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
        transport=transport,
    )
    logger.info("error reporting on", extra={"component": component})
    return True

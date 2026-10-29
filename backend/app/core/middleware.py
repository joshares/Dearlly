"""Request IDs, security headers, access logs and generic error responses (pure ASGI)."""

import json
import logging
import re
import time
import uuid
from collections.abc import Iterable

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import request_id_var

logger = logging.getLogger("dearlly.access")

REQUEST_ID_HEADER = "X-Request-ID"
# Accept a caller's request ID only if it is short and boring; otherwise make our own.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")

# The API only returns JSON, so it can use the strictest CSP.
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


def security_headers(*, production: bool, path: str) -> dict[str, str]:
    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
        "Cache-Control": "no-store",
    }
    # Swagger UI (development only) needs scripts, so it skips the API CSP.
    if not path.startswith(DOCS_PATHS):
        headers["Content-Security-Policy"] = API_CSP
    if production:
        headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    return headers


def _incoming_request_id(raw_headers: Iterable[tuple[bytes, bytes]]) -> str:
    for name, value in raw_headers:
        if name.lower() == REQUEST_ID_HEADER.lower().encode():
            candidate = value.decode("latin-1")
            if _SAFE_REQUEST_ID.match(candidate):
                return candidate
    return uuid.uuid4().hex


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, production: bool) -> None:
        self.app = app
        self.production = production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope.get("headers", []))
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                headers = MutableHeaders(scope=message)
                if "server" in headers:
                    del headers["server"]
                headers[REQUEST_ID_HEADER] = request_id
                for name, value in security_headers(
                    production=self.production, path=scope["path"]
                ).items():
                    headers.setdefault(name, value)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("unhandled error")
            if response_started:
                raise
            # Generic body: never leak stack traces or internals to the caller.
            await send_wrapper(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            body = {"detail": "Internal server error", "request_id": request_id}
            await send({"type": "http.response.body", "body": json.dumps(body).encode()})
        finally:
            route = scope.get("route")
            # Log the route template, not the raw path, so private link tokens stay out of logs.
            path = getattr(route, "path", None) or "unmatched"
            logger.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": path,
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            request_id_var.reset(token)

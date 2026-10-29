"""CSRF protection: double-submit cookie.

The browser gets a random token both as a cookie and in a JSON body (GET /auth/csrf). Every
state-changing request must echo it in the X-CSRF-Token header. Another site can make the browser
send our cookie, but can't read it to put it in the header.
"""

from fastapi import HTTPException, Request, Response, status

from app.core.config import Settings
from app.core.security import constant_time_equals, new_token

CSRF_COOKIE = "dl_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CSRF_MAX_AGE_SECONDS = 60 * 60 * 24 * 7


def issue_csrf_token(response: Response, settings: Settings) -> str:
    token = new_token()
    response.set_cookie(
        CSRF_COOKIE,
        token,
        max_age=CSRF_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return token


async def require_csrf(request: Request) -> None:
    if request.method in SAFE_METHODS:
        return
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get(CSRF_HEADER, "")
    if not cookie or not header or not constant_time_equals(cookie, header):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Security check failed. Refresh the page and try again.",
        )

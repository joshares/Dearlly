""" "Stop messages from this sender" and "Never email me again", from the links in letter emails.

The signed token in the link is the only key (it names a fingerprint of the address, never the
address), so these need no account and no CSRF token: Gmail's one-click unsubscribe posts here
directly.
"""

import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.api.deps import AppSettings, DbSession, Limiter
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.core.security import InvalidTokenError
from app.models import User
from app.services import letter_mail

router = APIRouter(prefix="/email", tags=["email"])

PREFS_PER_IP = Limit("email-prefs-ip", max_requests=30, window_seconds=60)
EXPIRED = "This link has expired. Use the link in a newer email."


class StopInfo(BaseModel):
    sender: str


class StopIn(BaseModel):
    scope: Literal["sender", "all"]


async def _read(
    request: Request, settings: AppSettings, limiter: Limiter, token: str
) -> tuple[str, uuid.UUID]:
    await limiter.hit(PREFS_PER_IP, client_ip(request, settings))
    try:
        return letter_mail.read_unsubscribe_token(settings, token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=EXPIRED) from exc


@router.get("/unsubscribe/{token}")
async def stop_info(
    token: str, request: Request, db: DbSession, settings: AppSettings, limiter: Limiter
) -> StopInfo:
    _, sender_id = await _read(request, settings, limiter, token)
    if letter_mail.token_is_secret(settings, token):
        return StopInfo(sender="this secret admirer")
    sender = await db.get(User, sender_id)
    return StopInfo(sender=f"@{sender.username}" if sender else "this sender")


@router.post("/unsubscribe/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def stop(
    token: str,
    body: StopIn,
    request: Request,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
) -> None:
    email_hash, sender_id = await _read(request, settings, limiter, token)
    await letter_mail.block(db, email_hash, None if body.scope == "all" else sender_id)


@router.post("/one-click/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def one_click(
    token: str, request: Request, db: DbSession, settings: AppSettings, limiter: Limiter
) -> None:
    """RFC 8058 one-click unsubscribe from the mail app: stops this sender."""
    email_hash, sender_id = await _read(request, settings, limiter, token)
    await letter_mail.block(db, email_hash, sender_id)

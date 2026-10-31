"""Emailing a letter to the person it's for (who may not have an account).

Rules from the build plan:
- Only from verified accounts (every account is: sign-up always proves the email), at most
  EMAILS_PER_DAY a day per sender. Sharing the link has no cap.
- Every email carries Report, "Stop messages from this sender" and "Never email me again",
  plus one-click unsubscribe headers for Gmail and Yahoo.
- The address is used only to deliver that one letter: it's kept encrypted until the email
  goes out, then deleted. A keyed fingerprint stays so a "stop" request can be honoured.
- The email never quotes the letter: the words stay behind the wax seal.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.security import InvalidTokenError, decode_jwt, encode_jwt
from app.models import EmailBlock, Experience, User
from app.services import experiences as engine
from app.services.email import Email, EmailDeliveryError, send_email
from app.services.email_templates import Paragraph, letter_email

logger = logging.getLogger(__name__)

EMAILS_PER_DAY = 10
MAX_ATTEMPTS = 5
BATCH = 50
UNSUBSCRIBE_TTL = timedelta(days=400)


# --- "stop" links ------------------------------------------------------------------------------


def unsubscribe_token(
    settings: Settings, email_hash: str, sender_id: uuid.UUID, *, secret: bool = False
) -> str:
    extra: dict[str, object] = {"snd": str(sender_id)}
    if secret:
        extra["sec"] = True  # the "stop" page then says "this secret admirer", not their username
    return encode_jwt(settings, "unsubscribe", email_hash, UNSUBSCRIBE_TTL, **extra)


def token_is_secret(settings: Settings, token: str) -> bool:
    return bool(decode_jwt(settings, token, "unsubscribe").get("sec"))


def read_unsubscribe_token(settings: Settings, token: str) -> tuple[str, uuid.UUID]:
    payload = decode_jwt(settings, token, "unsubscribe")
    try:
        return str(payload["sub"]), uuid.UUID(str(payload["snd"]))
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError from exc


async def is_blocked(db: AsyncSession, email_hash: str, sender_id: uuid.UUID) -> bool:
    found = await db.execute(
        select(EmailBlock.id)
        .where(
            EmailBlock.email_hash == email_hash,
            or_(EmailBlock.sender_id.is_(None), EmailBlock.sender_id == sender_id),
        )
        .limit(1)
    )
    return found.first() is not None


async def block(db: AsyncSession, email_hash: str, sender_id: uuid.UUID | None) -> None:
    """Record a "stop" (sender_id) or "never" (None) request, once."""
    match = (
        EmailBlock.sender_id.is_(None) if sender_id is None else EmailBlock.sender_id == sender_id
    )
    exists = await db.execute(
        select(EmailBlock.id).where(EmailBlock.email_hash == email_hash, match).limit(1)
    )
    if exists.first() is None:
        db.add(EmailBlock(email_hash=email_hash, sender_id=sender_id))
    # Letters still waiting to be emailed to them are cancelled too.
    waiting = await db.execute(
        select(Experience).where(
            Experience.recipient_email_hash == email_hash,
            Experience.email_status == "scheduled",
            *([] if sender_id is None else [Experience.owner_id == sender_id]),
        )
    )
    for experience in waiting.scalars():
        forget_address(experience, "blocked")
    await db.commit()


def forget_address(experience: Experience, status: str) -> None:
    experience.recipient_email_encrypted = None
    experience.email_status = status


# --- the email -----------------------------------------------------------------------------------


def letter_invite_email(
    settings: Settings, experience: Experience, to: str, link_token: str, username: str
) -> Email:
    web = settings.public_web_url.rstrip("/")
    api = settings.public_api_url.rstrip("/")
    url = engine.letter_url(settings, link_token)
    secret = experience.anonymous and experience.revealed_at is None
    stop = unsubscribe_token(
        settings, experience.recipient_email_hash or "", experience.owner_id, secret=secret
    )
    name = experience.recipient_title or experience.recipient_name
    sender = engine.shown_sender(experience)
    links = [
        ("Report this letter", f"{url}?report=1"),
        ("Stop messages from this sender", f"{web}/unsubscribe?t={stop}"),
        ("Never email me again", f"{web}/unsubscribe?t={stop}&all=1"),
        ("Privacy", f"{web}/privacy"),
    ]
    by = "a secret admirer (Dearlly knows who they are)" if secret else f"@{username}"
    footer = (
        f"Sent through Dearlly by {by}, who typed in your email address. "
        "We use it only to deliver this letter, never for marketing. Dearlly is for adults 18+."
    )
    text = (
        f"Dear {name},\n\n"
        f"{sender} sealed a letter for you on Dearlly.\n"
        f"Break the seal here: {url}\n\n"
        "Only this link opens it, so keep this email to yourself.\n\n"
        "Yours, always — Dearlly\n\n"
        f"{footer}\n" + "".join(f"{label}: {link}\n" for label, link in links)
    )
    body = letter_email(
        title=f"{sender} sealed a letter for you",
        preheader="It's waiting behind a wax seal. Only this link opens it.",
        greeting=f"Dear {name},",
        heading=f"{sender} sealed a letter for you.",
        paragraphs=[
            Paragraph("It's waiting behind a wax seal on Dearlly. Tap below to break it."),
            Paragraph("Only this link opens it, so keep this email to yourself.", small=True),
        ],
        button=("Break the seal", url),
        footer=footer,
        footer_links=links,
    )
    return Email(
        to=to,
        subject=engine.experience_types()[experience.type].email_subject.replace(
            "{sender}", sender
        ),
        text=text,
        html=body,
        headers={
            "List-Unsubscribe": f"<{api}/email/one-click/{stop}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )


async def send_due_letter_emails(
    sessionmaker: async_sessionmaker[AsyncSession],
    http: httpx.AsyncClient,
    settings: Settings,
    now: datetime | None = None,
) -> int:
    """Emails every letter that is due (opened now, or its sealed-until time has come)."""
    now = now or datetime.now(UTC)
    sent = 0
    async with sessionmaker() as db:
        due = await db.execute(
            select(Experience)
            .where(
                Experience.email_status == "scheduled",
                Experience.revoked_at.is_(None),
                or_(Experience.opens_at.is_(None), Experience.opens_at <= now),
            )
            .order_by(Experience.created_at)
            .limit(BATCH)
            # Two workers never send the same email.
            .with_for_update(skip_locked=True)
        )
        for experience in due.scalars().all():
            to = engine.decrypt_email(settings, experience.recipient_email_encrypted or "")
            link_token = engine.decrypt_token(settings, experience.token_encrypted)
            owner = await db.get(User, experience.owner_id)
            if not to or not link_token or owner is None:
                forget_address(experience, "failed")
                continue
            if await is_blocked(db, experience.recipient_email_hash or "", experience.owner_id):
                forget_address(experience, "blocked")
                continue
            email = letter_invite_email(settings, experience, to, link_token, owner.username)
            try:
                await send_email(http, settings, email)
            except EmailDeliveryError:
                experience.email_attempts += 1
                if experience.email_attempts >= MAX_ATTEMPTS:
                    forget_address(experience, "failed")
                logger.warning(
                    "letter email not sent", extra={"attempt": experience.email_attempts}
                )
                continue
            forget_address(experience, "sent")
            experience.email_sent_at = datetime.now(UTC)
            sent += 1
        await db.commit()
    return sent

"""Love notes, date and vacation invitations (later gifts): create, list, revoke; open, reply."""

import contextlib
import logging
import math
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import AppSettings, CurrentUser, DbSession, Limiter, current_user
from app.api.photos import PhotoOut, photo_out
from app.core.csrf import require_csrf
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.models import Experience, Photo, Report, User
from app.services import experiences as engine
from app.services import letter_mail
from app.services.email import Email, EmailDeliveryError, send_email
from app.services.profiles import ProfileFieldError, normalize_email

logger = logging.getLogger(__name__)

router = APIRouter(tags=["experiences"], dependencies=[Depends(require_csrf)])

CREATE_PER_USER = Limit("experience-create-user", max_requests=30, window_seconds=24 * 3600)
LETTER_PER_IP = Limit("letter-view-ip", max_requests=120, window_seconds=60)
REPLY_PER_IP = Limit("letter-reply-ip", max_requests=10, window_seconds=3600)
REPORT_PER_IP = Limit("letter-report-ip", max_requests=5, window_seconds=3600)
REPORT_REASONS = ("harassment", "scam", "sexual", "hate", "spam", "other")
MAX_SCHEDULE_AHEAD = timedelta(days=366)

NOT_FOUND = "This letter doesn't exist or was taken back by the sender."
# Private letters must never be indexed or cached by anyone in between.
PRIVATE_HEADERS = {"X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store"}


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def optional_user(request: Request, db: DbSession, settings: AppSettings) -> User | None:
    try:
        return await current_user(request, db, settings)
    except HTTPException:
        return None


OptionalUser = Annotated[User | None, Depends(optional_user)]


# --- shapes ----------------------------------------------------------------------------------


class Reaction(BaseModel):
    key: str
    label: str


class ExperienceTypeOut(BaseModel):
    key: str
    name: str
    fields: dict[str, dict[str, Any]]
    themes: list[str]
    reply: str
    reactions: list[Reaction]


class QuoteOut(BaseModel):
    key: str
    mood: str
    title: str
    text: str


class CreateIn(BaseModel):
    type: str = Field(max_length=32)
    sender_name: str = Field(max_length=120)
    recipient_name: str = Field(max_length=120)
    recipient_title: str | None = Field(default=None, max_length=120)
    theme: str = Field(max_length=32)
    content: dict[str, str | None]
    opens_at: AwareDatetime | None = None
    # Optional: email them the link (when it opens, for scheduled letters).
    recipient_email: str | None = Field(default=None, max_length=254)
    # Secret admirer: they see "A secret admirer" until the sender reveals their name.
    secret: bool = False


class ReplyOut(BaseModel):
    reaction: str
    note: str | None
    replied_at: datetime


class MyExperienceOut(BaseModel):
    id: uuid.UUID
    type: str
    url: str | None
    sender_name: str
    recipient_name: str
    recipient_title: str | None
    theme: str
    content: dict[str, Any]
    created_at: datetime
    opens_at: datetime | None
    first_opened_at: datetime | None
    open_count: int
    reply: ReplyOut | None
    revoked: bool
    email_status: str | None
    email_sent_at: datetime | None
    secret: bool
    revealed: bool
    blocked: bool


class MyExperiencesPage(BaseModel):
    items: list[MyExperienceOut]
    total: int
    page: int
    per_page: int


class LetterOut(BaseModel):
    status: Literal["ready", "sealed_until"]
    type: str
    sender_name: str
    recipient_name: str
    recipient_title: str | None
    theme: str
    opens_at: datetime | None
    # Counted by the server, so a phone whose clock is wrong still opens on time.
    opens_in_seconds: int
    content: dict[str, Any] | None
    reply_kind: str
    # Signed links to the letter's photo (full and phone sizes), once it's open.
    photo: PhotoOut | None
    reactions: list[Reaction]
    reply: ReplyOut | None
    is_sender: bool
    # From a secret admirer who hasn't revealed their name (sender_name is then "A secret admirer").
    secret: bool


class ReplyIn(BaseModel):
    reaction: str = Field(max_length=32)
    note: str | None = Field(default=None, max_length=600)


def _reply(e: Experience) -> ReplyOut | None:
    if e.reply_reaction is None or e.replied_at is None:
        return None
    return ReplyOut(reaction=e.reply_reaction, note=e.reply_note, replied_at=e.replied_at)


def _mine(e: Experience, settings: AppSettings) -> MyExperienceOut:
    token = engine.decrypt_token(settings, e.token_encrypted)
    return MyExperienceOut(
        id=e.id,
        type=e.type,
        # A taken-back or blocked letter's link no longer opens anything.
        url=(
            engine.letter_url(settings, token)
            if token and e.revoked_at is None and e.blocked_at is None
            else None
        ),
        sender_name=e.sender_name,
        recipient_name=e.recipient_name,
        recipient_title=e.recipient_title,
        theme=e.theme,
        content=e.content,
        created_at=e.created_at,
        opens_at=e.opens_at,
        first_opened_at=e.first_opened_at,
        open_count=e.open_count,
        reply=_reply(e),
        revoked=e.revoked_at is not None,
        email_status=e.email_status,
        email_sent_at=e.email_sent_at,
        secret=e.anonymous,
        revealed=e.revealed_at is not None,
        blocked=e.blocked_at is not None,
    )


# --- catalogue -------------------------------------------------------------------------------


@router.get("/experience-types")
async def list_types() -> list[ExperienceTypeOut]:
    return [
        ExperienceTypeOut(
            key=t.key,
            name=t.name,
            fields={
                f.key: {"max": f.max, "required": f.required, "kind": f.kind} for f in t.fields
            },
            themes=list(t.themes),
            reply=t.reply,
            reactions=[Reaction(key=k, label=label) for k, label in t.reactions],
        )
        for t in engine.experience_types().values()
    ]


@router.get("/quotes")
async def list_quotes(mood: str | None = None) -> list[QuoteOut]:
    return [QuoteOut(**q) for q in engine.quotes() if mood is None or q["mood"] == mood]


# --- the sender's side (account required) ----------------------------------------------------


@router.post("/experiences", status_code=status.HTTP_201_CREATED)
async def create_experience(
    body: CreateIn, user: CurrentUser, db: DbSession, settings: AppSettings, limiter: Limiter
) -> MyExperienceOut:
    await limiter.hit(CREATE_PER_USER, str(user.id))
    kind = engine.experience_types().get(body.type)
    if kind is None:
        raise _bad("Unknown experience type.")
    if body.secret and not kind.secret_admirer:
        raise _bad("Only love notes can be sent as a secret admirer.")
    if body.theme not in kind.themes:
        raise _bad("Unknown theme.")
    now = datetime.now(UTC)
    if body.opens_at is not None and not now < body.opens_at <= now + MAX_SCHEDULE_AHEAD:
        raise _bad("Pick an opening time in the future, within a year.")
    try:
        content = engine.validate_content(kind, body.content, now)
        date_at = content.get("date_at")
        if date_at and body.opens_at and datetime.fromisoformat(date_at) <= body.opens_at:
            raise engine.ExperienceError("The date has to be after the invitation opens.")
        trip = content.get("start_date")
        if (
            trip
            and body.opens_at
            and date.fromisoformat(trip) < (body.opens_at + engine.WAT).date()
        ):
            raise engine.ExperienceError("The trip has to start after the invitation opens.")
        sender = engine.clean_text(
            body.sender_name, label="Your name", max_len=engine.NAME_MAX, required=True
        )
        recipient = engine.clean_text(
            body.recipient_name, label="Their name", max_len=engine.NAME_MAX, required=True
        )
        title = engine.clean_text(
            body.recipient_title,
            label="What you call them",
            max_len=engine.TITLE_MAX,
            required=False,
        )
    except engine.ExperienceError as exc:
        raise _bad(str(exc)) from exc

    if body.secret:
        await _check_secret(db, user, content)
    photo = await _own_free_photo(db, settings, user, content.get("photo"))
    email_fields = await _email_fields(db, settings, user, body.recipient_email)
    token = engine.new_link_token()
    experience = Experience(
        **email_fields,
        type=kind.key,
        owner_id=user.id,
        token_hash=engine.link_hash(token),
        token_encrypted=engine.encrypt_token(settings, token),
        sender_name=sender or "",
        recipient_name=recipient or "",
        recipient_title=title,
        theme=body.theme,
        content=content,
        opens_at=body.opens_at,
        anonymous=body.secret,
    )
    db.add(experience)
    if photo is not None:
        await db.flush()
        photo.experience_id = experience.id
    await db.commit()
    await db.refresh(experience)
    return _mine(experience, settings)


async def _check_secret(db: DbSession, user: User, content: dict[str, str]) -> None:
    """Secret admirer limits: no photos, 3 a day, off after 3 blocks."""
    if content.get("photo"):
        raise _bad("Secret admirer letters can't have photos. Remove the photo to send it.")
    mine = (Experience.owner_id == user.id, Experience.anonymous.is_(True))
    blocks = (
        await db.execute(
            select(func.count())
            .select_from(Experience)
            .where(*mine, Experience.blocked_at.is_not(None))
        )
    ).scalar_one()
    if blocks >= engine.ADMIRER_BLOCKS_LIMIT:
        raise _bad(
            "Secret admirer is switched off for your account because people blocked your letters. "
            "You can still send letters with your name."
        )
    since = datetime.now(UTC) - timedelta(days=1)
    today = (
        await db.execute(
            select(func.count()).select_from(Experience).where(*mine, Experience.created_at > since)
        )
    ).scalar_one()
    if today >= engine.ADMIRER_PER_DAY:
        raise _bad(
            f"You can send up to {engine.ADMIRER_PER_DAY} secret admirer letters a day. "
            "Try again tomorrow, or send it with your name."
        )


async def _own_free_photo(
    db: DbSession, settings: AppSettings, user: User, photo_id: str | None
) -> Photo | None:
    """The writer's own photo, not yet on another letter."""
    if photo_id is None:
        return None
    if not settings.photos_enabled:
        raise _bad("Photos aren't switched on yet. Remove the photo to send it.")
    photo = await db.get(Photo, uuid.UUID(photo_id))
    if (
        photo is None
        or photo.owner_id != user.id
        or photo.experience_id is not None
        or photo.post_id is not None
    ):
        raise _bad("That photo can't be used. Add it again.")
    return photo


async def _email_fields(
    db: DbSession, settings: AppSettings, user: User, raw: str | None
) -> dict[str, Any]:
    """Checks an optional recipient email and prepares it (encrypted) for the worker to send."""
    if raw is None or not raw.strip():
        return {}
    try:
        email = normalize_email(raw)
    except ProfileFieldError as exc:
        raise _bad("Their email doesn't look right. Check it, or leave it empty.") from exc
    since = datetime.now(UTC) - timedelta(days=1)
    emailed_today = (
        await db.execute(
            select(func.count())
            .select_from(Experience)
            .where(
                Experience.owner_id == user.id,
                Experience.email_status.is_not(None),
                Experience.created_at > since,
            )
        )
    ).scalar_one()
    if emailed_today >= letter_mail.EMAILS_PER_DAY:
        raise _bad(
            f"You can email up to {letter_mail.EMAILS_PER_DAY} letters a day. "
            "Leave their email empty and share the link instead."
        )
    fingerprint = engine.email_fingerprint(settings, email)
    if await letter_mail.is_blocked(db, fingerprint, user.id):
        # They asked not to be emailed; the sender can still share the link themselves.
        return {"recipient_email_hash": fingerprint, "email_status": "blocked"}
    return {
        "recipient_email_hash": fingerprint,
        "recipient_email_encrypted": engine.encrypt_email(settings, email),
        "email_status": "scheduled",
    }


@router.get("/me/experiences")
async def my_experiences(
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    per_page: Annotated[int, Query(ge=1, le=50)] = 10,
) -> MyExperiencesPage:
    """The sender's letters, newest first, one page at a time."""
    mine = Experience.owner_id == user.id
    total = (
        await db.execute(select(func.count()).select_from(Experience).where(mine))
    ).scalar_one()
    rows = (
        await db.execute(
            select(Experience)
            .where(mine)
            .order_by(Experience.created_at.desc(), Experience.id.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
        )
    ).scalars()
    return MyExperiencesPage(
        items=[_mine(e, settings) for e in rows], total=total, page=page, per_page=per_page
    )


@router.post("/me/experiences/{experience_id}/revoke")
async def revoke_experience(
    experience_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings
) -> MyExperienceOut:
    experience = await db.get(Experience, experience_id)
    if experience is None or experience.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if experience.revoked_at is None:
        experience.revoked_at = datetime.now(UTC)
        if experience.email_status == "scheduled":
            letter_mail.forget_address(experience, "cancelled")
        await db.commit()
    return _mine(experience, settings)


@router.post("/me/experiences/{experience_id}/reveal")
async def reveal_name(
    experience_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings
) -> MyExperienceOut:
    """A secret admirer shows their name: from now on the letter is signed with it."""
    experience = await db.get(Experience, experience_id)
    if experience is None or experience.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if not experience.anonymous:
        raise _bad("This letter already has your name.")
    if experience.blocked_at is not None or experience.revoked_at is not None:
        raise _bad("This letter can't be opened any more.")
    if experience.revealed_at is None:
        experience.revealed_at = datetime.now(UTC)
        await db.commit()
    return _mine(experience, settings)


# --- the recipient's side (no account needed; the link is the key) ---------------------------


async def _by_token(db: DbSession, token: str) -> Experience:
    if not 20 <= len(token) <= 64:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    experience = (
        await db.execute(select(Experience).where(Experience.token_hash == engine.link_hash(token)))
    ).scalar_one_or_none()
    if experience is None or experience.revoked_at is not None or experience.blocked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND, headers=PRIVATE_HEADERS
        )
    return experience


async def _letter_photo(db: DbSession, settings: AppSettings, e: Experience) -> PhotoOut | None:
    photo_id = e.content.get("photo")
    photo = await db.get(Photo, uuid.UUID(photo_id)) if photo_id else None
    return photo_out(settings, photo) if photo is not None else None


def _is_sealed(e: Experience) -> bool:
    return e.opens_at is not None and e.opens_at > datetime.now(UTC)


@router.get("/letters/{token}")
async def view_letter(
    token: str,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
    viewer: OptionalUser,
) -> LetterOut:
    """Shows the letter. Viewing doesn't count as Opened (link previews would trigger it)."""
    await limiter.hit(LETTER_PER_IP, client_ip(request, settings))
    response.headers.update(PRIVATE_HEADERS)
    e = await _by_token(db, token)
    kind = engine.experience_types()[e.type]
    sealed = _is_sealed(e)
    is_sender = viewer is not None and viewer.id == e.owner_id
    return LetterOut(
        status="sealed_until" if sealed else "ready",
        type=e.type,
        sender_name=engine.shown_sender(e, to_sender=is_sender),
        recipient_name=e.recipient_name,
        recipient_title=e.recipient_title,
        theme=e.theme,
        opens_at=e.opens_at,
        opens_in_seconds=(
            max(1, math.ceil((e.opens_at - datetime.now(UTC)).total_seconds()))
            if sealed and e.opens_at
            else 0
        ),
        content=None if sealed else e.content,
        reply_kind=kind.reply,
        photo=await _letter_photo(db, settings, e) if not sealed else None,
        reactions=[Reaction(key=k, label=label) for k, label in kind.reactions],
        reply=_reply(e),
        is_sender=is_sender,
        secret=e.anonymous and e.revealed_at is None,
    )


@router.post("/letters/{token}/open", status_code=status.HTTP_204_NO_CONTENT)
async def open_letter(
    token: str,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
    viewer: OptionalUser,
) -> None:
    """Called when the recipient breaks the seal: this is what the sender sees as Opened."""
    await limiter.hit(LETTER_PER_IP, client_ip(request, settings))
    response.headers.update(PRIVATE_HEADERS)
    e = await _by_token(db, token)
    if _is_sealed(e) or (viewer is not None and viewer.id == e.owner_id):
        return  # previews by the sender don't count
    now = datetime.now(UTC)
    e.first_opened_at = e.first_opened_at or now
    e.last_opened_at = now
    e.open_count += 1
    await db.commit()


@router.post("/letters/{token}/reply")
async def reply_to_letter(
    token: str,
    body: ReplyIn,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
    viewer: OptionalUser,
) -> ReplyOut:
    await limiter.hit(REPLY_PER_IP, client_ip(request, settings))
    response.headers.update(PRIVATE_HEADERS)
    e = await _by_token(db, token)
    if _is_sealed(e):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This letter isn't open yet."
        )
    if viewer is not None and viewer.id == e.owner_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You can't reply to your own letter."
        )
    if e.replied_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A reply has already been sealed."
        )
    kind = engine.experience_types()[e.type]
    if body.reaction not in {key for key, _ in kind.reactions}:
        raise _bad("Pick one of the reactions.")
    try:
        note = engine.clean_text(
            body.note, label="Your note", max_len=engine.REPLY_NOTE_MAX, required=False
        )
    except engine.ExperienceError as exc:
        raise _bad(str(exc)) from exc
    now = datetime.now(UTC)
    e.reply_reaction, e.reply_note, e.replied_at = body.reaction, note, now
    e.first_opened_at = e.first_opened_at or now
    await db.commit()
    return ReplyOut(reaction=body.reaction, note=note, replied_at=now)


@router.post("/letters/{token}/block", status_code=status.HTTP_204_NO_CONTENT)
async def block_secret_admirer(
    token: str,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
    viewer: OptionalUser,
) -> None:
    """One tap: the secret admirer's letter is gone for good, and if it came by email, they can't
    email this address again. Enough blocks switch secret admirer mode off for the sender."""
    await limiter.hit(REPORT_PER_IP, client_ip(request, settings))
    response.headers.update(PRIVATE_HEADERS)
    e = await _by_token(db, token)
    if not e.anonymous:
        raise _bad("Only secret admirer letters can be blocked here. You can report it instead.")
    if viewer is not None and viewer.id == e.owner_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You can't block your own letter."
        )
    e.blocked_at = datetime.now(UTC)
    if e.email_status == "scheduled":
        letter_mail.forget_address(e, "blocked")
    await db.commit()
    if e.recipient_email_hash:
        await letter_mail.block(db, e.recipient_email_hash, e.owner_id)
    logger.info("secret admirer blocked", extra={"experience_id": str(e.id)})


class ReportIn(BaseModel):
    reason: str = Field(max_length=32)
    note: str | None = Field(default=None, max_length=280)


@router.post("/letters/{token}/report", status_code=status.HTTP_204_NO_CONTENT)
async def report_letter(
    token: str,
    body: ReportIn,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
) -> None:
    """The recipient flags a letter. It's saved and emailed to the founder to review."""
    await limiter.hit(REPORT_PER_IP, client_ip(request, settings))
    response.headers.update(PRIVATE_HEADERS)
    e = await _by_token(db, token)
    if body.reason not in REPORT_REASONS:
        raise _bad("Pick a reason.")
    try:
        note = engine.clean_text(body.note, label="Your note", max_len=280, required=False)
    except engine.ExperienceError as exc:
        raise _bad(str(exc)) from exc
    report = Report(experience_id=e.id, sender_id=e.owner_id, reason=body.reason, note=note)
    db.add(report)
    await db.commit()
    owner = await db.get(User, e.owner_id)
    letter_text = "\n".join(f"{k}: {v}" for k, v in e.content.items())
    text = (
        f"Reason: {body.reason}\nNote: {note or '-'}\n\n"
        f"Report: {report.id}\nLetter: {e.id}\n"
        f"Sender: @{owner.username if owner else '(deleted)'} ({e.owner_id})\n"
        f"Signed as: {e.sender_name}{' (sent as a secret admirer)' if e.anonymous else ''}\n"
        f"To: {e.recipient_name}\n\n{letter_text}\n\n"
        f"Review it, take it down or dismiss it: {settings.public_web_url.rstrip('/')}/admin\n\n"
        "Or take it down from your Mac (its link stops working for good):\n"
        f"  ssh -t dearlly docker exec dearlly-api-1 python -m app.admin takedown {e.id}\n"
    )
    # Saved in the database either way; the email is the founder's nudge to look.
    with contextlib.suppress(EmailDeliveryError):
        await send_email(
            request.app.state.http,
            settings,
            Email(
                to=settings.reports_to, subject=f"Dearlly report: {body.reason}", text=text, html=""
            ),
        )

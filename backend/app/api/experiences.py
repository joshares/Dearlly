"""Love notes (and later dates, vacations, gifts): create, list, revoke; open and reply by link."""

import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import AppSettings, CurrentUser, DbSession, Limiter, current_user
from app.core.csrf import require_csrf
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.models import Experience, User
from app.services import experiences as engine

router = APIRouter(tags=["experiences"], dependencies=[Depends(require_csrf)])

CREATE_PER_USER = Limit("experience-create-user", max_requests=30, window_seconds=24 * 3600)
LETTER_PER_IP = Limit("letter-view-ip", max_requests=120, window_seconds=60)
REPLY_PER_IP = Limit("letter-reply-ip", max_requests=10, window_seconds=3600)
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
    reactions: list[Reaction]
    reply: ReplyOut | None
    is_sender: bool


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
        url=engine.letter_url(settings, token) if token and e.revoked_at is None else None,
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
    )


# --- catalogue -------------------------------------------------------------------------------


@router.get("/experience-types")
async def list_types() -> list[ExperienceTypeOut]:
    return [
        ExperienceTypeOut(
            key=t.key,
            name=t.name,
            fields={f.key: {"max": f.max, "required": f.required} for f in t.fields},
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
    if body.theme not in kind.themes:
        raise _bad("Unknown theme.")
    now = datetime.now(UTC)
    if body.opens_at is not None and not now < body.opens_at <= now + MAX_SCHEDULE_AHEAD:
        raise _bad("Pick an opening time in the future, within a year.")
    try:
        content = engine.validate_content(kind, body.content)
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

    token = engine.new_link_token()
    experience = Experience(
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
    )
    db.add(experience)
    await db.commit()
    await db.refresh(experience)
    return _mine(experience, settings)


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
        await db.commit()
    return _mine(experience, settings)


# --- the recipient's side (no account needed; the link is the key) ---------------------------


async def _by_token(db: DbSession, token: str) -> Experience:
    if not 20 <= len(token) <= 64:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    experience = (
        await db.execute(select(Experience).where(Experience.token_hash == engine.link_hash(token)))
    ).scalar_one_or_none()
    if experience is None or experience.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND, headers=PRIVATE_HEADERS
        )
    return experience


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
    return LetterOut(
        status="sealed_until" if sealed else "ready",
        type=e.type,
        sender_name=e.sender_name,
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
        reactions=[Reaction(key=k, label=label) for k, label in kind.reactions],
        reply=_reply(e),
        is_sender=viewer is not None and viewer.id == e.owner_id,
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

"""The admin page's API: how Dearlly is doing, reports to act on, game questions, and accounts.

Only accounts marked admin on the server (python -m app.admin make-admin <email>) get in; for
everyone else these addresses don't exist (404). Every action is logged with who did it.
"""

import logging
import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from app.api.community import posts_out, top_post, week_start
from app.api.deps import AppSettings, CurrentUser, DbSession
from app.api.photos import PhotoOut, photo_out
from app.core.csrf import require_csrf
from app.games.bank import bank
from app.models import Experience, Game, GameQuestionStat, Photo, Post, Report, TopPick, User
from app.services.letter_mail import forget_address

logger = logging.getLogger(__name__)


async def admin_user(user: CurrentUser) -> Any:
    if not user.is_admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")
    return user


Admin = Annotated[User, Depends(admin_user)]

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_csrf)])

PAGE = 50


# --- overview ---------------------------------------------------------------------------------


async def _count(db: DbSession, model: Any, *where: Any) -> int:
    return int(
        (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()
    )


@router.get("/overview")
async def overview(admin: Admin, db: DbSession) -> dict[str, Any]:
    now = datetime.now(UTC)
    week, day = now - timedelta(days=7), now - timedelta(days=1)
    letters_by_type = dict(
        (await db.execute(select(Experience.type, func.count()).group_by(Experience.type))).all()
    )
    letters = sum(letters_by_type.values())
    opened = await _count(db, Experience, Experience.first_opened_at.is_not(None))
    replied = await _count(db, Experience, Experience.replied_at.is_not(None))
    return {
        "users": {
            "total": await _count(db, User),
            "last_7_days": await _count(db, User, User.created_at > week),
            "last_24_hours": await _count(db, User, User.created_at > day),
        },
        "letters": {
            "total": letters,
            "last_7_days": await _count(db, Experience, Experience.created_at > week),
            "by_type": letters_by_type,
            "opened": opened,
            "replied": replied,
            "emailed": await _count(db, Experience, Experience.email_status == "sent"),
            "secret_admirer": await _count(db, Experience, Experience.anonymous.is_(True)),
            "taken_back": await _count(db, Experience, Experience.revoked_at.is_not(None)),
        },
        "games": {
            "total": await _count(db, Game),
            "finished": await _count(db, Game, Game.status == "ended"),
            "playing_now": await _count(db, Game, Game.status == "playing"),
            "last_7_days": await _count(db, Game, Game.created_at > week),
        },
        "photos": await _count(db, Photo, Photo.experience_id.is_not(None)),
        "open_reports": await _count(db, Report, Report.status == "open"),
    }


# --- reports ----------------------------------------------------------------------------------


class ReportLetter(BaseModel):
    id: uuid.UUID
    type: str
    sender_name: str
    recipient_name: str
    secret_admirer: bool
    content: dict[str, Any]
    photo: PhotoOut | None
    created_at: datetime
    taken_down: bool


class ReportPost(BaseModel):
    id: uuid.UUID
    author: str
    caption: str
    photo: PhotoOut | None
    like_count: int
    created_at: datetime
    removed: bool


class ReportOut(BaseModel):
    id: uuid.UUID
    reason: str
    note: str | None
    created_at: datetime
    status: str
    resolution: str | None
    letter: ReportLetter | None
    post: ReportPost | None = None
    sender: str | None
    sender_reports: int


@router.get("/reports")
async def reports(
    admin: Admin,
    db: DbSession,
    settings: AppSettings,
    show: Literal["open", "resolved"] = "open",
) -> list[ReportOut]:
    rows = (
        await db.execute(
            select(Report)
            .where(Report.status == show)
            .order_by(Report.created_at.desc())
            .limit(100)
        )
    ).scalars()
    out = []
    for report in rows:
        letter = await db.get(Experience, report.experience_id) if report.experience_id else None
        sender = await db.get(User, report.sender_id) if report.sender_id else None
        post = await db.get(Post, report.post_id) if report.post_id else None
        post_photo = None
        if post is not None:
            found_photo = (
                await db.execute(select(Photo).where(Photo.post_id == post.id))
            ).scalar_one_or_none()
            post_photo = photo_out(settings, found_photo) if found_photo else None
        photo = None
        if letter is not None and letter.content.get("photo"):
            found = await db.get(Photo, uuid.UUID(letter.content["photo"]))
            photo = photo_out(settings, found) if found else None
        out.append(
            ReportOut(
                id=report.id,
                reason=report.reason,
                note=report.note,
                created_at=report.created_at,
                status=report.status,
                resolution=report.resolution,
                letter=ReportLetter(
                    id=letter.id,
                    type=letter.type,
                    sender_name=letter.sender_name,
                    recipient_name=letter.recipient_name,
                    secret_admirer=letter.anonymous,
                    content={k: v for k, v in letter.content.items() if k != "photo"},
                    photo=photo,
                    created_at=letter.created_at,
                    taken_down=letter.revoked_at is not None,
                )
                if letter
                else None,
                post=ReportPost(
                    id=post.id,
                    author=f"@{sender.username}" if sender else "deleted",
                    caption=post.caption,
                    photo=post_photo,
                    like_count=post.like_count,
                    created_at=post.created_at,
                    removed=post.removed_at is not None,
                )
                if post
                else None,
                sender=f"@{sender.username}" if sender else None,
                sender_reports=await _count(db, Report, Report.sender_id == report.sender_id)
                if report.sender_id
                else 0,
            )
        )
    return out


async def _report(db: DbSession, report_id: uuid.UUID) -> Report:
    report = await db.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such report.")
    return report


@router.post("/reports/{report_id}/takedown", status_code=status.HTTP_204_NO_CONTENT)
async def take_down(report_id: uuid.UUID, admin: Admin, db: DbSession) -> None:
    """The reported letter's link stops working (or the post is removed); every open report on it
    is closed."""
    report = await _report(db, report_id)
    now = datetime.now(UTC)
    if report.post_id is not None:
        post = await db.get(Post, report.post_id)
        if post is not None:
            post.removed_at = post.removed_at or now
        await db.execute(
            update(Report)
            .where(Report.post_id == report.post_id, Report.status == "open")
            .values(status="resolved", resolution="taken_down", resolved_at=now)
        )
    if report.experience_id is not None:
        letter = await db.get(Experience, report.experience_id)
        if letter is not None:
            letter.revoked_at = letter.revoked_at or now
            if letter.email_status == "scheduled":
                forget_address(letter, "cancelled")
        await db.execute(
            update(Report)
            .where(Report.experience_id == report.experience_id, Report.status == "open")
            .values(status="resolved", resolution="taken_down", resolved_at=now)
        )
    report.status, report.resolution, report.resolved_at = "resolved", "taken_down", now
    await db.commit()
    logger.info(
        "admin took down a letter", extra={"admin": str(admin.id), "report": str(report.id)}
    )


@router.post("/reports/{report_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss(report_id: uuid.UUID, admin: Admin, db: DbSession) -> None:
    report = await _report(db, report_id)
    report.status, report.resolution = "resolved", "dismissed"
    report.resolved_at = datetime.now(UTC)
    await db.commit()
    logger.info(
        "admin dismissed a report", extra={"admin": str(admin.id), "report": str(report.id)}
    )


# --- game questions ---------------------------------------------------------------------------


class QuestionOut(BaseModel):
    key: str
    game: str
    text: str
    options: list[str]
    levels: list[str]
    depth: int
    shown: int
    skipped: int
    thumbs_up: int
    thumbs_down: int
    retired: bool
    # Higher = weaker: skips and 👎 count against it, 👍 for it, per time shown.
    weakness: float


class QuestionsPage(BaseModel):
    items: list[QuestionOut]
    total: int
    page: int
    pages: int


def _weakness(shown: int, skipped: int, up: int, down: int) -> float:
    if shown == 0:
        return 0.0
    return round((skipped + 2 * down - up) / shown, 3)


@router.get("/questions")
async def questions(
    admin: Admin,
    db: DbSession,
    game: str | None = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    sort: Literal["weakest", "most_shown", "most_skipped", "most_disliked", "retired"] = "weakest",
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
) -> QuestionsPage:
    stats = {s.question_key: s for s in (await db.execute(select(GameQuestionStat))).scalars()}
    games = bank()
    rows = []
    for question in games.questions.values():
        if game and question.format != game:
            continue
        if q and q.lower() not in question.text.lower():
            continue
        s = stats.get(question.key)
        shown, skipped = (s.shown, s.skipped) if s else (0, 0)
        up, down = (s.thumbs_up, s.thumbs_down) if s else (0, 0)
        retired = bool(s and s.retired)
        if sort == "retired" and not retired:
            continue
        rows.append(
            QuestionOut(
                key=question.key,
                game=games.formats[question.format].name,
                text=question.text,
                options=[o.text for o in question.options],
                levels=list(question.levels),
                depth=question.depth,
                shown=shown,
                skipped=skipped,
                thumbs_up=up,
                thumbs_down=down,
                retired=retired,
                weakness=_weakness(shown, skipped, up, down),
            )
        )
    order = {
        "weakest": lambda r: (-r.weakness, -r.shown),
        "most_shown": lambda r: (-r.shown, r.key),
        "most_skipped": lambda r: (-r.skipped, r.key),
        "most_disliked": lambda r: (-r.thumbs_down, r.key),
        "retired": lambda r: (r.game, r.key),
    }[sort]
    rows.sort(key=order)
    pages = max(1, math.ceil(len(rows) / PAGE))
    return QuestionsPage(
        items=rows[(page - 1) * PAGE : page * PAGE], total=len(rows), page=page, pages=pages
    )


class RetireIn(BaseModel):
    retired: bool


@router.post("/questions/{key}/retired", status_code=status.HTTP_204_NO_CONTENT)
async def retire(key: str, body: RetireIn, admin: Admin, db: DbSession) -> None:
    """Retired questions are never dealt again (they stay in the files; this is reversible)."""
    question = bank().questions.get(key)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such question.")
    await db.execute(
        insert(GameQuestionStat)
        .values(question_key=key, retired=body.retired)
        .on_conflict_do_update(index_elements=["question_key"], set_={"retired": body.retired})
    )
    await db.commit()
    logger.info(
        "admin retired a question" if body.retired else "admin restored a question",
        # Logged from our own question files and saved records, never the address typed in,
        # so a crafted address can't fake a log line.
        extra={"admin": str(admin.id), "question": question.key},
    )


# --- accounts ---------------------------------------------------------------------------------


class AccountOut(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str | None
    email: str
    created_at: datetime
    last_login_at: datetime | None
    is_admin: bool
    letters: int
    games: int
    reports_against: int
    secret_letters_blocked: int


@router.get("/users")
async def users(
    admin: Admin, db: DbSession, q: Annotated[str, Query(min_length=2, max_length=254)]
) -> list[AccountOut]:
    needle = f"%{q.strip().lower().lstrip('@')}%"
    found = (
        await db.execute(
            select(User)
            .where(or_(User.username.like(needle), User.email.like(needle)))
            .order_by(User.created_at.desc())
            .limit(20)
        )
    ).scalars()
    logger.info("admin searched accounts", extra={"admin": str(admin.id)})
    return [
        AccountOut(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            email=u.email,
            created_at=u.created_at,
            last_login_at=u.last_login_at,
            is_admin=u.is_admin,
            letters=await _count(db, Experience, Experience.owner_id == u.id),
            games=await _count(db, Game, or_(Game.host_id == u.id, Game.guest_id == u.id)),
            reports_against=await _count(db, Report, Report.sender_id == u.id),
            secret_letters_blocked=await _count(
                db,
                Experience,
                Experience.owner_id == u.id,
                Experience.anonymous.is_(True),
                Experience.blocked_at.is_not(None),
            ),
        )
        for u in found
    ]


# --- community --------------------------------------------------------------------------------


class AdminPostOut(BaseModel):
    id: uuid.UUID
    author: str
    caption: str
    photo: PhotoOut | None
    like_count: int
    reports: int
    created_at: datetime
    removed: bool
    top: bool


class AdminPostsPage(BaseModel):
    items: list[AdminPostOut]
    top_picked: bool
    page: int
    pages: int


@router.get("/posts")
async def admin_posts(
    admin: Admin,
    db: DbSession,
    settings: AppSettings,
    show: Literal["all", "this_week", "removed"] = "all",
    page: Annotated[int, Query(ge=1, le=1000)] = 1,
) -> AdminPostsPage:
    now = datetime.now(UTC)
    where: list[Any] = []
    if show == "removed":
        where.append(Post.removed_at.is_not(None))
    else:
        where.append(Post.removed_at.is_(None))
    if show == "this_week":
        where.append(Post.created_at > now - timedelta(days=7))
    order = (
        (Post.like_count.desc(), Post.created_at.desc())
        if show == "this_week"
        else (Post.created_at.desc(),)
    )
    total = await _count(db, Post, *where)
    rows = list(
        (
            await db.execute(
                select(Post).where(*where).order_by(*order).offset((page - 1) * PAGE).limit(PAGE)
            )
        ).scalars()
    )
    current, picked = await top_post(db, now)
    shown = await posts_out(db, settings, admin, rows)
    return AdminPostsPage(
        items=[
            AdminPostOut(
                id=post.id,
                author=f"@{out.author.username}",
                caption=post.caption,
                photo=out.photo,
                like_count=post.like_count,
                reports=await _count(db, Report, Report.post_id == post.id),
                created_at=post.created_at,
                removed=post.removed_at is not None,
                top=current is not None and current.id == post.id,
            )
            for post, out in zip(rows, shown, strict=True)
        ],
        top_picked=picked,
        page=page,
        pages=max(1, math.ceil(total / PAGE)),
    )


class RemoveIn(BaseModel):
    removed: bool


@router.post("/posts/{post_id}/removed", status_code=status.HTTP_204_NO_CONTENT)
async def remove_post(post_id: uuid.UUID, body: RemoveIn, admin: Admin, db: DbSession) -> None:
    """Hides a post everywhere (or brings it back). Kept, so repeat offenders can be spotted."""
    post = await db.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such post.")
    post.removed_at = datetime.now(UTC) if body.removed else None
    await db.commit()
    logger.info(
        "admin removed a post" if body.removed else "admin restored a post",
        extra={"admin": str(admin.id), "post": str(post.id)},
    )


class TopIn(BaseModel):
    post_id: uuid.UUID | None  # None: go back to "most likes"


@router.post("/top", status_code=status.HTTP_204_NO_CONTENT)
async def pick_top(body: TopIn, admin: Admin, db: DbSession) -> None:
    """The admin's top post for this week (Monday to Sunday, WAT), or back to most likes."""
    week = week_start(datetime.now(UTC))
    if body.post_id is None:
        pick = await db.get(TopPick, week)
        if pick is not None:
            await db.delete(pick)
        await db.commit()
        logger.info("admin cleared the top post", extra={"admin": str(admin.id)})
        return
    post = await db.get(Post, body.post_id)
    if post is None or post.removed_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such post.")
    await db.execute(
        insert(TopPick)
        .values(week_start=week, post_id=post.id, picked_by=admin.id)
        .on_conflict_do_update(
            index_elements=["week_start"], set_={"post_id": post.id, "picked_by": admin.id}
        )
    )
    await db.commit()
    logger.info("admin picked the top post", extra={"admin": str(admin.id), "post": str(post.id)})

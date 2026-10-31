"""Community ("Our Stamp"): members post a photo with a caption, like each other's, and see the top
post of the week. Only logged-in members can see any of it; nothing here is public or indexed.

- Photos go through the same upload as letters (cleaned of hidden data, nudity-checked first).
- Captions are plain text, no links (like letters).
- Top post of the week: the most-liked post from the last 7 days, unless an admin picked one for
  this week (Monday to Sunday, WAT).
"""

import contextlib
import logging
import uuid
from datetime import UTC, date, datetime, timedelta

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import AppSettings, CurrentUser, DbSession, Limiter
from app.api.photos import PhotoOut, photo_out
from app.core.csrf import require_csrf
from app.core.ratelimit import Limit
from app.models import Photo, Post, PostLike, Report, TopPick, User
from app.services import photos
from app.services.email import Email, EmailDeliveryError, send_email
from app.services.experiences import ExperienceError, clean_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/community", tags=["community"], dependencies=[Depends(require_csrf)])

POSTS_PER_USER = Limit("post-create-user", max_requests=10, window_seconds=24 * 3600)
LIKES_PER_USER = Limit("post-like-user", max_requests=300, window_seconds=3600)
REPORTS_PER_USER = Limit("post-report-user", max_requests=10, window_seconds=3600)
CAPTION_MAX = 280
PAGE = 20
TOP_WINDOW = timedelta(days=7)
WAT = timedelta(hours=1)
REPORT_REASONS = ("harassment", "scam", "sexual", "hate", "spam", "other")


class Author(BaseModel):
    username: str
    display_name: str | None


class PostOut(BaseModel):
    id: uuid.UUID
    author: Author
    caption: str
    photo: PhotoOut | None
    like_count: int
    liked: bool
    mine: bool
    created_at: datetime


class FeedOut(BaseModel):
    items: list[PostOut]
    # Pass back as ?before= for the next 20 (older) posts; None when there are no more.
    next_before: datetime | None


class TopOut(BaseModel):
    post: PostOut | None
    picked: bool  # chosen by the Dearlly team rather than by likes


class CreateIn(BaseModel):
    photo_id: uuid.UUID
    caption: str = Field(max_length=1000)


class ReportIn(BaseModel):
    reason: str = Field(max_length=32)
    note: str | None = Field(default=None, max_length=280)


def week_start(now: datetime) -> date:
    """Monday of this week, in WAT."""
    today = (now + WAT).date()
    return today - timedelta(days=today.weekday())


async def posts_out(
    db: DbSession, settings: AppSettings, viewer: User, posts: list[Post]
) -> list[PostOut]:
    if not posts:
        return []
    ids = [p.id for p in posts]
    authors = {
        u.id: u
        for u in (
            await db.execute(select(User).where(User.id.in_({p.author_id for p in posts})))
        ).scalars()
    }
    pictures = {
        ph.post_id: ph
        for ph in (await db.execute(select(Photo).where(Photo.post_id.in_(ids)))).scalars()
    }
    liked = set(
        (
            await db.execute(
                select(PostLike.post_id).where(
                    PostLike.post_id.in_(ids), PostLike.user_id == viewer.id
                )
            )
        ).scalars()
    )
    out = []
    for post in posts:
        author = authors.get(post.author_id)
        picture = pictures.get(post.id)
        out.append(
            PostOut(
                id=post.id,
                author=Author(
                    username=author.username if author else "deleted",
                    display_name=author.display_name if author else None,
                ),
                caption=post.caption,
                photo=photo_out(settings, picture) if picture else None,
                like_count=post.like_count,
                liked=post.id in liked,
                mine=post.author_id == viewer.id,
                created_at=post.created_at,
            )
        )
    return out


async def top_post(db: DbSession, now: datetime | None = None) -> tuple[Post | None, bool]:
    now = now or datetime.now(UTC)
    pick = await db.get(TopPick, week_start(now))
    if pick is not None:
        chosen = await db.get(Post, pick.post_id)
        if chosen is not None and chosen.removed_at is None:
            return chosen, True
    best = (
        await db.execute(
            select(Post)
            .where(
                Post.removed_at.is_(None),
                Post.created_at > now - TOP_WINDOW,
                Post.like_count > 0,
            )
            .order_by(Post.like_count.desc(), Post.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return best, False


async def _live_post(db: DbSession, post_id: uuid.UUID) -> Post:
    post = await db.get(Post, post_id)
    if post is None or post.removed_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This post isn't here any more.")
    return post


@router.get("/feed")
async def feed(
    user: CurrentUser, db: DbSession, settings: AppSettings, before: datetime | None = None
) -> FeedOut:
    query = select(Post).where(Post.removed_at.is_(None))
    if before is not None:
        query = query.where(Post.created_at < before)
    posts = list(
        (await db.execute(query.order_by(Post.created_at.desc()).limit(PAGE + 1))).scalars()
    )
    more = len(posts) > PAGE
    posts = posts[:PAGE]
    return FeedOut(
        items=await posts_out(db, settings, user, posts),
        next_before=posts[-1].created_at if more and posts else None,
    )


@router.get("/top")
async def top(user: CurrentUser, db: DbSession, settings: AppSettings) -> TopOut:
    post, picked = await top_post(db)
    items = await posts_out(db, settings, user, [post] if post else [])
    return TopOut(post=items[0] if items else None, picked=picked)


@router.post("/posts", status_code=status.HTTP_201_CREATED)
async def create_post(
    body: CreateIn, user: CurrentUser, db: DbSession, settings: AppSettings, limiter: Limiter
) -> PostOut:
    await limiter.hit(POSTS_PER_USER, str(user.id))
    try:
        caption = clean_text(body.caption, label="Caption", max_len=CAPTION_MAX, required=True)
    except ExperienceError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    photo = await db.get(Photo, body.photo_id)
    if (
        photo is None
        or photo.owner_id != user.id
        or photo.experience_id is not None
        or photo.post_id is not None
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add your photo again.")
    post = Post(author_id=user.id, caption=caption or "")
    db.add(post)
    await db.flush()
    photo.post_id = post.id
    await db.commit()
    await db.refresh(post)
    return (await posts_out(db, settings, user, [post]))[0]


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession
) -> None:
    """The author deletes their own post: it, its likes and its photo are gone for good."""
    post = await db.get(Post, post_id)
    if post is None or post.author_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This post isn't here any more.")
    keys = list(
        (await db.execute(select(Photo.storage_key).where(Photo.post_id == post.id))).scalars()
    )
    await db.delete(post)
    await db.commit()
    await anyio.to_thread.run_sync(
        photos.delete_files, request.app.state.photo_storage, photos.all_keys(keys)
    )


@router.post("/posts/{post_id}/like")
async def like(
    post_id: uuid.UUID, user: CurrentUser, db: DbSession, limiter: Limiter
) -> dict[str, int | bool]:
    await limiter.hit(LIKES_PER_USER, str(user.id))
    post = await _live_post(db, post_id)
    added = (
        await db.execute(
            insert(PostLike)
            .values(post_id=post.id, user_id=user.id)
            .on_conflict_do_nothing()
            .returning(PostLike.post_id)
        )
    ).first()
    if added is not None:
        await db.execute(
            update(Post).where(Post.id == post.id).values(like_count=Post.like_count + 1)
        )
    await db.commit()
    await db.refresh(post)
    return {"like_count": post.like_count, "liked": True}


@router.delete("/posts/{post_id}/like")
async def unlike(
    post_id: uuid.UUID, user: CurrentUser, db: DbSession, limiter: Limiter
) -> dict[str, int | bool]:
    await limiter.hit(LIKES_PER_USER, str(user.id))
    post = await _live_post(db, post_id)
    removed = (
        await db.execute(
            delete(PostLike)
            .where(PostLike.post_id == post.id, PostLike.user_id == user.id)
            .returning(PostLike.post_id)
        )
    ).first()
    if removed is not None:
        await db.execute(
            update(Post)
            .where(Post.id == post.id)
            .values(like_count=func.greatest(Post.like_count - 1, 0))
        )
    await db.commit()
    await db.refresh(post)
    return {"like_count": post.like_count, "liked": False}


@router.post("/posts/{post_id}/report", status_code=status.HTTP_204_NO_CONTENT)
async def report_post(
    post_id: uuid.UUID,
    body: ReportIn,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
) -> None:
    """Saved for the admin page, and emailed to the founder as a nudge to look."""
    await limiter.hit(REPORTS_PER_USER, str(user.id))
    post = await _live_post(db, post_id)
    if body.reason not in REPORT_REASONS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Pick a reason.")
    try:
        note = clean_text(body.note, label="Your note", max_len=280, required=False)
    except ExperienceError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    report = Report(post_id=post.id, sender_id=post.author_id, reason=body.reason, note=note)
    db.add(report)
    await db.commit()
    author = await db.get(User, post.author_id)
    text = (
        f"Reason: {body.reason}\nNote: {note or '-'}\n\n"
        f"Community post by @{author.username if author else '(deleted)'}\n"
        f"Caption: {post.caption}\n\n"
        f"Review it, remove it or dismiss it: {settings.public_web_url.rstrip('/')}/admin\n"
    )
    with contextlib.suppress(EmailDeliveryError):
        await send_email(
            request.app.state.http,
            settings,
            Email(
                to=settings.reports_to,
                subject=f"Dearlly report (community): {body.reason}",
                text=text,
                html="",
            ),
        )

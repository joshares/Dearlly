"""Photo uploads (writers, logged in) and photo viewing (anyone with a signed link)."""

import logging
import uuid
from typing import Annotated, Literal

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel

from app.api.deps import AppSettings, CurrentUser, DbSession, Limiter
from app.core.config import Settings
from app.core.csrf import require_csrf
from app.core.ratelimit import Limit
from app.models import Photo
from app.services import photos

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/photos", tags=["photos"])

UPLOADS_PER_USER = Limit("photo-upload-user", max_requests=30, window_seconds=24 * 3600)
# Cleaning and checking take a moment of CPU each; a few at a time keeps the API responsive.
_working = anyio.CapacityLimiter(2)

OFF = "Photos aren't switched on yet."


class PhotoStatus(BaseModel):
    enabled: bool
    max_bytes: int


class PhotoOut(BaseModel):
    id: uuid.UUID
    url: str
    small_url: str
    width: int
    height: int


def photo_out(settings: Settings, photo: Photo) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        url=photos.view_url(settings, photo.id),
        small_url=photos.view_url(settings, photo.id, small=True),
        width=photo.width,
        height=photo.height,
    )


def _storage(request: Request) -> photos.Storage:
    storage: photos.Storage | None = request.app.state.photo_storage
    if storage is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, OFF)
    return storage


def _checker(request: Request) -> photos.Checker:
    checker: photos.Checker | None = request.app.state.photo_checker
    if checker is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, OFF)
    return checker


@router.get("/status")
async def photo_status(request: Request) -> PhotoStatus:
    on = request.app.state.photo_storage is not None and request.app.state.photo_checker is not None
    return PhotoStatus(enabled=on, max_bytes=photos.MAX_UPLOAD_BYTES)


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
async def upload_photo(
    request: Request, user: CurrentUser, db: DbSession, settings: AppSettings, limiter: Limiter
) -> PhotoOut:
    """The photo is the request body itself (Content-Type image/jpeg, image/png or image/webp)."""
    storage, checker = _storage(request), _checker(request)
    await limiter.hit(UPLOADS_PER_USER, str(user.id))
    kind = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if kind not in photos.ACCEPTED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, photos.NOT_A_PHOTO)
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > photos.MAX_UPLOAD_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, photos.NOT_A_PHOTO)

    def work() -> tuple[photos.Cleaned, float]:
        cleaned = photos.clean(bytes(raw))
        return cleaned, checker(cleaned.image)

    try:
        cleaned, score = await anyio.to_thread.run_sync(work, limiter=_working)
    except photos.PhotoError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if score >= photos.NSFW_THRESHOLD:
        # Never stored. The score (no image, no person) helps tune the threshold.
        logger.info("photo refused", extra={"nsfw_score": round(score, 3)})
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, photos.REFUSED)

    key = photos.new_key()
    await anyio.to_thread.run_sync(storage.put, key, cleaned.jpeg)
    await anyio.to_thread.run_sync(storage.put, photos.small_key(key), cleaned.small_jpeg)
    photo = Photo(
        owner_id=user.id,
        storage_key=key,
        width=cleaned.width,
        height=cleaned.height,
        size_bytes=len(cleaned.jpeg),
        nsfw_score=score,
    )
    db.add(photo)
    await db.commit()
    return photo_out(settings, photo)


@router.get("/{photo_id}/link")
async def photo_link(
    photo_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings
) -> PhotoOut:
    """A fresh link for the writer's own photo (a saved draft's link may have expired)."""
    photo = await db.get(Photo, photo_id)
    if photo is None or photo.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return photo_out(settings, photo)


@router.get("/{photo_id}.jpg")
async def view_photo(
    photo_id: uuid.UUID,
    request: Request,
    db: DbSession,
    settings: AppSettings,
    e: Annotated[int, Query()],
    s: Annotated[str, Query(max_length=64)],
    size: Literal["full", "small"] = "full",
) -> Response:
    """Serves a photo to anyone holding a valid signed link (made for letters that are open)."""
    if not photos.valid_link(settings, photo_id, e, s):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    storage = _storage(request)
    photo = await db.get(Photo, photo_id)
    data = None
    if photo is not None:
        key = photos.small_key(photo.storage_key) if size == "small" else photo.storage_key
        data = await anyio.to_thread.run_sync(storage.get, key)
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found.")
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            # The link changes every hour and the photo never does: cache it for the link's life.
            "Cache-Control": "private, max-age=3600, immutable",
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Disposition": "inline",
        },
    )

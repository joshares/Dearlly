"""Profiles: your own (private, includes email) and other people's (public, never email)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.deps import AppSettings, CurrentUser, DbSession, Limiter, clear_auth_cookies
from app.api.schemas import (
    DeleteAccountIn,
    MyProfile,
    ProfileUpdateIn,
    PublicProfile,
    UsernameAvailabilityOut,
)
from app.core.csrf import require_csrf
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.models import User
from app.services.profiles import ProfileFieldError, normalize_display_name, normalize_username

logger = logging.getLogger(__name__)

router = APIRouter(tags=["profiles"], dependencies=[Depends(require_csrf)])

LOOKUP_PER_IP = Limit("profile-lookup-ip", max_requests=60, window_seconds=60)
DELETE_PER_IP = Limit("account-delete-ip", max_requests=10, window_seconds=3600)


@router.get("/me")
async def get_me(user: CurrentUser) -> MyProfile:
    return MyProfile.model_validate(user)


@router.patch("/me")
async def update_me(body: ProfileUpdateIn, user: CurrentUser, db: DbSession) -> MyProfile:
    try:
        user.display_name = normalize_display_name(body.display_name)
    except ProfileFieldError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    await db.commit()
    await db.refresh(user)
    return MyProfile.model_validate(user)


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    body: DeleteAccountIn,
    request: Request,
    response: Response,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    limiter: Limiter,
) -> None:
    """Delete the account and everything tied to it (NDPA right to erasure).

    Sessions and refresh tokens go with it (ON DELETE CASCADE), so every device is logged out.
    """
    await limiter.hit(DELETE_PER_IP, client_ip(request, settings))
    if body.confirm_username.strip().lower() != user.username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Type your username exactly to confirm.",
        )
    user_id = str(user.id)
    await db.delete(user)
    await db.commit()
    clear_auth_cookies(response, settings)
    logger.info("account deleted", extra={"user_id": user_id})


@router.get("/users/{username}")
async def get_profile(
    username: str, request: Request, db: DbSession, settings: AppSettings, limiter: Limiter
) -> PublicProfile:
    await limiter.hit(LOOKUP_PER_IP, client_ip(request, settings))
    user = (
        await db.execute(select(User).where(User.username == username.strip().lower()))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user.")
    return PublicProfile.model_validate(user)


@router.get("/usernames/{username}/availability")
async def username_availability(
    username: str, request: Request, db: DbSession, settings: AppSettings, limiter: Limiter
) -> UsernameAvailabilityOut:
    await limiter.hit(LOOKUP_PER_IP, client_ip(request, settings))
    try:
        normalized = normalize_username(username)
    except ProfileFieldError as exc:
        return UsernameAvailabilityOut(available=False, reason=str(exc))
    taken = (
        await db.execute(select(User.id).where(User.username == normalized))
    ).scalar_one_or_none()
    if taken:
        return UsernameAvailabilityOut(available=False, reason="That username is taken.")
    return UsernameAvailabilityOut(available=True)

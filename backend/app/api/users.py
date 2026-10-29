"""Profiles: your own (private, includes email) and other people's (public, never email)."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import AppSettings, CurrentUser, DbSession, Limiter
from app.api.schemas import MyProfile, ProfileUpdateIn, PublicProfile, UsernameAvailabilityOut
from app.core.csrf import require_csrf
from app.core.net import client_ip
from app.core.ratelimit import Limit
from app.models import User
from app.services.profiles import ProfileFieldError, normalize_display_name, normalize_username

router = APIRouter(tags=["profiles"], dependencies=[Depends(require_csrf)])

LOOKUP_PER_IP = Limit("profile-lookup-ip", max_requests=60, window_seconds=60)


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

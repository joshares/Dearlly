import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.plans import Plan


class PublicProfile(BaseModel):
    """What anyone can see. Never includes the email."""

    model_config = ConfigDict(from_attributes=True)

    username: str
    display_name: str | None
    created_at: datetime


class MyProfile(PublicProfile):
    """What the account owner sees about themselves."""

    id: uuid.UUID
    email: str
    plan: Plan


class CsrfOut(BaseModel):
    csrf_token: str


class StartIn(BaseModel):
    email: str = Field(max_length=254)
    turnstile_token: str = Field(max_length=2048)


class StartOut(BaseModel):
    status: Literal["code_sent"] = "code_sent"


class VerifyIn(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class VerifyOut(BaseModel):
    status: Literal["logged_in", "signup_required"]
    user: MyProfile | None = None


class SignupIn(BaseModel):
    username: str = Field(max_length=40)
    display_name: str | None = Field(default=None, max_length=80)
    # The required "I'm 18 or older" tick.
    is_adult: bool


class ProfileUpdateIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=80)


class DeleteAccountIn(BaseModel):
    # Retyping the username guards against accidental taps.
    confirm_username: str = Field(max_length=40)


class UsernameAvailabilityOut(BaseModel):
    available: bool
    reason: str | None = None

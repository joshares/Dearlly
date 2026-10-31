import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.plans import PlanMixin
from app.db.base import Base


class User(PlanMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Stored lower-cased. Private: never shown to other users.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    # Public handle, stored lower-cased.
    username: Mapped[str] = mapped_column(String(20), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(40))
    # When they ticked "I'm 18 or older" (no date of birth is collected).
    adult_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    email_verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Optional: people can also log in with an emailed code or Google. Argon2id hash only.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Google's permanent account id, set the first time they use "Continue with Google".
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Can open the admin page. Set only on the server: python -m app.admin make-admin <email>.
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    @property
    def has_password(self) -> bool:
        return self.password_hash is not None


class AuthSession(Base):
    """One logged-in device. Logging out revokes it, which kills its access and refresh tokens."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RefreshToken(Base):
    """Single-use refresh tokens, stored as SHA-256 hashes. Reuse revokes the whole session."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth_sessions.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Experience(Base):
    """One love note (and, from Stage 5, date / vacation / gift). `type` picks the rules."""

    __tablename__ = "experiences"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(32))
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # Private link: looked up by hash; the encrypted copy lets the sender copy it again.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    token_encrypted: Mapped[str] = mapped_column(Text)

    sender_name: Mapped[str] = mapped_column(String(60))
    recipient_name: Mapped[str] = mapped_column(String(60))
    recipient_title: Mapped[str | None] = mapped_column(String(60))
    theme: Mapped[str] = mapped_column(String(32))
    content: Mapped[dict[str, Any]] = mapped_column(JSON)

    # Scheduled reveal: the letter stays sealed until this time.
    opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    first_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    open_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    reply_reaction: Mapped[str | None] = mapped_column(String(32))
    reply_note: Mapped[str | None] = mapped_column(String(280))
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Emailing the letter (optional). The address is encrypted and deleted once sent.
    # email_status: scheduled -> sending -> sent | failed; blocked = they asked not to be emailed.
    recipient_email_encrypted: Mapped[str | None] = mapped_column(Text)
    recipient_email_hash: Mapped[str | None] = mapped_column(String(64))
    email_status: Mapped[str | None] = mapped_column(String(16), index=True)
    email_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    email_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Secret admirer: the recipient sees "A secret admirer" until the sender reveals their name
    # (Dearlly always knows who sent it). blocked_at: the recipient blocked it with one tap.
    anonymous: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    revealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    PrimaryKeyConstraint,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Game(Base):
    """A two-player game. While it's live, its moves are kept in Redis; this row keeps who played,
    when, and the result."""

    __tablename__ = "games"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(6), unique=True)
    host_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    guest_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    format: Mapped[str] = mapped_column(String(32))
    intensity: Mapped[str] = mapped_column(String(16))
    rounds: Mapped[int] = mapped_column(Integer)
    # lobby -> playing -> ended
    status: Mapped[str] = mapped_column(String(16), default="lobby", server_default="lobby")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class GameSeen(Base):
    """Questions a pair has already played, so they don't get them again until the bank runs out.
    The pair is stored with the smaller user id first."""

    __tablename__ = "game_seen"
    __table_args__ = (PrimaryKeyConstraint("user_low", "user_high", "question_key"),)

    user_low: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    user_high: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    question_key: Mapped[str] = mapped_column(String(64))
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GameQuestionStat(Base):
    """How each question does: shown, skipped, and (later) thumbs up/down. Weak ones are retired."""

    __tablename__ = "game_question_stats"

    question_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    shown: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    skipped: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    thumbs_up: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    thumbs_down: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    retired: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

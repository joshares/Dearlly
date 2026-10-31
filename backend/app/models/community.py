import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, PrimaryKeyConstraint, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Post(Base):
    """A community stamp: one photo and a caption, seen by logged-in members only."""

    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    caption: Mapped[str] = mapped_column(String(280))
    # Counted on the post so the feed and "top of the week" stay fast.
    like_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # Removed by an admin: hidden everywhere, kept so repeat offenders can be spotted.
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PostLike(Base):
    __tablename__ = "post_likes"
    __table_args__ = (PrimaryKeyConstraint("post_id", "user_id"),)

    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TopPick(Base):
    """The admin's choice of top post for one week (Monday, WAT). Without one, most likes wins."""

    __tablename__ = "top_picks"

    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"))
    picked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

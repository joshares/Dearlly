import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Photo(Base):
    """A photo added to a letter. The file lives in storage (R2) under `storage_key`.

    Uploaded while writing; attached to the letter (or community post) when it's sent. Photos
    never attached within a day are removed by the daily sweep, along with any file whose row is
    gone.
    """

    __tablename__ = "photos"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    experience_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("experiences.id", ondelete="CASCADE"), index=True
    )
    # Or on a community post (a photo is on one letter or one post, never both).
    post_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(80), unique=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    size_bytes: Mapped[int] = mapped_column(Integer)
    # The nudity check's score (0 = clearly fine, 1 = clearly not), kept to tune the threshold.
    nsfw_score: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

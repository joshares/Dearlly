"""Database models. Import every model module here so Alembic autogenerate can see it."""

from app.db.base import Base
from app.models.community import Post, PostLike, TopPick
from app.models.email_safety import EmailBlock, Report
from app.models.experience import Experience
from app.models.game import Game, GameQuestionStat, GameSeen
from app.models.photo import Photo
from app.models.user import AuthSession, RefreshToken, User

__all__ = [
    "AuthSession",
    "Base",
    "EmailBlock",
    "Experience",
    "Game",
    "GameQuestionStat",
    "GameSeen",
    "Photo",
    "Post",
    "PostLike",
    "RefreshToken",
    "Report",
    "TopPick",
    "User",
]

"""photos: uploaded pictures attached to letters

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-30 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("experience_id", sa.Uuid(), nullable=True),
        sa.Column("storage_key", sa.String(length=80), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("nsfw_score", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["experience_id"], ["experiences.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(op.f("ix_photos_owner_id"), "photos", ["owner_id"], unique=False)
    op.create_index(op.f("ix_photos_experience_id"), "photos", ["experience_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_photos_experience_id"), table_name="photos")
    op.drop_index(op.f("ix_photos_owner_id"), table_name="photos")
    op.drop_table("photos")

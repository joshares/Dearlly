"""community: posts (photo + caption), likes, the admin's top pick per week

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-31 21:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "posts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("author_id", sa.Uuid(), nullable=False),
        sa.Column("caption", sa.String(length=280), nullable=False),
        sa.Column("like_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_posts_author_id"), "posts", ["author_id"], unique=False)
    op.create_index(op.f("ix_posts_created_at"), "posts", ["created_at"], unique=False)
    op.create_table(
        "post_likes",
        sa.Column("post_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("post_id", "user_id"),
    )
    op.create_index(op.f("ix_post_likes_user_id"), "post_likes", ["user_id"], unique=False)
    op.create_table(
        "top_picks",
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("post_id", sa.Uuid(), nullable=False),
        sa.Column("picked_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["picked_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("week_start"),
    )
    op.add_column("photos", sa.Column("post_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "photos_post_id_fkey", "photos", "posts", ["post_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index(op.f("ix_photos_post_id"), "photos", ["post_id"], unique=False)
    op.add_column("reports", sa.Column("post_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "reports_post_id_fkey", "reports", "posts", ["post_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index(op.f("ix_reports_post_id"), "reports", ["post_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_reports_post_id"), table_name="reports")
    op.drop_constraint("reports_post_id_fkey", "reports", type_="foreignkey")
    op.drop_column("reports", "post_id")
    op.drop_index(op.f("ix_photos_post_id"), table_name="photos")
    op.drop_constraint("photos_post_id_fkey", "photos", type_="foreignkey")
    op.drop_column("photos", "post_id")
    op.drop_table("top_picks")
    op.drop_index(op.f("ix_post_likes_user_id"), table_name="post_likes")
    op.drop_table("post_likes")
    op.drop_index(op.f("ix_posts_created_at"), table_name="posts")
    op.drop_index(op.f("ix_posts_author_id"), table_name="posts")
    op.drop_table("posts")

"""games: rooms, the questions each pair has seen, question stats

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-31 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "games",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("host_id", sa.Uuid(), nullable=False),
        sa.Column("guest_id", sa.Uuid(), nullable=True),
        sa.Column("format", sa.String(length=32), nullable=False),
        sa.Column("intensity", sa.String(length=16), nullable=False),
        sa.Column("rounds", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="lobby", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["host_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["guest_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index(op.f("ix_games_host_id"), "games", ["host_id"], unique=False)
    op.create_index(op.f("ix_games_guest_id"), "games", ["guest_id"], unique=False)
    op.create_table(
        "game_seen",
        sa.Column("user_low", sa.Uuid(), nullable=False),
        sa.Column("user_high", sa.Uuid(), nullable=False),
        sa.Column("question_key", sa.String(length=64), nullable=False),
        sa.Column(
            "seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_low"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_high"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_low", "user_high", "question_key"),
    )
    op.create_index(op.f("ix_game_seen_user_high"), "game_seen", ["user_high"], unique=False)
    op.create_table(
        "game_question_stats",
        sa.Column("question_key", sa.String(length=64), nullable=False),
        sa.Column("shown", sa.Integer(), server_default="0", nullable=False),
        sa.Column("skipped", sa.Integer(), server_default="0", nullable=False),
        sa.Column("thumbs_up", sa.Integer(), server_default="0", nullable=False),
        sa.Column("thumbs_down", sa.Integer(), server_default="0", nullable=False),
        sa.Column("retired", sa.Boolean(), server_default="false", nullable=False),
        sa.PrimaryKeyConstraint("question_key"),
    )


def downgrade() -> None:
    op.drop_table("game_question_stats")
    op.drop_index(op.f("ix_game_seen_user_high"), table_name="game_seen")
    op.drop_table("game_seen")
    op.drop_index(op.f("ix_games_guest_id"), table_name="games")
    op.drop_index(op.f("ix_games_host_id"), table_name="games")
    op.drop_table("games")

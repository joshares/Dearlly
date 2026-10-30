"""email letters: recipient email fields, email blocks, reports

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-30 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("experiences", sa.Column("recipient_email_encrypted", sa.Text(), nullable=True))
    op.add_column(
        "experiences", sa.Column("recipient_email_hash", sa.String(length=64), nullable=True)
    )
    op.add_column("experiences", sa.Column("email_status", sa.String(length=16), nullable=True))
    op.add_column(
        "experiences",
        sa.Column("email_attempts", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "experiences", sa.Column("email_sent_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        op.f("ix_experiences_email_status"), "experiences", ["email_status"], unique=False
    )

    op.create_table(
        "email_blocks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_email_blocks_email_hash"), "email_blocks", ["email_hash"])
    op.create_index(op.f("ix_email_blocks_sender_id"), "email_blocks", ["sender_id"])

    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("experience_id", sa.Uuid(), nullable=True),
        sa.Column("sender_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column("note", sa.String(length=280), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["experience_id"], ["experiences.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reports_experience_id"), "reports", ["experience_id"])
    op.create_index(op.f("ix_reports_sender_id"), "reports", ["sender_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_reports_sender_id"), table_name="reports")
    op.drop_index(op.f("ix_reports_experience_id"), table_name="reports")
    op.drop_table("reports")
    op.drop_index(op.f("ix_email_blocks_sender_id"), table_name="email_blocks")
    op.drop_index(op.f("ix_email_blocks_email_hash"), table_name="email_blocks")
    op.drop_table("email_blocks")
    op.drop_index(op.f("ix_experiences_email_status"), table_name="experiences")
    op.drop_column("experiences", "email_sent_at")
    op.drop_column("experiences", "email_attempts")
    op.drop_column("experiences", "email_status")
    op.drop_column("experiences", "recipient_email_hash")
    op.drop_column("experiences", "recipient_email_encrypted")

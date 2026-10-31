"""admin: admin accounts and report statuses

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-31 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("is_admin", sa.Boolean(), server_default="false", nullable=False)
    )
    op.add_column(
        "reports",
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
    )
    op.add_column("reports", sa.Column("resolution", sa.String(length=16), nullable=True))
    op.add_column("reports", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_reports_status"), "reports", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_reports_status"), table_name="reports")
    op.drop_column("reports", "resolved_at")
    op.drop_column("reports", "resolution")
    op.drop_column("reports", "status")
    op.drop_column("users", "is_admin")

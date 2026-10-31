"""secret admirer: anonymous letters, reveal and one-tap block

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-31 09:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "experiences",
        sa.Column("anonymous", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column("experiences", sa.Column("revealed_at", sa.DateTime(timezone=True)))
    op.add_column("experiences", sa.Column("blocked_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("experiences", "blocked_at")
    op.drop_column("experiences", "revealed_at")
    op.drop_column("experiences", "anonymous")

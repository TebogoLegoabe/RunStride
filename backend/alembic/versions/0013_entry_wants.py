"""Entry alerts: which race entries someone wants, to alert them when one is offered

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "entry_wants",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "race_event_id", sa.Uuid(), sa.ForeignKey("race_events.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_entry_wants_race_event_id", "entry_wants", ["race_event_id"])


def downgrade() -> None:
    op.drop_index("ix_entry_wants_race_event_id", table_name="entry_wants")
    op.drop_table("entry_wants")

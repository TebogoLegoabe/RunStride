"""run dates, message kinds

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "run_dates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("match_id", sa.Uuid(), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("proposed_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("place", sa.String(120), nullable=False),
        sa.Column("distance_km", sa.SmallInteger()),
        sa.Column("note", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="proposed"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("cancelled_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.CheckConstraint(
            "status IN ('proposed', 'accepted', 'declined', 'cancelled')", name="run_date_status_values"
        ),
    )
    op.create_index("ix_run_dates_match_id", "run_dates", ["match_id"])

    op.add_column("messages", sa.Column("kind", sa.String(20), nullable=False, server_default="text"))
    op.add_column(
        "messages",
        sa.Column("run_date_id", sa.Uuid(), sa.ForeignKey("run_dates.id", ondelete="CASCADE")),
    )
    op.create_check_constraint("message_kind_values", "messages", "kind IN ('text', 'run_date', 'system')")


def downgrade() -> None:
    op.drop_constraint("message_kind_values", "messages", type_="check")
    op.drop_column("messages", "run_date_id")
    op.drop_column("messages", "kind")
    op.drop_index("ix_run_dates_match_id", table_name="run_dates")
    op.drop_table("run_dates")

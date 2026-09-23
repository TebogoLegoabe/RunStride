"""trusted contacts, run shares, run check-ins

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "trusted_contacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_trusted_contacts_user_id", "trusted_contacts", ["user_id"])

    op.create_table(
        "run_shares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_date_id", sa.Uuid(), sa.ForeignKey("run_dates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("alert_at", sa.DateTime(timezone=True)),
        sa.Column("latitude", sa.Float()),
        sa.Column("longitude", sa.Float()),
        sa.Column("accuracy_m", sa.Float()),
        sa.Column("location_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('active', 'alert', 'ended')", name="run_share_status_values"),
    )
    op.create_index("ix_run_shares_user_id_run_date_id", "run_shares", ["user_id", "run_date_id"])

    op.create_table(
        "run_check_ins",
        sa.Column("run_date_id", sa.Uuid(), sa.ForeignKey("run_dates.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("outcome IN ('ok', 'problem')", name="check_in_outcome_values"),
    )


def downgrade() -> None:
    op.drop_table("run_check_ins")
    op.drop_index("ix_run_shares_user_id_run_date_id", table_name="run_shares")
    op.drop_table("run_shares")
    op.drop_index("ix_trusted_contacts_user_id", table_name="trusted_contacts")
    op.drop_table("trusted_contacts")

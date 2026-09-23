"""blocks, reports, account status, admins

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("account_status", sa.String(20), nullable=False, server_default="active"))
    op.add_column("users", sa.Column("suspended_until", sa.DateTime(timezone=True)))
    op.create_check_constraint(
        "account_status_values", "users", "account_status IN ('active', 'suspended', 'banned')"
    )

    op.create_table(
        "blocks",
        sa.Column("blocker_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("blocked_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_blocks_blocked_id", "blocks", ["blocked_id"])

    op.create_table(
        "reports",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("reporter_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("reported_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("match_id", sa.Uuid(), sa.ForeignKey("matches.id", ondelete="SET NULL")),
        sa.Column("reason", sa.String(30), nullable=False),
        sa.Column("details", sa.Text()),
        sa.Column("evidence", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolved_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("resolution", sa.String(20)),
        sa.Column("resolution_note", sa.Text()),
        sa.CheckConstraint("status IN ('open', 'resolved')", name="report_status_values"),
    )
    op.create_index("ix_reports_status_created_at", "reports", ["status", "created_at"])
    op.create_index("ix_reports_reported_id", "reports", ["reported_id"])


def downgrade() -> None:
    op.drop_index("ix_reports_reported_id", table_name="reports")
    op.drop_index("ix_reports_status_created_at", table_name="reports")
    op.drop_table("reports")
    op.drop_index("ix_blocks_blocked_id", table_name="blocks")
    op.drop_table("blocks")
    op.drop_constraint("account_status_values", "users", type_="check")
    op.drop_column("users", "suspended_until")
    op.drop_column("users", "account_status")
    op.drop_column("users", "is_admin")

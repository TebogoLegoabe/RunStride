"""RunStride Plus, race passes, Taken mode and swap alerts

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("dating_mode", sa.String(20), nullable=False, server_default="looking")
    )
    op.create_check_constraint("dating_mode_values", "users", "dating_mode IN ('looking', 'taken')")
    op.add_column("race_attendance", sa.Column("swaps_seen_at", sa.DateTime(timezone=True)))

    op.create_table(
        "entitlements",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="SET NULL")),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("product_id", sa.String(100)),
        sa.Column("store_ref", sa.String(200), unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("redeemed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('plus', 'race_pass')", name="entitlement_kind_values"),
        sa.CheckConstraint("source IN ('store', 'admin', 'dev')", name="entitlement_source_values"),
    )
    op.create_index("ix_entitlements_user_id_kind", "entitlements", ["user_id", "kind"])

    op.create_table(
        "billing_events",
        sa.Column("id", sa.String(200), primary_key=True),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("billing_events")
    op.drop_index("ix_entitlements_user_id_kind", table_name="entitlements")
    op.drop_table("entitlements")
    op.drop_column("race_attendance", "swaps_seen_at")
    op.drop_constraint("dating_mode_values", "users", type_="check")
    op.drop_column("users", "dating_mode")

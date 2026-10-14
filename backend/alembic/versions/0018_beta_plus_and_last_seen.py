"""Beta Plus offer, last-seen tracking

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("beta_plus_claimed_at", sa.DateTime(timezone=True)))
    op.create_index("ix_users_last_seen_at", "users", ["last_seen_at"])
    op.drop_constraint("entitlement_source_values", "entitlements", type_="check")
    op.create_check_constraint(
        "entitlement_source_values", "entitlements", "source IN ('store', 'admin', 'dev', 'beta')"
    )


def downgrade() -> None:
    op.drop_constraint("entitlement_source_values", "entitlements", type_="check")
    op.create_check_constraint("entitlement_source_values", "entitlements", "source IN ('store', 'admin', 'dev')")
    op.drop_index("ix_users_last_seen_at", table_name="users")
    op.drop_column("users", "beta_plus_claimed_at")
    op.drop_column("users", "last_seen_at")

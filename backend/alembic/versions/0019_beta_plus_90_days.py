"""The free beta Plus is now 90 days: extend the 30-day ones already switched on

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-15
"""
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE entitlements
        SET expires_at = expires_at + interval '60 days'
        WHERE kind = 'plus' AND source = 'beta' AND expires_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE entitlements
        SET expires_at = expires_at - interval '60 days'
        WHERE kind = 'plus' AND source = 'beta' AND expires_at IS NOT NULL
        """
    )

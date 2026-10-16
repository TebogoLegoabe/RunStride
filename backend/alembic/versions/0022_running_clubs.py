"""Running clubs on the running profile

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "running_profiles",
        sa.Column("clubs", sa.ARRAY(sa.String(60)), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("running_profiles", "clubs")

"""Profiles can have an avatar instead of photos

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("avatar", sa.String(20)))


def downgrade() -> None:
    op.drop_column("profiles", "avatar")

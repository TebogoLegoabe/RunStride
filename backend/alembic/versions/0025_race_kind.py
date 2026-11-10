"""Races get a kind, so weekly parkruns can be listed apart from once-off races

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("races", sa.Column("kind", sa.String(20), nullable=False, server_default="race"))
    op.create_check_constraint("race_kind_values", "races", "kind IN ('race', 'parkrun')")
    op.create_index("ix_races_kind_starts_on", "races", ["kind", "starts_on"])


def downgrade() -> None:
    op.drop_index("ix_races_kind_starts_on", table_name="races")
    op.drop_constraint("race_kind_values", "races", type_="check")
    op.drop_column("races", "kind")

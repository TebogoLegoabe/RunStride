"""Search distance can go up to 2,000 km (anywhere in South Africa)

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-16
"""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("distance_range", "dating_preferences", type_="check")
    op.create_check_constraint("distance_range", "dating_preferences", "max_distance_km BETWEEN 1 AND 2000")


def downgrade() -> None:
    op.execute("UPDATE dating_preferences SET max_distance_km = 500 WHERE max_distance_km > 500")
    op.drop_constraint("distance_range", "dating_preferences", type_="check")
    op.create_check_constraint("distance_range", "dating_preferences", "max_distance_km BETWEEN 1 AND 500")

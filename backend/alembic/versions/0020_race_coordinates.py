"""Races get a position, so people can look for races near them

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("races", sa.Column("latitude", sa.Float()))
    op.add_column("races", sa.Column("longitude", sa.Float()))

    # Fill in the races that already exist, from the towns table
    from app.places import place_coords

    bind = op.get_bind()
    for race_id, city, province in bind.execute(sa.text("SELECT id, city, province FROM races")).all():
        point = place_coords(city, province)
        if point:
            bind.execute(
                sa.text("UPDATE races SET latitude = :lat, longitude = :lon WHERE id = :id"),
                {"lat": point[0], "lon": point[1], "id": race_id},
            )


def downgrade() -> None:
    op.drop_column("races", "longitude")
    op.drop_column("races", "latitude")

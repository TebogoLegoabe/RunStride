"""running profiles, dating preferences

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "running_profiles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("pace_seconds_per_km", sa.SmallInteger(), nullable=False),
        sa.Column("weekly_km", sa.SmallInteger(), nullable=False),
        sa.Column("terrains", postgresql.ARRAY(sa.String(20)), nullable=False),
        sa.Column("goals", postgresql.ARRAY(sa.String(20)), nullable=False),
        sa.Column("run_times", postgresql.ARRAY(sa.String(20)), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("pace_seconds_per_km BETWEEN 150 AND 1200", name="pace_range"),
        sa.CheckConstraint("weekly_km BETWEEN 0 AND 400", name="weekly_km_range"),
    )
    op.create_table(
        "dating_preferences",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("gender", sa.String(20), nullable=False),
        sa.Column("interested_in", postgresql.ARRAY(sa.String(20)), nullable=False),
        sa.Column("age_min", sa.SmallInteger(), nullable=False),
        sa.Column("age_max", sa.SmallInteger(), nullable=False),
        sa.Column("max_distance_km", sa.SmallInteger(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("age_min >= 18 AND age_max <= 99 AND age_min <= age_max", name="age_range"),
        sa.CheckConstraint("max_distance_km BETWEEN 1 AND 500", name="distance_range"),
    )


def downgrade() -> None:
    op.drop_table("dating_preferences")
    op.drop_table("running_profiles")

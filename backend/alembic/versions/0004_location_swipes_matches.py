"""user location, swipes, matches

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geography

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("location", Geography(geometry_type="POINT", srid=4326, spatial_index=False)),
    )
    op.add_column("users", sa.Column("location_updated_at", sa.DateTime(timezone=True)))
    op.create_index("ix_users_location", "users", ["location"], postgresql_using="gist")

    op.create_table(
        "swipes",
        sa.Column("swiper_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("target_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("liked", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_swipes_target_id", "swipes", ["target_id"])

    op.create_table(
        "matches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_a_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_b_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_a_id", "user_b_id"),
        sa.CheckConstraint("user_a_id < user_b_id", name="ordered_pair"),
    )
    op.create_index("ix_matches_user_b_id", "matches", ["user_b_id"])


def downgrade() -> None:
    op.drop_index("ix_matches_user_b_id", table_name="matches")
    op.drop_table("matches")
    op.drop_index("ix_swipes_target_id", table_name="swipes")
    op.drop_table("swipes")
    op.drop_index("ix_users_location", table_name="users")
    op.drop_column("users", "location_updated_at")
    op.drop_column("users", "location")

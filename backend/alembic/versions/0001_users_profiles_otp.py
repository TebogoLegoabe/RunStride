"""users, profiles, profile photos, otp codes

Revision ID: 0001
Revises:
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

verification_status = postgresql.ENUM(
    "unverified", "pending", "verified", "rejected", name="verification_status", create_type=False
)


def upgrade() -> None:
    # Not used yet; enabled now so Phase 3 (location matching) doesn't need a setup migration.
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    verification_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("phone", sa.String(20), nullable=False, unique=True),
        sa.Column("verification_status", verification_status, nullable=False, server_default="unverified"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime(timezone=True)),
    )

    op.create_table(
        "profiles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("display_name", sa.String(50), nullable=False),
        sa.Column("birth_date", sa.Date(), nullable=False),
        sa.Column("bio", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "profile_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("profiles.user_id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "position"),
    )

    op.create_table(
        "otp_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_otp_codes_phone_created_at", "otp_codes", ["phone", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_otp_codes_phone_created_at", table_name="otp_codes")
    op.drop_table("otp_codes")
    op.drop_table("profile_photos")
    op.drop_table("profiles")
    op.drop_table("users")
    verification_status.drop(op.get_bind(), checkfirst=True)

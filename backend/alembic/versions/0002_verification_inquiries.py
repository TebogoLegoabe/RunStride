"""verification inquiries

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "verification_inquiries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_inquiry_id", sa.String(64), nullable=False, unique=True),
        sa.Column("provider_status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_verification_inquiries_user_id", "verification_inquiries", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_verification_inquiries_user_id", table_name="verification_inquiries")
    op.drop_table("verification_inquiries")

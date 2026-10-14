"""Manual ID checks: submissions reviewed by an admin

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "id_submissions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("id_hash", sa.String(64), nullable=False),
        sa.Column("id_number", sa.String(13)),
        sa.Column("id_photo_key", sa.String(100)),
        sa.Column("selfie_key", sa.String(100)),
        sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("reject_reason", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_id_submissions_user_id", "id_submissions", ["user_id"])
    op.create_index("ix_id_submissions_id_hash", "id_submissions", ["id_hash"])
    op.create_index("ix_id_submissions_status_created_at", "id_submissions", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("id_submissions")

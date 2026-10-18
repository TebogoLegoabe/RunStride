"""In-app feedback from testers and users

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "feedback",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("platform", sa.String(20)),
        sa.Column("screen", sa.String(120)),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_feedback_status_created_at", "feedback", ["status", "created_at"])


def downgrade() -> None:
    op.drop_table("feedback")

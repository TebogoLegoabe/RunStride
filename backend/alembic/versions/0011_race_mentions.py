"""@mentions in race chats

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "race_messages",
        sa.Column("mentioned_user_ids", postgresql.ARRAY(sa.Uuid()), nullable=False, server_default="{}"),
    )
    # "Messages that mention me" looks inside the array
    op.create_index(
        "ix_race_messages_mentioned_user_ids", "race_messages", ["mentioned_user_ids"], postgresql_using="gin"
    )
    op.add_column("race_attendance", sa.Column("mentions_seen_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("race_attendance", "mentions_seen_at")
    op.drop_index("ix_race_messages_mentioned_user_ids", table_name="race_messages")
    op.drop_column("race_messages", "mentioned_user_ids")

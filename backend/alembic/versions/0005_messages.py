"""messages, unmatching

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("ended_at", sa.DateTime(timezone=True)))
    op.add_column(
        "matches",
        sa.Column("ended_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("match_id", sa.Uuid(), sa.ForeignKey("matches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_messages_match_id_created_at", "messages", ["match_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_messages_match_id_created_at", table_name="messages")
    op.drop_table("messages")
    op.drop_column("matches", "ended_by_id")
    op.drop_column("matches", "ended_at")

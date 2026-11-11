"""Chat messages can reply to another message, carry a photo or voice note, and get reactions

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("reply_to_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="SET NULL")))
    op.add_column("messages", sa.Column("media_url", sa.Text()))
    op.add_column("messages", sa.Column("media_width", sa.Integer()))
    op.add_column("messages", sa.Column("media_height", sa.Integer()))
    op.add_column("messages", sa.Column("media_duration_ms", sa.Integer()))
    op.drop_constraint("message_kind_values", "messages", type_="check")
    op.create_check_constraint(
        "message_kind_values", "messages", "kind IN ('text', 'run_date', 'system', 'image', 'voice')"
    )
    op.create_table(
        "message_reactions",
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("emoji", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("message_reactions")
    op.execute("DELETE FROM messages WHERE kind IN ('image', 'voice')")
    op.drop_constraint("message_kind_values", "messages", type_="check")
    op.create_check_constraint("message_kind_values", "messages", "kind IN ('text', 'run_date', 'system')")
    for column in ("media_duration_ms", "media_height", "media_width", "media_url", "reply_to_id"):
        op.drop_column("messages", column)

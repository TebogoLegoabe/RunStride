"""Push notifications (phone tokens, settings) and Google sign-in

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_tokens",
        sa.Column("token", sa.String(200), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_push_tokens_user_id", "push_tokens", ["user_id"])
    op.add_column("users", sa.Column("notification_prefs", postgresql.JSONB()))

    # Google sign-in: an account can have a phone number, a Google account, or both
    op.add_column("users", sa.Column("google_sub", sa.String(255), unique=True))
    op.add_column("users", sa.Column("email", sa.String(320)))
    op.alter_column("users", "phone", existing_type=sa.String(20), nullable=True)
    op.create_check_constraint(
        "user_has_a_sign_in", "users", "phone IS NOT NULL OR google_sub IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_constraint("user_has_a_sign_in", "users", type_="check")
    op.alter_column("users", "phone", existing_type=sa.String(20), nullable=False)
    op.drop_column("users", "email")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "notification_prefs")
    op.drop_index("ix_push_tokens_user_id", table_name="push_tokens")
    op.drop_table("push_tokens")

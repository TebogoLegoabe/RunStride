"""otp request ip, for per-address rate limiting

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("otp_codes", sa.Column("request_ip", sa.String(45)))
    op.create_index("ix_otp_codes_request_ip_created_at", "otp_codes", ["request_ip", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_otp_codes_request_ip_created_at", table_name="otp_codes")
    op.drop_column("otp_codes", "request_ip")

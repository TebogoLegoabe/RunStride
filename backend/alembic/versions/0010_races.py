"""races, race events, attendance, race chat, chat requests, entry swap board

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "races",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("venue", sa.String(160), nullable=False),
        sa.Column("city", sa.String(80), nullable=False),
        sa.Column("province", sa.String(40)),
        sa.Column("official_url", sa.Text()),
        sa.Column("substitution_opens_on", sa.Date()),
        sa.Column("substitution_closes_on", sa.Date()),
        sa.Column("substitution_url", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="published"),
        sa.Column("suggested_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('published', 'pending', 'rejected')", name="race_status_values"),
        sa.CheckConstraint("ends_on >= starts_on", name="race_dates_in_order"),
        sa.CheckConstraint(
            "substitution_closes_on IS NULL OR substitution_opens_on IS NULL "
            "OR substitution_closes_on >= substitution_opens_on",
            name="race_substitution_window_in_order",
        ),
    )
    op.create_index("ix_races_status_starts_on", "races", ["status", "starts_on"])

    op.create_table(
        "race_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(60), nullable=False),
        sa.Column("distance_km", sa.Float(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_race_events_race_id", "race_events", ["race_id"])

    op.create_table(
        "race_attendance",
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("race_event_id", sa.Uuid(), sa.ForeignKey("race_events.id", ondelete="SET NULL")),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("role IN ('running', 'supporting')", name="attendance_role_values"),
    )
    op.create_index("ix_race_attendance_user_id", "race_attendance", ["user_id"])

    op.create_table(
        "race_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("removed_at", sa.DateTime(timezone=True)),
        sa.Column("removed_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_index("ix_race_messages_race_id_created_at", "race_messages", ["race_id", "created_at"])

    op.create_table(
        "entry_listings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="CASCADE"), nullable=False),
        sa.Column("race_event_id", sa.Uuid(), sa.ForeignKey("race_events.id", ondelete="SET NULL")),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("price_rands", sa.Integer()),
        sa.Column("note", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("kind IN ('offering', 'looking')", name="listing_kind_values"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="listing_status_values"),
        sa.CheckConstraint("price_rands IS NULL OR price_rands >= 0", name="listing_price_not_negative"),
    )
    op.create_index("ix_entry_listings_race_id_status", "entry_listings", ["race_id", "status"])

    op.add_column("matches", sa.Column("kind", sa.String(20), nullable=False, server_default="dating"))
    op.add_column(
        "matches", sa.Column("origin_race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="SET NULL"))
    )
    op.create_check_constraint("match_kind_values", "matches", "kind IN ('dating', 'race')")

    op.create_table(
        "chat_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("from_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("to_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="SET NULL")),
        sa.Column("listing_id", sa.Uuid(), sa.ForeignKey("entry_listings.id", ondelete="SET NULL")),
        sa.Column("note", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True)),
        sa.Column("match_id", sa.Uuid(), sa.ForeignKey("matches.id", ondelete="SET NULL")),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined')", name="chat_request_status_values"),
        sa.CheckConstraint("from_user_id <> to_user_id", name="chat_request_not_self"),
    )
    op.create_index("ix_chat_requests_to_user_id_status", "chat_requests", ["to_user_id", "status"])

    op.add_column("reports", sa.Column("race_id", sa.Uuid(), sa.ForeignKey("races.id", ondelete="SET NULL")))


def downgrade() -> None:
    op.drop_column("reports", "race_id")
    op.drop_index("ix_chat_requests_to_user_id_status", table_name="chat_requests")
    op.drop_table("chat_requests")
    op.drop_constraint("match_kind_values", "matches", type_="check")
    op.drop_column("matches", "origin_race_id")
    op.drop_column("matches", "kind")
    op.drop_index("ix_entry_listings_race_id_status", table_name="entry_listings")
    op.drop_table("entry_listings")
    op.drop_index("ix_race_messages_race_id_created_at", table_name="race_messages")
    op.drop_table("race_messages")
    op.drop_index("ix_race_attendance_user_id", table_name="race_attendance")
    op.drop_table("race_attendance")
    op.drop_index("ix_race_events_race_id", table_name="race_events")
    op.drop_table("race_events")
    op.drop_index("ix_races_status_starts_on", table_name="races")
    op.drop_table("races")

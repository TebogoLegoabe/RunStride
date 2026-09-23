import enum
import uuid
from datetime import date, datetime

from geoalchemy2 import Geography
from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class VerificationStatus(str, enum.Enum):
    unverified = "unverified"
    pending = "pending"
    verified = "verified"
    rejected = "rejected"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Stored in E.164 format, e.g. +27821234567
    phone: Mapped[str] = mapped_column(String(20), unique=True)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        Enum(
            VerificationStatus,
            name="verification_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        default=VerificationStatus.unverified,
        server_default=VerificationStatus.unverified.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Rounded to ~1 km before storing (see routers/discover.py); never shown to other users
    location: Mapped[object | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326, spatial_index=False)
    )
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    profile: Mapped["Profile | None"] = relationship(back_populates="user", cascade="all, delete-orphan")
    running_profile: Mapped["RunningProfile | None"] = relationship(cascade="all, delete-orphan")
    dating_preferences: Mapped["DatingPreferences | None"] = relationship(cascade="all, delete-orphan")

    @property
    def profile_complete(self) -> bool:
        return self.profile is not None and len(self.profile.photos) > 0


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(50))
    # Birth date rather than age, so age stays correct over time
    birth_date: Mapped[date] = mapped_column(Date)
    bio: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="profile")
    photos: Mapped[list["ProfilePhoto"]] = relationship(
        back_populates="profile", order_by="ProfilePhoto.position", cascade="all, delete-orphan"
    )


class ProfilePhoto(Base):
    __tablename__ = "profile_photos"
    __table_args__ = (UniqueConstraint("user_id", "position"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.user_id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    profile: Mapped[Profile] = relationship(back_populates="photos")


class RunningProfile(Base):
    """How someone runs. Filled in by hand now; Strava can populate it later."""

    __tablename__ = "running_profiles"
    __table_args__ = (
        CheckConstraint("pace_seconds_per_km BETWEEN 150 AND 1200", name="pace_range"),
        CheckConstraint("weekly_km BETWEEN 0 AND 400", name="weekly_km_range"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Typical easy-run pace, e.g. 330 = 5:30 min/km
    pace_seconds_per_km: Mapped[int] = mapped_column(SmallInteger)
    weekly_km: Mapped[int] = mapped_column(SmallInteger)
    # Allowed values live in app/schemas.py (Terrain, Goal, RunTime)
    terrains: Mapped[list[str]] = mapped_column(ARRAY(String(20)))
    goals: Mapped[list[str]] = mapped_column(ARRAY(String(20)))
    run_times: Mapped[list[str]] = mapped_column(ARRAY(String(20)))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DatingPreferences(Base):
    __tablename__ = "dating_preferences"
    __table_args__ = (
        CheckConstraint("age_min >= 18 AND age_max <= 99 AND age_min <= age_max", name="age_range"),
        CheckConstraint("max_distance_km BETWEEN 1 AND 500", name="distance_range"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    gender: Mapped[str] = mapped_column(String(20))
    interested_in: Mapped[list[str]] = mapped_column(ARRAY(String(20)))
    age_min: Mapped[int] = mapped_column(SmallInteger)
    age_max: Mapped[int] = mapped_column(SmallInteger)
    max_distance_km: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Swipe(Base):
    """One user's like or pass on another. Each pair is decided once."""

    __tablename__ = "swipes"
    __table_args__ = (Index("ix_swipes_target_id", "target_id"),)

    swiper_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    liked: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Match(Base):
    """Two users who liked each other. user_a_id < user_b_id so each pair is stored once."""

    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id"),
        CheckConstraint("user_a_id < user_b_id", name="ordered_pair"),
        Index("ix_matches_user_b_id", "user_b_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_a_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    user_b_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Set when either person unmatches. The chat closes, but messages are kept for safety reports.
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    def other_user_id(self, user_id: uuid.UUID) -> uuid.UUID:
        return self.user_b_id if self.user_a_id == user_id else self.user_a_id


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_match_id_created_at", "match_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"))
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # When the other person saw it
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VerificationInquiry(Base):
    """One attempt at ID verification with the provider (Persona)."""

    __tablename__ = "verification_inquiries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    provider_inquiry_id: Mapped[str] = mapped_column(String(64), unique=True)
    # The provider's own status (e.g. Persona: created, pending, completed, approved, declined...)
    provider_status: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OtpCode(Base):
    __tablename__ = "otp_codes"
    __table_args__ = (Index("ix_otp_codes_phone_created_at", "phone", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    phone: Mapped[str] = mapped_column(String(20))
    # HMAC of the code, never the code itself
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Set when the code is used, or when a newer code replaces it
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

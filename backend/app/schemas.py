import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from app.models import VerificationStatus


class CamelModel(BaseModel):
    """JSON uses camelCase to match the TypeScript client; Python stays snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class OtpSendRequest(CamelModel):
    phone: str = Field(min_length=1, max_length=32)


class OtpSendResponse(CamelModel):
    sent: bool
    # Normalized E.164 number; the client should send this back to /otp/verify
    phone: str


class OtpVerifyRequest(CamelModel):
    phone: str = Field(min_length=1, max_length=32)
    code: str = Field(pattern=r"^\d{6}$")


class OtpVerifyResponse(CamelModel):
    token: str
    user_id: uuid.UUID
    profile_complete: bool


class MeResponse(CamelModel):
    id: uuid.UUID
    phone: str
    verification_status: VerificationStatus
    # False only in development while ID verification is switched off
    verification_required: bool
    profile_complete: bool
    has_running_profile: bool
    has_dating_preferences: bool
    has_location: bool
    is_admin: bool


MIN_AGE = 18


def age_on(birth_date: date, today: date) -> int:
    had_birthday = (today.month, today.day) >= (birth_date.month, birth_date.day)
    return today.year - birth_date.year - (0 if had_birthday else 1)


class ProfileUpsertRequest(CamelModel):
    display_name: str = Field(max_length=50)
    birth_date: date
    bio: str | None = Field(default=None, max_length=500)

    @field_validator("display_name")
    @classmethod
    def display_name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Please enter your name.")
        return v

    @field_validator("birth_date")
    @classmethod
    def adults_only(cls, v: date) -> date:
        today = date.today()
        if v.year < 1900 or v > today:
            raise ValueError("Please enter a valid date of birth.")
        if age_on(v, today) < MIN_AGE:
            raise ValueError("You must be 18 or older to use RunStride.")
        return v

    @field_validator("bio")
    @classmethod
    def blank_bio_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class PhotoResponse(CamelModel):
    id: uuid.UUID
    url: str
    position: int


class ProfileResponse(CamelModel):
    display_name: str
    birth_date: date
    age: int
    bio: str | None
    photos: list[PhotoResponse]


class VerificationStateResponse(CamelModel):
    status: VerificationStatus
    attempts_remaining: int
    # True when the user can open the verification flow (new attempt or resume)
    can_start: bool


class VerificationStartResponse(CamelModel):
    verification_url: str


Terrain = Literal["road", "trail", "track", "treadmill"]
Goal = Literal["social", "fitness", "5k", "10k", "half_marathon", "marathon", "ultra"]
RunTime = Literal["early_morning", "morning", "lunchtime", "evening"]
Gender = Literal["woman", "man", "non_binary"]


def _dedupe(values: list) -> list:
    return list(dict.fromkeys(values))


class RunningProfileBody(CamelModel):
    # 2:30 to 20:00 min/km
    pace_seconds_per_km: int = Field(ge=150, le=1200)
    weekly_km: int = Field(ge=0, le=400)
    terrains: list[Terrain] = Field(min_length=1)
    goals: list[Goal] = Field(min_length=1)
    run_times: list[RunTime] = Field(default_factory=list)

    _dedupe_lists = field_validator("terrains", "goals", "run_times")(_dedupe)


class DatingPreferencesBody(CamelModel):
    gender: Gender
    interested_in: list[Gender] = Field(min_length=1)
    age_min: int = Field(ge=18, le=99)
    age_max: int = Field(ge=18, le=99)
    max_distance_km: int = Field(ge=1, le=500)

    _dedupe_lists = field_validator("interested_in")(_dedupe)

    @model_validator(mode="after")
    def age_range_in_order(self) -> "DatingPreferencesBody":
        if self.age_min > self.age_max:
            raise ValueError("Minimum age can't be higher than maximum age.")
        return self


class LocationBody(CamelModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class DiscoverCard(CamelModel):
    user_id: uuid.UUID
    display_name: str
    age: int
    bio: str | None
    photos: list[str]
    # Whole km, at least 1. Locations are stored rounded, so this is approximate by design.
    distance_km: int
    verified: bool
    compatibility: int
    pace_seconds_per_km: int
    weekly_km: int
    terrains: list[str]
    goals: list[str]
    run_times: list[str]


class MatchSummary(CamelModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    photo: str | None
    matched_at: datetime
    last_message: "LastMessage | None" = None
    unread_count: int = 0


class SwipeResponse(CamelModel):
    matched: bool
    match: MatchSummary | None = None


class MessageBody(CamelModel):
    body: str = Field(max_length=1000)

    @field_validator("body")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message can't be empty.")
        return v


class RunDateOut(CamelModel):
    id: uuid.UUID
    match_id: uuid.UUID
    proposed_by_id: uuid.UUID
    starts_at: datetime
    place: str
    distance_km: int | None
    note: str | None
    status: str
    responded_at: datetime | None


class MessageOut(CamelModel):
    id: uuid.UUID
    match_id: uuid.UUID
    sender_id: uuid.UUID
    kind: str = "text"
    body: str
    created_at: datetime
    read_at: datetime | None
    # Current state of the run, for run_date cards
    run_date: RunDateOut | None = None


class LastMessage(CamelModel):
    body: str
    sender_id: uuid.UUID
    created_at: datetime


MatchSummary.model_rebuild()
SwipeResponse.model_rebuild()


ReportReason = Literal["fake_profile", "harassment", "inappropriate", "underage", "unsafe_meeting", "spam", "other"]
ModerationAction = Literal["dismiss", "warn", "suspend", "ban"]


class ReportBody(CamelModel):
    reported_user_id: uuid.UUID
    match_id: uuid.UUID | None = None
    reason: ReportReason
    details: str | None = Field(default=None, max_length=1000)

    @field_validator("details")
    @classmethod
    def blank_details_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None

    @model_validator(mode="after")
    def other_needs_details(self) -> "ReportBody":
        if self.reason == "other" and not self.details:
            raise ValueError("Please tell us what happened.")
        return self


class ReportCreated(CamelModel):
    id: uuid.UUID


class ReportPerson(CamelModel):
    id: uuid.UUID | None
    display_name: str | None


class ReportedPerson(ReportPerson):
    account_status: str | None
    open_report_count: int
    total_report_count: int


class ReportSummary(CamelModel):
    id: uuid.UUID
    reason: str
    details: str | None
    status: str
    created_at: datetime
    reporter: ReportPerson
    reported: ReportedPerson
    resolution: str | None
    resolution_note: str | None
    resolved_at: datetime | None


class ReportDetail(ReportSummary):
    evidence: dict


class ResolveBody(CamelModel):
    action: ModerationAction
    note: str | None = Field(default=None, max_length=1000)
    suspend_days: int | None = Field(default=None, ge=1, le=365)

    @model_validator(mode="after")
    def suspend_needs_days(self) -> "ResolveBody":
        if self.action == "suspend" and self.suspend_days is None:
            raise ValueError("Choose how many days to suspend for.")
        return self


MAX_DAYS_AHEAD = 60


class RunDateBody(CamelModel):
    starts_at: datetime
    place: str = Field(max_length=120)
    distance_km: int | None = Field(default=None, ge=1, le=100)
    note: str | None = Field(default=None, max_length=300)

    @field_validator("starts_at")
    @classmethod
    def sensible_time(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("Include a timezone with the start time.")
        now = datetime.now(v.tzinfo)
        if v <= now:
            raise ValueError("Pick a time in the future.")
        if (v - now).days >= MAX_DAYS_AHEAD:
            raise ValueError(f"Runs can be planned up to {MAX_DAYS_AHEAD} days ahead.")
        return v

    @field_validator("place")
    @classmethod
    def place_given(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Please say where to meet.")
        return v

    @field_validator("note")
    @classmethod
    def blank_note_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


MAX_TRUSTED_CONTACTS = 3


class TrustedContactBody(CamelModel):
    name: str = Field(max_length=60)
    phone: str = Field(max_length=32)

    @field_validator("name")
    @classmethod
    def name_given(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Please enter their name.")
        return v


class TrustedContactOut(CamelModel):
    id: uuid.UUID
    name: str
    phone: str


class LocationUpdate(CamelModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)


class ShareOut(CamelModel):
    id: uuid.UUID
    # active / alert / ended / expired
    status: str
    url: str
    started_at: datetime
    expires_at: datetime
    alert_at: datetime | None
    location_at: datetime | None


class CheckInBody(CamelModel):
    outcome: Literal["ok", "problem"]


class RunSafetyOut(CamelModel):
    """Everything the run safety screen needs for one run date."""

    run: RunDateOut
    other_user_id: uuid.UUID
    other_name: str
    share_opens_at: datetime
    share_closes_at: datetime
    share: ShareOut | None
    trusted_contacts: list[TrustedContactOut]
    check_in: str | None

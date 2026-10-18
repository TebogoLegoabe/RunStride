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
    # Lets this phone sign back in without a new text for a while; the app keeps it, even after sign-out
    device_token: str | None = None


class DeviceSignInBody(CamelModel):
    phone: str = Field(min_length=1, max_length=32)
    device_token: str = Field(min_length=20, max_length=200)


class MeResponse(CamelModel):
    id: uuid.UUID
    phone: str | None  # empty for Google-only accounts
    email: str | None
    has_google: bool
    verification_status: VerificationStatus
    # False only in development while ID verification is switched off
    verification_required: bool
    id_check_available: bool = False  # manual ID checks are set up
    verification_available: bool = False  # Persona is set up, so the app can offer "Get verified"
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
    # Running clubs or groups (optional, up to 3): a local club, parkrun, a company run club...
    clubs: list[str] = Field(default_factory=list)

    _dedupe_lists = field_validator("terrains", "goals", "run_times")(_dedupe)

    @field_validator("clubs")
    @classmethod
    def tidy_clubs(cls, value: list[str]) -> list[str]:
        from app.clubs import MAX_CLUB_LENGTH, MAX_CLUBS, club_key, clean_club

        seen: set[str] = set()
        out: list[str] = []
        for raw in value:
            name = clean_club(raw)
            if not name:
                continue
            if len(name) < 2 or len(name) > MAX_CLUB_LENGTH or "http" in name.casefold() or "@" in name:
                raise ValueError("A club name should be 2 to 60 characters, with no links.")
            if club_key(name) not in seen:
                seen.add(club_key(name))
                out.append(name)
        if len(out) > MAX_CLUBS:
            raise ValueError(f"You can add up to {MAX_CLUBS} clubs.")
        return out


class SearchDistanceBody(CamelModel):
    max_distance_km: int = Field(ge=1, le=2000)


class DatingPreferencesBody(CamelModel):
    gender: Gender
    interested_in: list[Gender] = Field(min_length=1)
    age_min: int = Field(ge=18, le=99)
    age_max: int = Field(ge=18, le=99)
    max_distance_km: int = Field(ge=1, le=2000)  # 2000: anywhere in South Africa

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
    clubs: list[str] = Field(default_factory=list)
    # Their clubs that you're in too: "you both run with..."
    shared_clubs: list[str] = Field(default_factory=list)
    shared_races: list["SharedRace"] = Field(default_factory=list)
    # They've already liked you. Only shown to Plus members.
    likes_you: bool = False


class MatchSummary(CamelModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    photo: str | None
    matched_at: datetime
    last_message: "LastMessage | None" = None
    unread_count: int = 0
    kind: str = "dating"
    origin_race_name: str | None = None
    verified: bool = False


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




ReportReason = Literal["fake_profile", "harassment", "inappropriate", "underage", "unsafe_meeting", "spam", "other"]
ModerationAction = Literal["dismiss", "warn", "suspend", "ban"]


class ReportBody(CamelModel):
    reported_user_id: uuid.UUID
    match_id: uuid.UUID | None = None
    race_id: uuid.UUID | None = None
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


# --- Races ---

Province = Literal[
    "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
    "Mpumalanga", "Northern Cape", "North West", "Western Cape",
]
AttendanceRole = Literal["running", "supporting"]
# Swap board state for a race: open (inside the official window), upcoming, closed,
# or none (the organiser hasn't published a transfer window, so no swaps)
SwapWindow = Literal["open", "upcoming", "closed", "none"]


def _blank_to_none(v: str | None) -> str | None:
    return (v or "").strip() or None


class RaceEventBody(CamelModel):
    # Set when editing an existing distance, so people who chose it keep their choice
    id: uuid.UUID | None = None
    label: str = Field(min_length=1, max_length=60)
    distance_km: float = Field(gt=0, le=1000)
    starts_at: datetime | None = None


class RaceEventOut(RaceEventBody):
    id: uuid.UUID  # type: ignore[assignment]  # always set on the way out
    runner_count: int = 0


class RaceBody(CamelModel):
    """An admin creating or editing a race."""

    name: str = Field(min_length=2, max_length=120)
    starts_on: date
    ends_on: date | None = None  # defaults to starts_on
    venue: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=80)
    province: Province | None = None
    official_url: str | None = Field(default=None, max_length=500)
    substitution_opens_on: date | None = None
    substitution_closes_on: date | None = None
    substitution_url: str | None = Field(default=None, max_length=500)
    # Exact position, if known. Otherwise it's worked out from the town.
    latitude: float | None = Field(default=None, ge=-35.5, le=-21.5)
    longitude: float | None = Field(default=None, ge=16, le=33.5)
    events: list[RaceEventBody] = Field(default_factory=list, max_length=20)

    _blanks = field_validator("official_url", "substitution_url")(_blank_to_none)

    @model_validator(mode="after")
    def dates_in_order(self) -> "RaceBody":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Give both the latitude and the longitude, or neither.")
        if self.ends_on is None:
            self.ends_on = self.starts_on
        if self.ends_on < self.starts_on:
            raise ValueError("The race can't end before it starts.")
        opens, closes = self.substitution_opens_on, self.substitution_closes_on
        if (opens is None) != (closes is None):
            raise ValueError("Give both the first and last day of the substitution window, or neither.")
        if opens and closes and closes < opens:
            raise ValueError("The substitution window can't close before it opens.")
        return self


class SuggestedDistance(CamelModel):
    label: str = Field(min_length=1, max_length=60)
    distance_km: float = Field(gt=0, le=1000)


class RaceSuggestionBody(CamelModel):
    """A user suggesting a race that's missing. An admin reviews it before it's listed."""

    name: str = Field(min_length=2, max_length=120)
    starts_on: date
    venue: str = Field(min_length=2, max_length=160)
    city: str = Field(min_length=2, max_length=80)
    official_url: str | None = Field(default=None, max_length=500)
    # At least one, so runners can say which distance they're doing once it's approved
    events: list[SuggestedDistance] = Field(min_length=1, max_length=10)

    _blanks = field_validator("official_url")(_blank_to_none)


class MyAttendance(CamelModel):
    role: AttendanceRole
    race_event_id: uuid.UUID | None
    event_label: str | None


class RaceSummary(CamelModel):
    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    venue: str
    city: str
    province: str | None
    status: str
    attending_count: int
    my_attendance: MyAttendance | None
    # Race chat messages mentioning you since you last opened the chat
    unread_mentions: int = 0
    # Swap board posts matching yours since you last looked (Plus or race pass only)
    unread_swap_matches: int = 0
    # How far the race is from you, in km, when we know where you both are
    distance_km: float | None = None


class RaceDetail(RaceSummary):
    official_url: str | None
    substitution_opens_on: date | None
    substitution_closes_on: date | None
    substitution_url: str | None
    swap_window: SwapWindow
    events: list[RaceEventOut]


class AttendanceBody(CamelModel):
    role: AttendanceRole
    race_event_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def runners_pick_a_distance(self) -> "AttendanceBody":
        if self.role == "running" and self.race_event_id is None:
            raise ValueError("Choose which distance you're running.")
        return self


Connection = Literal["none", "requested", "incoming", "connected"]


class Attendee(CamelModel):
    user_id: uuid.UUID
    display_name: str
    age: int
    photo: str | None
    verified: bool
    role: AttendanceRole
    event_label: str | None
    # Where you stand with them: nothing yet, you asked, they asked, or already chatting
    connection: Connection
    match_id: uuid.UUID | None = None
    request_id: uuid.UUID | None = None


class Sender(CamelModel):
    id: uuid.UUID
    display_name: str
    photo: str | None


class RaceMessageOut(CamelModel):
    id: uuid.UUID
    race_id: uuid.UUID
    sender: Sender
    # Mentions appear in the body as <@user-id>; show them with these names
    body: str
    mentions: list[Sender] = []
    created_at: datetime


class Mentionable(Sender):
    # "Running 30 km trail" or "Supporting": tells apart two people with the same name
    going: str


class MentionCount(CamelModel):
    count: int


class EntryWantsBody(CamelModel):
    """The distances you want an entry for at this race (replaces what was there)."""

    race_event_ids: list[uuid.UUID] = Field(max_length=20)


class EntryWantsOut(CamelModel):
    race_event_ids: list[uuid.UUID]
    # Alerts are sent with Plus or a race pass; without, your wants still show sellers the demand
    alerts: bool


class RaceAlerts(CamelModel):
    """Unread race activity for the Races tab badge."""

    mentions: int
    swap_matches: int


class ListingBody(CamelModel):
    kind: Literal["offering", "looking"]
    race_event_id: uuid.UUID
    price_rands: int | None = Field(default=None, ge=0, le=100_000)
    note: str | None = Field(default=None, max_length=300)

    _blanks = field_validator("note")(_blank_to_none)

    @model_validator(mode="after")
    def price_only_when_offering(self) -> "ListingBody":
        if self.kind == "looking":
            self.price_rands = None
        return self


class ListingOut(CamelModel):
    id: uuid.UUID
    race_id: uuid.UUID
    kind: str
    race_event_id: uuid.UUID | None
    event_label: str | None
    price_rands: int | None
    note: str | None
    status: str
    created_at: datetime
    user: Sender
    mine: bool
    seller_verified: bool = False  # the poster passed the ID check
    # Open posts the other way for the same distance, e.g. people looking for the entry offered
    interested_count: int = 0


class ChatRequestBody(CamelModel):
    to_user_id: uuid.UUID
    race_id: uuid.UUID | None = None
    listing_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=300)

    _blanks = field_validator("note")(_blank_to_none)


class ChatRequestOut(CamelModel):
    id: uuid.UUID
    status: str
    created_at: datetime
    note: str | None
    race_id: uuid.UUID | None
    race_name: str | None
    listing_kind: str | None
    # The other person (sender for incoming requests, recipient for outgoing)
    other: Sender
    incoming: bool
    match_id: uuid.UUID | None


class SharedRace(CamelModel):
    race_id: uuid.UUID
    name: str
    starts_on: date
    event_label: str | None


DiscoverCard.model_rebuild()
MatchSummary.model_rebuild()
SwipeResponse.model_rebuild()


# --- Membership ---


class PlusOut(CamelModel):
    active: bool
    expires_at: datetime | None  # empty while active: doesn't expire
    source: str | None  # store, admin (e.g. beta testers) or dev


class RacePassOut(CamelModel):
    race_id: uuid.UUID
    race_name: str
    expires_at: datetime


class MembershipLimits(CamelModel):
    """The free tier's limits (Plus has none)."""

    daily_likes: int
    likes_used_today: int
    runners_visible_per_race: int
    chat_requests_per_race: int


class MembershipOut(CamelModel):
    plus: PlusOut
    dating_mode: Literal["looking", "taken"]
    race_pass_credits: int  # bought but not yet used on a race
    race_passes: list[RacePassOut]
    limits: MembershipLimits
    # Development: purchases are granted straight away, with no store and no charge
    test_purchases: bool
    # Free Plus they can switch on once during the beta: how many days (0: not on offer)
    beta_offer_days: int = 0


class DatingModeBody(CamelModel):
    mode: Literal["looking", "taken"]


class TestPurchaseBody(CamelModel):
    product_id: Literal["plus_weekly", "plus_monthly", "race_pass"]
    race_id: uuid.UUID | None = None  # race passes: use it on this race straight away


class IdCheckState(CamelModel):
    available: bool
    status: str  # none | pending | approved | rejected
    reject_reason: str | None = None
    attempts_left: int = 0


class IdReview(CamelModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    age: int
    birth_date: date
    id_number: str | None
    born_matches: bool  # the ID number's birth date equals the profile's
    id_photo_url: str | None
    selfie_url: str | None
    profile_photos: list[str]
    submitted_at: datetime


class IdRejectBody(CamelModel):
    reason: str = Field(min_length=3, max_length=200)


class FeedbackBody(CamelModel):
    body: str = Field(min_length=3, max_length=2000)
    platform: str | None = Field(default=None, max_length=20)
    screen: str | None = Field(default=None, max_length=120)


class FeedbackOut(CamelModel):
    id: uuid.UUID
    body: str
    platform: str | None
    screen: str | None
    status: str
    created_at: datetime
    user_id: uuid.UUID | None
    display_name: str | None
    phone: str | None


class ClientErrorBody(CamelModel):
    message: str = Field(max_length=1000)
    stack: str | None = Field(default=None, max_length=8000)
    platform: str | None = Field(default=None, max_length=20)
    screen: str | None = Field(default=None, max_length=200)
    fatal: bool = False


class PollOption(CamelModel):
    value: str
    label: str


class PollOut(CamelModel):
    id: str
    question: str
    options: list[PollOption]
    answered: bool


class PollAnswerBody(CamelModel):
    answer: str = Field(max_length=40)


class PollResults(CamelModel):
    id: str
    question: str
    total: int
    counts: dict[str, int]


class DayCount(CamelModel):
    day: date
    count: int


class AdminStats(CamelModel):
    users_total: int
    profiles_complete: int
    new_today: int
    new_week: int
    active_now: int  # seen in the last 5 minutes
    active_day: int
    active_week: int
    active_month: int
    plus_active: int
    verified: int
    with_google: int
    suspended_or_banned: int
    matches_total: int
    messages_day: int
    races_published: int
    pending_races: int
    open_reports: int
    pending_id_checks: int
    open_feedback: int = 0
    signups_by_day: list[DayCount]  # the last 14 days


class AdminUserRow(CamelModel):
    id: uuid.UUID
    display_name: str | None
    phone: str | None
    email: str | None
    created_at: datetime
    last_seen_at: datetime | None
    account_status: str
    verification_status: str
    plus_active: bool
    plus_source: str | None
    plus_until: datetime | None
    has_google: bool
    profile_complete: bool
    is_admin: bool


class UserStatusBody(CamelModel):
    action: Literal["suspend", "ban", "reinstate"]
    days: int = Field(default=7, ge=1, le=365)


class AdminPlusBody(CamelModel):
    days: int | None = Field(default=None, ge=1, le=3650)  # empty: until removed


class RaceImportResult(CamelModel):
    imported: bool  # false: nothing was saved, fix the listed rows and send it again
    added: int = 0
    updated: int = 0
    errors: list[str] = []


class SmsStatus(CamelModel):
    """How the SMS budget is doing, for admins."""

    provider: str
    credits_left: float | None  # None: unknown (console provider, or BulkSMS didn't say)
    sent_today: int  # sign-in codes in the last 24 hours
    daily_cap: int
    low: bool  # under a week's worth at today's pace, or under 200 credits


class GrantPlusBody(CamelModel):
    """An admin giving someone Plus, e.g. a beta tester. No days: until it's taken away."""

    phone: str
    days: int | None = Field(default=None, ge=1, le=3650)


class LikesYouOut(CamelModel):
    count: int
    # Only with Plus
    people: list[Sender]


class RaceRunnersOut(CamelModel):
    runners: list[Attendee]
    # Going, but not shown without Plus or a race pass
    hidden_count: int
    full_access: bool


# --- Push notifications ---


class NotificationSettings(CamelModel):
    enabled: bool = True  # off: no push at all; you see things only while the app is open
    messages: bool = True  # chat messages and run plans
    matches: bool = True  # new matches and chat requests
    races: bool = True  # @mentions in race chats
    swaps: bool = True  # entry alerts


class PushTokenBody(CamelModel):
    token: str = Field(min_length=10, max_length=200)
    platform: Literal["ios", "android"]


# --- Google sign-in ---


class GoogleAuthBody(CamelModel):
    id_token: str = Field(min_length=20, max_length=4096)


class GoogleAuthResponse(CamelModel):
    token: str
    user_id: uuid.UUID
    profile_complete: bool
    # From the Google account, to fill in the profile form for new accounts
    suggested_name: str | None = None


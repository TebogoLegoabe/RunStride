"""Races: browse and join races, see who's going, the race group chat and the entry swap board."""

import uuid
from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, aliased

from app.config import Settings
from app.deps import AppSettings, CurrentUser, DbSession
from app.models import (
    Block,
    ChatRequest,
    EntryListing,
    Profile,
    ProfilePhoto,
    Race,
    RaceAttendance,
    RaceEvent,
    RaceMessage,
    User,
    VerificationStatus,
)
from app.moderation import match_between, not_blocked_with
from app.races import (
    MAX_MENTIONS,
    event_label,
    get_race,
    mention_ids,
    my_attendance,
    require_attending,
    sa_today,
    sender,
    swap_window,
    visible_to,
)
from app.realtime import hub
from app.schemas import (
    Attendee,
    AttendanceBody,
    ListingBody,
    ListingOut,
    MentionCount,
    Mentionable,
    MessageBody,
    MyAttendance,
    RaceDetail,
    RaceEventOut,
    RaceMessageOut,
    RaceSuggestionBody,
    Sender,
    RaceSummary,
    age_on,
)
from app.security import utcnow

router = APIRouter(tags=["races"])

# Group chats are busier than one-to-one chats, so they get their own limits
RACE_MESSAGES_PER_MINUTE = 10
NEW_ACCOUNT_RACE_MESSAGES_PER_HOUR = 20
MAX_SUGGESTIONS_PER_DAY = 5
MAX_OPEN_LISTINGS_PER_RACE = 2
RACE_CHAT_PAGE = 50

# Distance filter buckets, as [min, max) in km. Generous ranges, because races label
# distances loosely (an "11 km" sits with the 10Ks, a "56 km" Two Oceans with ultras).
DistanceBucket = Literal["5k", "10k", "half", "marathon", "ultra"]
DISTANCE_BUCKETS: dict[str, tuple[float, float]] = {
    "5k": (0, 8),
    "10k": (8, 15),
    "half": (15, 30),
    "marathon": (30, 43),
    "ultra": (43, 1000),
}


def _attending_count(db: Session, race_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(RaceAttendance).where(RaceAttendance.race_id == race_id))


def _my_attendance_out(db: Session, race_id: uuid.UUID, me: User) -> MyAttendance | None:
    attendance = my_attendance(db, race_id, me.id)
    if attendance is None:
        return None
    return MyAttendance(
        role=attendance.role,
        race_event_id=attendance.race_event_id,
        event_label=event_label(db, attendance.race_event_id),
    )


def _summary_fields(db: Session, race: Race, me: User) -> dict:
    return dict(
        id=race.id,
        name=race.name,
        starts_on=race.starts_on,
        ends_on=race.ends_on,
        venue=race.venue,
        city=race.city,
        province=race.province,
        status=race.status,
        attending_count=_attending_count(db, race.id),
        my_attendance=_my_attendance_out(db, race.id, me),
        unread_mentions=_unread_mentions(db, me, race.id),
    )


def race_detail(db: Session, race: Race, me: User) -> RaceDetail:
    runner_counts = dict(
        db.execute(
            select(RaceAttendance.race_event_id, func.count())
            .where(RaceAttendance.race_id == race.id, RaceAttendance.role == "running")
            .group_by(RaceAttendance.race_event_id)
        ).all()
    )
    return RaceDetail(
        **_summary_fields(db, race, me),
        official_url=race.official_url,
        substitution_opens_on=race.substitution_opens_on,
        substitution_closes_on=race.substitution_closes_on,
        substitution_url=race.substitution_url,
        swap_window=swap_window(race, sa_today()),
        events=[
            RaceEventOut(
                id=e.id,
                label=e.label,
                distance_km=e.distance_km,
                starts_at=e.starts_at,
                runner_count=runner_counts.get(e.id, 0),
            )
            for e in race.events
        ],
    )


def _check_message_limits(db: Session, me: User, settings: Settings) -> None:
    now = utcnow()

    def sent_since(since) -> int:
        return db.scalar(
            select(func.count())
            .select_from(RaceMessage)
            .where(RaceMessage.sender_id == me.id, RaceMessage.created_at > since)
        )

    if sent_since(now - timedelta(minutes=1)) >= RACE_MESSAGES_PER_MINUTE:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="You're posting too quickly. Please slow down.")
    if me.created_at > now - timedelta(hours=settings.new_account_hours):
        if sent_since(now - timedelta(hours=1)) >= NEW_ACCOUNT_RACE_MESSAGES_PER_HOUR:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="New accounts can post a limited number of race messages an hour. This lifts after your first day.",
            )


def _message_out(db: Session, msg: RaceMessage) -> RaceMessageOut:
    return RaceMessageOut(
        id=msg.id,
        race_id=msg.race_id,
        sender=sender(db, msg.sender_id),
        body=msg.body,
        mentions=[sender(db, user_id) for user_id in msg.mentioned_user_ids],
        created_at=msg.created_at,
    )


def _not_blocked_sender(me_id: uuid.UUID):
    """SQL condition on RaceMessage: hide messages from people either side has blocked."""
    return ~exists().where(
        or_(
            and_(Block.blocker_id == me_id, Block.blocked_id == RaceMessage.sender_id),
            and_(Block.blocker_id == RaceMessage.sender_id, Block.blocked_id == me_id),
        )
    )


def _unread_mentions(db: Session, me: User, race_id: uuid.UUID | None = None) -> int:
    """Race chat messages mentioning me since I last opened that chat. Without race_id: across
    all the upcoming races I'm going to."""
    stmt = (
        select(func.count())
        .select_from(RaceMessage)
        .join(
            RaceAttendance,
            and_(RaceAttendance.race_id == RaceMessage.race_id, RaceAttendance.user_id == me.id),
        )
        .where(
            RaceMessage.mentioned_user_ids.contains([me.id]),
            RaceMessage.removed_at.is_(None),
            RaceMessage.created_at > func.coalesce(RaceAttendance.mentions_seen_at, RaceAttendance.created_at),
            _not_blocked_sender(me.id),
        )
    )
    if race_id is not None:
        stmt = stmt.where(RaceMessage.race_id == race_id)
    else:
        stmt = stmt.join(Race, Race.id == RaceMessage.race_id).where(Race.ends_on >= sa_today())
    return db.scalar(stmt) or 0


# --- Browsing races ---


@router.get("/races", response_model=list[RaceSummary])
def list_races(
    user: CurrentUser,
    db: DbSession,
    response: Response,
    q: Annotated[str | None, Query(max_length=80)] = None,
    province: Annotated[str | None, Query(max_length=40)] = None,
    mine: bool = False,
    date_from: date | None = None,
    date_to: date | None = None,
    distance: Annotated[list[DistanceBucket] | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[RaceSummary]:
    """Upcoming published races, soonest first, a page at a time.

    `mine`: only races you've joined. `date_from`/`date_to`: races happening on any day in
    that range. `distance` (repeatable): races with at least one distance in each bucket's
    range, e.g. ?distance=half&distance=marathon for races offering a half or a marathon.
    A page shorter than `limit` is the last one. The X-Total-Count header holds how many
    races match in all, for page numbers and "Showing 1-20 of 142".
    """
    stmt = select(Race).where(Race.status == "published", Race.ends_on >= max(sa_today(), date_from or sa_today()))
    if date_to is not None:
        stmt = stmt.where(Race.starts_on <= date_to)
    if q:
        stmt = stmt.where(or_(Race.name.ilike(f"%{q}%"), Race.city.ilike(f"%{q}%"), Race.venue.ilike(f"%{q}%")))
    if province:
        stmt = stmt.where(Race.province == province)
    if mine:
        stmt = stmt.where(exists().where(RaceAttendance.race_id == Race.id, RaceAttendance.user_id == user.id))
    if distance:
        in_any_bucket = or_(
            *(
                and_(RaceEvent.distance_km >= DISTANCE_BUCKETS[b][0], RaceEvent.distance_km < DISTANCE_BUCKETS[b][1])
                for b in distance
            )
        )
        stmt = stmt.where(exists().where(RaceEvent.race_id == Race.id, in_any_bucket))
    response.headers["X-Total-Count"] = str(db.scalar(select(func.count()).select_from(stmt.subquery())))
    races = db.scalars(stmt.order_by(Race.starts_on, Race.name, Race.id).offset(offset).limit(limit)).all()
    return [RaceSummary(**_summary_fields(db, r, user)) for r in races]


@router.get("/races/{race_id}", response_model=RaceDetail)
def get_race_detail(race_id: uuid.UUID, user: CurrentUser, db: DbSession) -> RaceDetail:
    return race_detail(db, get_race(db, race_id, user), user)


@router.post("/races/suggestions", response_model=RaceSummary, status_code=status.HTTP_201_CREATED)
def suggest_race(body: RaceSuggestionBody, user: CurrentUser, db: DbSession) -> RaceSummary:
    """Suggest a missing race. It's listed once an admin has checked and approved it."""
    if body.starts_on < sa_today():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That date has already passed.")
    recent = db.scalar(
        select(func.count())
        .select_from(Race)
        .where(Race.suggested_by_id == user.id, Race.created_at > utcnow() - timedelta(days=1))
    )
    if recent >= MAX_SUGGESTIONS_PER_DAY:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Thanks! That's plenty of suggestions for today.")
    race = Race(
        name=body.name.strip(),
        starts_on=body.starts_on,
        ends_on=body.starts_on,
        venue=body.venue.strip(),
        city=body.city.strip(),
        official_url=body.official_url,
        status="pending",
        suggested_by_id=user.id,
    )
    # The same distance picked twice (e.g. a preset and a custom row) is listed once
    seen: set[float] = set()
    for event in body.events:
        km = round(event.distance_km, 2)
        if km not in seen:
            seen.add(km)
            race.events.append(RaceEvent(label=event.label.strip(), distance_km=km))
    db.add(race)
    db.commit()
    return RaceSummary(**_summary_fields(db, race, user))


# --- Going to a race ---


@router.put("/races/{race_id}/attendance", response_model=RaceDetail)
def set_attendance(race_id: uuid.UUID, body: AttendanceBody, user: CurrentUser, db: DbSession) -> RaceDetail:
    race = get_race(db, race_id, user)
    if race.status != "published":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This race hasn't been approved yet.")
    if race.ends_on < sa_today():
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This race has already happened.")
    event_id = body.race_event_id if body.role == "running" else None
    if event_id is not None and not any(e.id == event_id for e in race.events):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That distance isn't part of this race.")
    db.execute(
        pg_insert(RaceAttendance)
        .values(race_id=race.id, user_id=user.id, role=body.role, race_event_id=event_id)
        .on_conflict_do_update(
            index_elements=["race_id", "user_id"], set_={"role": body.role, "race_event_id": event_id}
        )
    )
    db.commit()
    return race_detail(db, race, user)


@router.delete("/races/{race_id}/attendance", response_model=RaceDetail)
def leave_race(race_id: uuid.UUID, user: CurrentUser, db: DbSession) -> RaceDetail:
    race = get_race(db, race_id, user)
    attendance = my_attendance(db, race.id, user.id)
    if attendance is not None:
        db.delete(attendance)
        # Your swap board posts go with you
        for listing in db.scalars(
            select(EntryListing).where(
                EntryListing.race_id == race.id, EntryListing.user_id == user.id, EntryListing.status == "open"
            )
        ):
            listing.status = "closed"
            listing.closed_at = utcnow()
        db.commit()
    return race_detail(db, race, user)


@router.get("/races/{race_id}/attendees", response_model=list[Attendee])
def list_attendees(
    race_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    race_event_id: uuid.UUID | None = None,
) -> list[Attendee]:
    """Who else is going. Only visible once you've joined the race yourself."""
    race = get_race(db, race_id, user)
    require_attending(db, race, user)
    stmt = (
        select(User, RaceAttendance)
        .join(RaceAttendance, RaceAttendance.user_id == User.id)
        .where(RaceAttendance.race_id == race.id, *visible_to(user, settings))
        .order_by(RaceAttendance.created_at.desc())
        .limit(300)
    )
    if race_event_id is not None:
        stmt = stmt.where(RaceAttendance.race_event_id == race_event_id)
    rows = db.execute(stmt).all()

    pending = db.scalars(
        select(ChatRequest).where(
            ChatRequest.status == "pending",
            or_(ChatRequest.from_user_id == user.id, ChatRequest.to_user_id == user.id),
        )
    ).all()
    outgoing = {r.to_user_id: r for r in pending if r.from_user_id == user.id}
    incoming = {r.from_user_id: r for r in pending if r.to_user_id == user.id}
    labels = {e.id: e.label for e in race.events}
    today = sa_today()

    attendees = []
    for other, attendance in rows:
        match = match_between(db, user.id, other.id)
        if match is not None and match.ended_at is not None:
            continue  # unmatched before: don't put them back in front of each other
        if match is not None:
            connection, request = "connected", None
        elif other.id in incoming:
            connection, request = "incoming", incoming[other.id]
        elif other.id in outgoing:
            connection, request = "requested", outgoing[other.id]
        else:
            connection, request = "none", None
        photo = db.scalar(
            select(ProfilePhoto.url).where(ProfilePhoto.user_id == other.id).order_by(ProfilePhoto.position).limit(1)
        )
        attendees.append(
            Attendee(
                user_id=other.id,
                display_name=other.profile.display_name,
                age=age_on(other.profile.birth_date, today),
                photo=photo,
                verified=other.verification_status == VerificationStatus.verified,
                role=attendance.role,
                event_label=labels.get(attendance.race_event_id),
                connection=connection,
                match_id=match.id if match else None,
                request_id=request.id if request else None,
            )
        )
    return attendees


# --- Race group chat ---


@router.get("/races/{race_id}/messages", response_model=list[RaceMessageOut])
def list_race_messages(
    race_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    before: uuid.UUID | None = None,
) -> list[RaceMessageOut]:
    """Oldest-first page of the race chat; `before` loads older messages."""
    race = get_race(db, race_id, user)
    require_attending(db, race, user)
    stmt = select(RaceMessage).where(
        RaceMessage.race_id == race.id, RaceMessage.removed_at.is_(None), _not_blocked_sender(user.id)
    )
    if before is not None:
        cursor = db.get(RaceMessage, before)
        if cursor is None or cursor.race_id != race.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found.")
        stmt = stmt.where(RaceMessage.created_at < cursor.created_at)
    newest_first = db.scalars(stmt.order_by(RaceMessage.created_at.desc()).limit(RACE_CHAT_PAGE)).all()
    return [_message_out(db, m) for m in reversed(newest_first)]


@router.post("/races/{race_id}/messages", response_model=RaceMessageOut, status_code=status.HTTP_201_CREATED)
def post_race_message(
    race_id: uuid.UUID, body: MessageBody, user: CurrentUser, db: DbSession, settings: AppSettings
) -> RaceMessageOut:
    race = get_race(db, race_id, user)
    require_attending(db, race, user)
    _check_message_limits(db, user, settings)
    mentioned = mention_ids(body.body)
    if len(mentioned) > MAX_MENTIONS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"You can mention up to {MAX_MENTIONS} people in one message."
        )
    if mentioned:
        # Only other people at this race whom you could see in its chat
        allowed = set(
            db.scalars(
                select(User.id)
                .join(RaceAttendance, RaceAttendance.user_id == User.id)
                .where(RaceAttendance.race_id == race.id, User.id.in_(mentioned), User.id != user.id)
                .where(not_blocked_with(user.id))
            ).all()
        )
        if allowed != set(mentioned):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, detail="You can only mention people going to this race."
            )
    msg = RaceMessage(
        race_id=race.id, sender_id=user.id, body=body.body, mentioned_user_ids=mentioned, created_at=utcnow()
    )
    db.add(msg)
    db.commit()
    out = _message_out(db, msg)

    # Everyone at the race, except people either side has blocked
    recipients = db.scalars(
        select(User.id)
        .join(RaceAttendance, RaceAttendance.user_id == User.id)
        .where(RaceAttendance.race_id == race.id, not_blocked_with(user.id))
    ).all()
    hub.publish_from_thread(
        recipients, {"type": "race_message", "message": out.model_dump(mode="json", by_alias=True)}
    )
    if mentioned:
        hub.publish_from_thread(
            mentioned,
            {"type": "race_mention", "raceId": str(race.id), "raceName": race.name, "messageId": str(msg.id)},
        )
    return out


@router.get("/races/{race_id}/mentionable", response_model=list[Mentionable])
def mentionable(
    race_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    q: Annotated[str, Query(max_length=40)] = "",
) -> list[Mentionable]:
    """People going to this race you can @mention, for the chat's suggestions: names starting
    with `q`, people who've posted most recently first."""
    race = get_race(db, race_id, user)
    require_attending(db, race, user)
    last_posted = (
        select(RaceMessage.sender_id, func.max(RaceMessage.created_at).label("at"))
        .where(RaceMessage.race_id == race.id)
        .group_by(RaceMessage.sender_id)
        .subquery()
    )
    # Aliased: visible_to() has its own subquery on profiles
    profile = aliased(Profile)
    stmt = (
        select(User.id, RaceAttendance.role, RaceAttendance.race_event_id)
        .join(RaceAttendance, and_(RaceAttendance.user_id == User.id, RaceAttendance.race_id == race.id))
        .join(profile, profile.user_id == User.id)
        .outerjoin(last_posted, last_posted.c.sender_id == User.id)
        .where(*visible_to(user, settings))
        .order_by(last_posted.c.at.desc().nulls_last(), profile.display_name)
        .limit(8)
    )
    if q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        stmt = stmt.where(profile.display_name.ilike(f"{escaped}%"))
    labels = {e.id: e.label for e in race.events}
    return [
        Mentionable(
            **sender(db, user_id).model_dump(),
            going=f"Running {labels.get(event_id, '')}".strip() if role == "running" else "Supporting",
        )
        for user_id, role, event_id in db.execute(stmt).all()
    ]


@router.post("/races/{race_id}/mentions/seen", status_code=status.HTTP_204_NO_CONTENT)
def mentions_seen(race_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Opened the race chat: its mentions are no longer unread."""
    race = get_race(db, race_id, user)
    attendance = require_attending(db, race, user)
    attendance.mentions_seen_at = utcnow()
    db.commit()


@router.get("/me/race-mentions", response_model=MentionCount)
def my_race_mentions(user: CurrentUser, db: DbSession) -> MentionCount:
    """Unread mentions across all your upcoming races, for the Races tab badge."""
    return MentionCount(count=_unread_mentions(db, user))


# --- Entry swap board ---


def _listing_out(db: Session, listing: EntryListing, me: User, labels: dict) -> ListingOut:
    return ListingOut(
        id=listing.id,
        race_id=listing.race_id,
        kind=listing.kind,
        race_event_id=listing.race_event_id,
        event_label=labels.get(listing.race_event_id),
        price_rands=listing.price_rands,
        note=listing.note,
        status=listing.status,
        created_at=listing.created_at,
        user=sender(db, listing.user_id),
        mine=listing.user_id == me.id,
    )


@router.get("/races/{race_id}/listings", response_model=list[ListingOut])
def list_listings(race_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings) -> list[ListingOut]:
    """Open swap board posts. Empty outside the race's official substitution window."""
    race = get_race(db, race_id, user)
    require_attending(db, race, user)
    if swap_window(race, sa_today()) != "open":
        return []
    listings = db.scalars(
        select(EntryListing)
        .join(User, User.id == EntryListing.user_id)
        .where(EntryListing.race_id == race.id, EntryListing.status == "open", *visible_to(user, settings))
        .order_by(EntryListing.created_at.desc())
    ).all()
    mine = db.scalars(
        select(EntryListing).where(
            EntryListing.race_id == race.id, EntryListing.status == "open", EntryListing.user_id == user.id
        )
    ).all()
    labels = {e.id: e.label for e in race.events}
    return [_listing_out(db, l, user, labels) for l in [*mine, *listings]]


@router.post("/races/{race_id}/listings", response_model=ListingOut, status_code=status.HTTP_201_CREATED)
def create_listing(race_id: uuid.UUID, body: ListingBody, user: CurrentUser, db: DbSession) -> ListingOut:
    race = get_race(db, race_id, user)
    require_attending(db, race, user)
    window = swap_window(race, sa_today())
    if window != "open":
        detail = {
            "none": "This race doesn't have an official entry transfer window, so entries can't be swapped here.",
            "upcoming": "The official entry transfer window hasn't opened yet.",
            "closed": "The official entry transfer window has closed, so entries can't be swapped any more.",
        }[window]
        raise HTTPException(status.HTTP_409_CONFLICT, detail=detail)
    if not any(e.id == body.race_event_id for e in race.events):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That distance isn't part of this race.")
    open_count = db.scalar(
        select(func.count())
        .select_from(EntryListing)
        .where(EntryListing.race_id == race.id, EntryListing.user_id == user.id, EntryListing.status == "open")
    )
    if open_count >= MAX_OPEN_LISTINGS_PER_RACE:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="You already have two open posts for this race. Close one first."
        )
    listing = EntryListing(
        race_id=race.id,
        race_event_id=body.race_event_id,
        user_id=user.id,
        kind=body.kind,
        price_rands=body.price_rands,
        note=body.note,
        created_at=utcnow(),
    )
    db.add(listing)
    db.commit()
    return _listing_out(db, listing, user, {e.id: e.label for e in race.events})


@router.post("/listings/{listing_id}/close", status_code=status.HTTP_204_NO_CONTENT)
def close_listing(listing_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    listing = db.get(EntryListing, listing_id)
    if listing is None or (listing.user_id != user.id and not user.is_admin):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Post not found.")
    if listing.status == "open":
        listing.status = "closed"
        listing.closed_at = utcnow()
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

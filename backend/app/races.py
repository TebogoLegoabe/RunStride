"""Rules shared by the race endpoints: dates, swap windows, and who you can see at a race."""

import re
import uuid
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Block, Profile, ProfilePhoto, Race, RaceAttendance, RaceEvent, User, VerificationStatus
from app.moderation import is_usable, not_blocked_with
from app.schemas import Sender

# Race dates are South African dates, whatever timezone the server runs in
SA_TZ = ZoneInfo("Africa/Johannesburg")


def sa_today() -> date:
    return datetime.now(SA_TZ).date()


def swap_window(race: Race, today: date) -> str:
    """open / upcoming / closed, or none if the organiser has no transfer window."""
    opens, closes = race.substitution_opens_on, race.substitution_closes_on
    if opens is None or closes is None:
        return "none"
    if today < opens:
        return "upcoming"
    if today > closes:
        return "closed"
    return "open"


def get_race(db: Session, race_id: uuid.UUID, me: User) -> Race:
    """A race this user may see: published ones, plus their own pending suggestions (admins see all)."""
    race = db.get(Race, race_id)
    visible = race is not None and (
        race.status == "published" or me.is_admin or (race.status == "pending" and race.suggested_by_id == me.id)
    )
    if not visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Race not found.")
    return race


def my_attendance(db: Session, race_id: uuid.UUID, user_id: uuid.UUID) -> RaceAttendance | None:
    return db.get(RaceAttendance, (race_id, user_id))


# A mention inside a race chat message: <@3f2b...>
MENTION = re.compile(r"<@([0-9a-fA-F-]{36})>")
MAX_MENTIONS = 10


def mention_ids(body: str) -> list[uuid.UUID]:
    """The people a message mentions, each once, in the order they appear."""
    found: list[uuid.UUID] = []
    for match in MENTION.finditer(body):
        try:
            user_id = uuid.UUID(match.group(1))
        except ValueError:
            continue  # looks like a mention but isn't one: leave it as text
        if user_id not in found:
            found.append(user_id)
    return found


def require_attending(db: Session, race: Race, me: User) -> RaceAttendance:
    attendance = my_attendance(db, race.id, me.id)
    if attendance is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Join this race to see this.")
    return attendance


def event_label(db: Session, event_id: uuid.UUID | None) -> str | None:
    if event_id is None:
        return None
    event = db.get(RaceEvent, event_id)
    return event.label if event else None


def visible_to(me: User, settings: Settings) -> list:
    """SQL conditions on User for other people `me` may see in race spaces."""
    conditions = [
        User.id != me.id,
        not_blocked_with(me.id),
        is_usable(),
        exists().where(Profile.user_id == User.id),
    ]
    if settings.require_id_verification:
        conditions.append(User.verification_status == VerificationStatus.verified)
    return conditions


def blocked_either_way(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    return bool(
        db.scalar(
            select(func.count())
            .select_from(Block)
            .where(
                or_(
                    and_(Block.blocker_id == a, Block.blocked_id == b),
                    and_(Block.blocker_id == b, Block.blocked_id == a),
                )
            )
        )
    )


def sender(db: Session, user_id: uuid.UUID) -> Sender:
    user = db.get(User, user_id)
    profile = user.profile if user else None
    photo = db.scalar(
        select(ProfilePhoto.url).where(ProfilePhoto.user_id == user_id).order_by(ProfilePhoto.position).limit(1)
    )
    return Sender(
        id=user_id,
        display_name=profile.display_name if profile else "RunStride runner",
        photo=photo,
    )

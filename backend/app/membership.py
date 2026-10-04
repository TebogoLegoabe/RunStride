"""RunStride Plus and race passes: who has what, and the free-tier limits.

Free: the app works, with limits that never expire.
Plus: no limits, everywhere.
Race pass: Plus's race features, for one race, until it's over.
Safety features are never limited.

Every limit is checked here on the server; the app only shows them.
"""

import uuid
from datetime import datetime, time, timedelta

from fastapi import HTTPException, status
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.models import Entitlement, Race, Swipe, User
from app.races import SA_TZ, sa_today
from app.security import utcnow

# Free-tier limits
FREE_DAILY_LIKES = 25
FREE_RUNNERS_VISIBLE = 3  # per race; the rest show as a count
FREE_CHAT_REQUESTS_PER_RACE = 1

# What each product grants. Product IDs must match the ones set up in App Store Connect,
# Google Play and RevenueCat.
PLUS_PRODUCTS = {"plus_weekly": timedelta(days=7), "plus_monthly": timedelta(days=30)}
RACE_PASS_PRODUCT = "race_pass"
PRODUCTS = {*PLUS_PRODUCTS, RACE_PASS_PRODUCT}


class UpgradeRequired(HTTPException):
    """402: allowed with Plus (or a race pass). The app opens the Plus screen with this message."""

    def __init__(self, detail: str):
        super().__init__(status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


def _active():
    """SQL condition on Entitlement: not expired."""
    return or_(Entitlement.expires_at.is_(None), Entitlement.expires_at > func.now())


def plus_condition(user_id_column):
    """SQL condition: the user in user_id_column has Plus right now."""
    return exists().where(Entitlement.user_id == user_id_column, Entitlement.kind == "plus", _active())


def has_plus(db: Session, user: User) -> bool:
    return bool(db.scalar(select(plus_condition(user.id))))


def plus_status(db: Session, user: User) -> tuple[bool, datetime | None, str | None]:
    """(active, until, source). until is empty when it doesn't expire."""
    rows = db.execute(
        select(Entitlement.expires_at, Entitlement.source).where(
            Entitlement.user_id == user.id, Entitlement.kind == "plus", _active()
        )
    ).all()
    if not rows:
        return False, None, None
    if any(expires is None for expires, _ in rows):
        return True, None, next(source for expires, source in rows if expires is None)
    expires, source = max(rows, key=lambda r: r[0])
    return True, expires, source


def has_race_pass(db: Session, user: User, race_id: uuid.UUID) -> bool:
    return bool(
        db.scalar(
            select(
                exists().where(
                    Entitlement.user_id == user.id,
                    Entitlement.kind == "race_pass",
                    Entitlement.race_id == race_id,
                    _active(),
                )
            )
        )
    )


def has_race_access(db: Session, user: User, race_id: uuid.UUID) -> bool:
    """Plus, or a race pass for this race: everyone going, unlimited requests, swap alerts."""
    return has_plus(db, user) or has_race_pass(db, user, race_id)


def race_access_condition(user_id_column, race_id_column):
    """SQL condition version of has_race_access, e.g. for finding who gets a swap alert."""
    return or_(
        plus_condition(user_id_column),
        exists().where(
            Entitlement.user_id == user_id_column,
            Entitlement.kind == "race_pass",
            Entitlement.race_id == race_id_column,
            _active(),
        ),
    )


def race_pass_expiry(race: Race) -> datetime:
    """A race pass lasts until the end of the day after the race (South African time)."""
    return datetime.combine(race.ends_on + timedelta(days=2), time.min, tzinfo=SA_TZ)


def unspent_race_passes(db: Session, user: User) -> list[Entitlement]:
    return list(
        db.scalars(
            select(Entitlement)
            .where(Entitlement.user_id == user.id, Entitlement.kind == "race_pass", Entitlement.race_id.is_(None))
            .order_by(Entitlement.created_at)
        ).all()
    )


def spend_race_pass(db: Session, user: User, race: Race) -> Entitlement:
    """Use a race pass credit on this race. Caller commits."""
    if has_race_pass(db, user, race.id):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You already have a race pass for this race.")
    credits = unspent_race_passes(db, user)
    if not credits:
        raise UpgradeRequired("Buy a race pass to use it on this race.")
    credit = credits[0]
    credit.race_id = race.id
    credit.redeemed_at = utcnow()
    credit.expires_at = race_pass_expiry(race)
    return credit


def grant_plus(
    db: Session, user: User, *, source: str, duration: timedelta | None, product_id: str | None = None
) -> Entitlement:
    """Plus from now (or from the end of current Plus) for `duration`; None: until removed.
    Caller commits."""
    _, until, _ = plus_status(db, user)
    start = max(until, utcnow()) if until else utcnow()
    entitlement = Entitlement(
        user_id=user.id,
        kind="plus",
        source=source,
        product_id=product_id,
        expires_at=start + duration if duration else None,
    )
    db.add(entitlement)
    return entitlement


def end_plus(db: Session, user: User, source: str) -> None:
    """End Plus from one source now (e.g. an admin taking back a beta tester's Plus). Caller commits."""
    now = utcnow()
    for entitlement in db.scalars(
        select(Entitlement).where(
            Entitlement.user_id == user.id, Entitlement.kind == "plus", Entitlement.source == source, _active()
        )
    ).all():
        entitlement.expires_at = now


def sa_day_start() -> datetime:
    return datetime.combine(sa_today(), time.min, tzinfo=SA_TZ)


def likes_used_today(db: Session, user: User) -> int:
    return db.scalar(
        select(func.count())
        .select_from(Swipe)
        .where(Swipe.swiper_id == user.id, Swipe.liked.is_(True), Swipe.created_at >= sa_day_start())
    )


def check_like_allowed(db: Session, user: User) -> None:
    if not has_plus(db, user) and likes_used_today(db, user) >= FREE_DAILY_LIKES:
        raise UpgradeRequired(
            f"You've used today's {FREE_DAILY_LIKES} likes. Get Plus for unlimited likes, or come back tomorrow."
        )


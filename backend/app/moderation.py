"""Blocking, reporting evidence and account lockouts, shared by the safety and admin routes."""

import uuid
from datetime import datetime

from sqlalchemy import and_, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import AccountStatus, Block, Match, Message, Report, User
from app.realtime import hub
from app.security import utcnow

# How many messages of the conversation a report keeps as evidence
EVIDENCE_MESSAGE_LIMIT = 200


def lockout_message(user: User, now: datetime | None = None) -> str | None:
    """Why this account can't use the app right now, or None if it can."""
    now = now or utcnow()
    if user.account_status == AccountStatus.banned:
        return "This account has been banned for breaking RunStride's community guidelines."
    if user.account_status == AccountStatus.suspended and (
        user.suspended_until is None or user.suspended_until > now
    ):
        until = f" until {user.suspended_until:%d %B %Y}" if user.suspended_until else ""
        return f"This account is suspended{until} for breaking RunStride's community guidelines."
    return None


def is_usable():
    """SQL condition: the user's account is active (or their suspension has run out)."""
    return or_(
        User.account_status == AccountStatus.active,
        and_(User.account_status == AccountStatus.suspended, User.suspended_until <= func.now()),
    )


def not_blocked_with(me_id: uuid.UUID):
    """SQL condition: neither User nor me has blocked the other."""
    return ~exists().where(
        or_(
            and_(Block.blocker_id == me_id, Block.blocked_id == User.id),
            and_(Block.blocker_id == User.id, Block.blocked_id == me_id),
        )
    )


def open_reporter_count():
    """SQL expression: how many different people have open reports against User."""
    return (
        select(func.count(func.distinct(Report.reporter_id)))
        .where(Report.reported_id == User.id, Report.status == "open")
        .scalar_subquery()
    )


def match_between(db: Session, a: uuid.UUID, b: uuid.UUID) -> Match | None:
    low, high = sorted([a, b])
    return db.scalar(select(Match).where(Match.user_a_id == low, Match.user_b_id == high))


def end_match(match: Match, ended_by: uuid.UUID) -> None:
    """Close a match and tell both apps. Caller commits."""
    match.ended_at = utcnow()
    match.ended_by_id = ended_by
    hub.publish_from_thread([match.user_a_id, match.user_b_id], {"type": "match_ended", "matchId": str(match.id)})


def block(db: Session, blocker: User, blocked_id: uuid.UUID) -> None:
    """Block, and end any match between the two. Caller commits."""
    db.execute(pg_insert(Block).values(blocker_id=blocker.id, blocked_id=blocked_id).on_conflict_do_nothing())
    match = match_between(db, blocker.id, blocked_id)
    if match is not None and match.ended_at is None:
        end_match(match, blocker.id)


def end_all_matches(db: Session, user: User, ended_by: uuid.UUID) -> None:
    """Used when banning. Caller commits."""
    active = db.scalars(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id), Match.ended_at.is_(None)
        )
    ).all()
    for match in active:
        end_match(match, ended_by)


def capture_evidence(db: Session, reported: User, match: Match | None) -> dict:
    """A copy of what the reporter could see, so the report stands even if the reported
    person later edits or deletes their profile, photos or account."""
    profile = reported.profile
    messages = []
    if match is not None:
        rows = db.scalars(
            select(Message)
            .where(Message.match_id == match.id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(EVIDENCE_MESSAGE_LIMIT)
        ).all()
        messages = [
            {
                "fromReported": m.sender_id == reported.id,
                "body": m.body,
                "createdAt": m.created_at.isoformat(),
            }
            for m in reversed(rows)
        ]
    return {
        "capturedAt": utcnow().isoformat(),
        "profile": {
            "displayName": profile.display_name if profile else None,
            "bio": profile.bio if profile else None,
            "photos": [p.url for p in profile.photos] if profile else [],
        },
        "messages": messages,
    }


def resolve_other_open_reports(db: Session, reported_id: uuid.UUID, admin: User, resolution: str, note: str) -> None:
    db.execute(
        update(Report)
        .where(Report.reported_id == reported_id, Report.status == "open")
        .values(
            status="resolved",
            resolution=resolution,
            resolution_note=note,
            resolved_at=utcnow(),
            resolved_by_id=admin.id,
        )
    )

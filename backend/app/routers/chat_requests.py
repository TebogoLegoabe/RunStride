"""Asking to chat privately with someone you met through a race (not a mutual like).

Nothing reaches the other person's inbox as a conversation until they accept. Accepting
creates a match of kind "race", so the chat gets everything one-to-one chats have:
run plans, live sharing, reporting and unmatching.
"""

import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.deps import CurrentUser, DbSession
from app.models import ChatRequest, EntryListing, Match, Race, User
from app.moderation import lockout_message, match_between
from app.races import blocked_either_way, my_attendance, sender
from app.realtime import hub
from app.schemas import ChatRequestBody, ChatRequestOut
from app.security import utcnow

router = APIRouter(tags=["chat requests"])

MAX_REQUESTS_PER_DAY = 20
NEW_ACCOUNT_REQUESTS_PER_DAY = 5
# After a decline, the same person can't ask again for a while
DECLINE_COOLDOWN = timedelta(days=30)


def _out(db: Session, request: ChatRequest, me: User) -> ChatRequestOut:
    incoming = request.to_user_id == me.id
    race = db.get(Race, request.race_id) if request.race_id else None
    listing = db.get(EntryListing, request.listing_id) if request.listing_id else None
    return ChatRequestOut(
        id=request.id,
        status=request.status,
        created_at=request.created_at,
        note=request.note,
        race_id=request.race_id,
        race_name=race.name if race else None,
        listing_kind=listing.kind if listing else None,
        other=sender(db, request.from_user_id if incoming else request.to_user_id),
        incoming=incoming,
        match_id=request.match_id,
    )


def _accept(db: Session, request: ChatRequest) -> Match:
    """Create (or reuse) the match between the two people. Caller commits."""
    a, b = sorted([request.from_user_id, request.to_user_id])
    db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"{a}:{b}"))))
    db.execute(
        pg_insert(Match)
        .values(id=uuid.uuid4(), user_a_id=a, user_b_id=b, kind="race", origin_race_id=request.race_id)
        .on_conflict_do_nothing()
    )
    match = match_between(db, a, b)
    if match.ended_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You can't chat with this runner.")
    request.status = "accepted"
    request.responded_at = utcnow()
    request.match_id = match.id
    return match


def _notify_accepted(request: ChatRequest, match: Match) -> None:
    event = {"type": "chat_request_accepted", "requestId": str(request.id), "matchId": str(match.id)}
    hub.publish_from_thread([request.from_user_id, request.to_user_id], event)


@router.post("/chat-requests", response_model=ChatRequestOut, status_code=status.HTTP_201_CREATED)
def send_request(body: ChatRequestBody, user: CurrentUser, db: DbSession) -> ChatRequestOut:
    other = db.get(User, body.to_user_id)
    if other is None or other.id == user.id or lockout_message(other) or blocked_either_way(db, user.id, other.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This runner isn't available.")

    # Requests come from a race (or a swap board post at one), and both people must be going
    race_id = body.race_id
    if body.listing_id is not None:
        listing = db.get(EntryListing, body.listing_id)
        if listing is None or listing.user_id != other.id or listing.status != "open":
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This post isn't available any more.")
        race_id = listing.race_id
    if race_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Chat requests are sent from a race.")
    if my_attendance(db, race_id, user.id) is None or my_attendance(db, race_id, other.id) is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You both need to be going to this race.")

    match = match_between(db, user.id, other.id)
    if match is not None:
        detail = "You're already chatting." if match.ended_at is None else "You can't chat with this runner."
        raise HTTPException(status.HTTP_409_CONFLICT, detail=detail)

    pending = db.scalars(
        select(ChatRequest).where(
            ChatRequest.status == "pending",
            or_(
                (ChatRequest.from_user_id == user.id) & (ChatRequest.to_user_id == other.id),
                (ChatRequest.from_user_id == other.id) & (ChatRequest.to_user_id == user.id),
            ),
        )
    ).all()
    for existing in pending:
        if existing.from_user_id == user.id:
            return _out(db, existing, user)  # already asked
        # They already asked you: asking back is the same as accepting
        match = _accept(db, existing)
        db.commit()
        _notify_accepted(existing, match)
        return _out(db, existing, user)

    declined_recently = db.scalar(
        select(func.count())
        .select_from(ChatRequest)
        .where(
            ChatRequest.from_user_id == user.id,
            ChatRequest.to_user_id == other.id,
            ChatRequest.status == "declined",
            ChatRequest.responded_at > utcnow() - DECLINE_COOLDOWN,
        )
    )
    if declined_recently:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This runner isn't available to chat.")

    now = utcnow()
    sent_today = db.scalar(
        select(func.count())
        .select_from(ChatRequest)
        .where(ChatRequest.from_user_id == user.id, ChatRequest.created_at > now - timedelta(days=1))
    )
    is_new = user.created_at > now - timedelta(days=1)
    if sent_today >= (NEW_ACCOUNT_REQUESTS_PER_DAY if is_new else MAX_REQUESTS_PER_DAY):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="You've sent a lot of chat requests today. Try again tomorrow."
        )

    request = ChatRequest(
        from_user_id=user.id,
        to_user_id=other.id,
        race_id=race_id,
        listing_id=body.listing_id,
        note=body.note,
        created_at=now,
    )
    db.add(request)
    db.commit()
    hub.publish_from_thread([other.id], {"type": "chat_request", "requestId": str(request.id)})
    return _out(db, request, user)


@router.get("/chat-requests", response_model=list[ChatRequestOut])
def list_requests(user: CurrentUser, db: DbSession) -> list[ChatRequestOut]:
    """Your pending requests, both ways (declined ones simply disappear)."""
    requests = db.scalars(
        select(ChatRequest)
        .where(
            ChatRequest.status == "pending",
            or_(ChatRequest.to_user_id == user.id, ChatRequest.from_user_id == user.id),
        )
        .order_by(ChatRequest.created_at.desc())
        .limit(100)
    ).all()
    visible = []
    for r in requests:
        other_id = r.from_user_id if r.to_user_id == user.id else r.to_user_id
        other = db.get(User, other_id)
        if other and not lockout_message(other) and not blocked_either_way(db, user.id, other_id):
            visible.append(_out(db, r, user))
    return visible


def _my_incoming(db: Session, request_id: uuid.UUID, user: User) -> ChatRequest:
    request = db.get(ChatRequest, request_id)
    if request is None or request.to_user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Request not found.")
    if request.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You've already answered this request.")
    return request


@router.post("/chat-requests/{request_id}/accept", response_model=ChatRequestOut)
def accept_request(request_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ChatRequestOut:
    request = _my_incoming(db, request_id, user)
    if blocked_either_way(db, request.from_user_id, user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Request not found.")
    match = _accept(db, request)
    db.commit()
    _notify_accepted(request, match)
    return _out(db, request, user)


@router.post("/chat-requests/{request_id}/decline", response_model=ChatRequestOut)
def decline_request(request_id: uuid.UUID, user: CurrentUser, db: DbSession) -> ChatRequestOut:
    """No message is sent to the sender; the request simply disappears from both lists."""
    request = _my_incoming(db, request_id, user)
    request.status = "declined"
    request.responded_at = utcnow()
    db.commit()
    return _out(db, request, user)

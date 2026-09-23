import asyncio
import uuid
from datetime import timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response, WebSocket, WebSocketDisconnect, status
from sqlalchemy import func, or_, select, tuple_, update
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.db import SessionLocal
from app.deps import AppSettings, CurrentUser, DbSession
from app.dev_seed import dev_auto_reply
from app.models import Match, Message, User
from app.moderation import lockout_message
from app.realtime import hub, publish_message
from app.schemas import LastMessage, MatchSummary, MessageBody, MessageOut
from app.security import decode_access_token, utcnow

router = APIRouter(tags=["matches"])

WS_AUTH_TIMEOUT_SECONDS = 10


def match_summary(db: Session, match: Match, me: User, *, with_chat: bool = False) -> MatchSummary:
    other = db.get(User, match.other_user_id(me.id))
    photos = other.profile.photos if other.profile else []
    summary = MatchSummary(
        id=match.id,
        user_id=other.id,
        display_name=other.profile.display_name if other.profile else "RunStride runner",
        photo=photos[0].url if photos else None,
        matched_at=match.created_at,
    )
    if with_chat:
        last = db.scalar(
            select(Message)
            .where(Message.match_id == match.id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        )
        if last is not None:
            summary.last_message = LastMessage(body=last.body, sender_id=last.sender_id, created_at=last.created_at)
        summary.unread_count = db.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.match_id == match.id, Message.sender_id != me.id, Message.read_at.is_(None))
        )
    return summary


def active_match(db: Session, me: User, match_id: uuid.UUID) -> Match:
    match = db.get(Match, match_id)
    if match is None or me.id not in (match.user_a_id, match.user_b_id) or match.ended_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This match isn't available.")
    return match


def check_rate_limits(db: Session, me: User, settings: Settings) -> None:
    now = utcnow()

    def sent_since(since) -> int:
        return db.scalar(
            select(func.count()).select_from(Message).where(Message.sender_id == me.id, Message.created_at > since)
        )

    if sent_since(now - timedelta(minutes=1)) >= settings.messages_per_minute:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, detail="You're sending messages too quickly. Please slow down."
        )
    if me.created_at > now - timedelta(hours=settings.new_account_hours):
        if sent_since(now - timedelta(hours=1)) >= settings.new_account_messages_per_hour:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"New accounts can send up to {settings.new_account_messages_per_hour} messages an hour. "
                    "This limit lifts after your first day."
                ),
            )


@router.get("/matches", response_model=list[MatchSummary])
def list_matches(user: CurrentUser, db: DbSession) -> list[MatchSummary]:
    # One query per match for the last message and unread count: fine at this scale,
    # worth folding into a single query once people have hundreds of matches.
    matches = db.scalars(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id),
            Match.ended_at.is_(None),
        )
    ).all()
    summaries = [match_summary(db, m, user, with_chat=True) for m in matches]
    # Most recent activity first: the latest message, or when you matched
    summaries.sort(
        key=lambda s: s.last_message.created_at if s.last_message else s.matched_at,
        reverse=True,
    )
    return summaries


@router.delete("/matches/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
def unmatch(match_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    match = active_match(db, user, match_id)
    match.ended_at = utcnow()
    match.ended_by_id = user.id
    db.commit()
    hub.publish_from_thread(
        [match.user_a_id, match.user_b_id], {"type": "match_ended", "matchId": str(match.id)}
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/matches/{match_id}/messages", response_model=list[MessageOut])
def list_messages(
    match_id: uuid.UUID,
    user: CurrentUser,
    db: DbSession,
    before: uuid.UUID | None = None,
    after: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[Message]:
    """Messages oldest-first. No cursor: the latest page. `before`: an older page
    (scrolling up). `after`: anything newer (catching up after a reconnect)."""
    match = active_match(db, user, match_id)
    stmt = select(Message).where(Message.match_id == match.id)
    key = tuple_(Message.created_at, Message.id)

    cursor_id = before or after
    if cursor_id is not None:
        cursor = db.get(Message, cursor_id)
        if cursor is None or cursor.match_id != match.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found.")
        cursor_key = tuple_(cursor.created_at, cursor.id)

    if after is not None:
        return list(
            db.scalars(stmt.where(key > cursor_key).order_by(Message.created_at, Message.id).limit(limit))
        )
    if before is not None:
        stmt = stmt.where(key < cursor_key)
    newest_first = db.scalars(stmt.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit)).all()
    return list(reversed(newest_first))


@router.post("/matches/{match_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(
    match_id: uuid.UUID,
    body: MessageBody,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    background: BackgroundTasks,
) -> MessageOut:
    match = active_match(db, user, match_id)
    check_rate_limits(db, user, settings)
    message = Message(match_id=match.id, sender_id=user.id, body=body.body, created_at=utcnow())
    db.add(message)
    db.commit()
    out = publish_message(message, [match.user_a_id, match.user_b_id])
    if settings.is_development:
        background.add_task(dev_auto_reply, match.id, user.id)
    return out


@router.post("/matches/{match_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(match_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    match = active_match(db, user, match_id)
    now = utcnow()
    result = db.execute(
        update(Message)
        .where(Message.match_id == match.id, Message.sender_id != user.id, Message.read_at.is_(None))
        .values(read_at=now)
    )
    db.commit()
    if result.rowcount:
        hub.publish_from_thread(
            [match.other_user_id(user.id)],
            {"type": "read", "matchId": str(match.id), "readAt": now.isoformat()},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _can_connect(user_id: uuid.UUID) -> bool:
    with SessionLocal() as db:
        user = db.get(User, user_id)
        return user is not None and lockout_message(user) is None


@router.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    """Live events for the signed-in user. The first message must be
    {"type": "auth", "token": "..."}; tokens stay out of URLs, which end up in logs."""
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), timeout=WS_AUTH_TIMEOUT_SECONDS)
        if first.get("type") != "auth":
            raise ValueError("expected auth")
        user_id = decode_access_token(first["token"])
        if not await run_in_threadpool(_can_connect, user_id):
            raise ValueError("unknown user")
    except (asyncio.TimeoutError, ValueError, KeyError, TypeError, AttributeError, jwt.PyJWTError, WebSocketDisconnect):
        await ws.close(code=4401)
        return

    hub.add(user_id, ws)
    try:
        await ws.send_json({"type": "ready"})
        while True:
            data = await ws.receive_json()
            if data.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except Exception:  # disconnects and malformed frames both end the connection
        pass
    finally:
        hub.remove(user_id, ws)

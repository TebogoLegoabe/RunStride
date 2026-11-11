"""Chat extras: photos, voice notes and reactions in a match's conversation.

Text messages (and replies to them) go through POST /matches/{id}/messages in routers/matches.py.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import push
from app.deps import AppSettings, CurrentUser, DbSession
from app.images import InvalidImage, process_chat_photo
from app.models import Message, MessageReaction
from app.realtime import hub, publish_message
from app.routers.matches import active_match, check_rate_limits, reply_target
from app.schemas import MessageOut, ReactionBody, ReactionOut
from app.security import utcnow
from app.storage import PhotoStorage, get_photo_storage

router = APIRouter(tags=["matches"])

Storage = Annotated[PhotoStorage, Depends(get_photo_storage)]

MAX_CAPTION = 1000
MAX_VOICE_BYTES = 5 * 1024 * 1024
MAX_VOICE_MS = 5 * 60 * 1000  # five minutes
PHOTO_BODY = "📷 Photo"
VOICE_BODY = "🎤 Voice message"


def _audio_type(data: bytes) -> tuple[str, str] | None:
    """(file extension, content type) from the file's first bytes, or None if it isn't audio we
    accept. Phones record AAC in an MP4 container; browsers record MP4 or WebM."""
    if data[4:8] == b"ftyp":
        return "m4a", "audio/mp4"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm", "audio/webm"
    if data[:4] == b"OggS":
        return "ogg", "audio/ogg"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav", "audio/wav"
    if data[:3] == b"ID3" or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "mp3", "audio/mpeg"
    return None


def _read(file: UploadFile, limit: int, too_big: str) -> bytes:
    raw = file.file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail=too_big)
    if not raw:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That file is empty.")
    return raw


def _save_and_publish(db, storage: PhotoStorage, message: Message, data: bytes, match, **save_args) -> MessageOut:
    message.media_url = storage.save(data, folder="chat", **save_args)
    db.add(message)
    try:
        db.commit()
    except Exception:
        storage.delete(message.media_url)
        raise
    return publish_message(message, [match.user_a_id, match.user_b_id])


@router.post("/matches/{match_id}/messages/photo", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_photo(
    match_id: uuid.UUID,
    file: UploadFile,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    storage: Storage,
    caption: Annotated[str, Form(max_length=MAX_CAPTION)] = "",
    reply_to_id: Annotated[uuid.UUID | None, Form()] = None,
) -> MessageOut:
    """A photo, with an optional caption. Location and other metadata are stripped."""
    match = active_match(db, user, match_id)
    check_rate_limits(db, user, settings)
    reply = reply_target(db, match, reply_to_id)
    raw = _read(file, settings.max_photo_bytes, f"Photos must be under {settings.max_photo_bytes // (1024 * 1024)} MB.")
    try:
        jpeg, width, height = process_chat_photo(raw)
    except InvalidImage:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That file isn't a supported photo. Please use a JPEG, PNG or WebP image."
        )
    message = Message(
        match_id=match.id,
        sender_id=user.id,
        kind="image",
        body=caption.strip() or PHOTO_BODY,
        created_at=utcnow(),
        reply_to_id=reply.id if reply else None,
        media_width=width,
        media_height=height,
    )
    return _save_and_publish(db, storage, message, jpeg, match)


@router.post("/matches/{match_id}/messages/voice", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_voice(
    match_id: uuid.UUID,
    file: UploadFile,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    storage: Storage,
    duration_ms: Annotated[int, Form(ge=0)] = 0,
    reply_to_id: Annotated[uuid.UUID | None, Form()] = None,
) -> MessageOut:
    """A voice note, up to five minutes."""
    match = active_match(db, user, match_id)
    check_rate_limits(db, user, settings)
    reply = reply_target(db, match, reply_to_id)
    raw = _read(file, MAX_VOICE_BYTES, "That voice message is too long. Keep it under five minutes.")
    kind = _audio_type(raw)
    if kind is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That recording couldn't be sent. Please try again.")
    ext, content_type = kind
    message = Message(
        match_id=match.id,
        sender_id=user.id,
        kind="voice",
        body=VOICE_BODY,
        created_at=utcnow(),
        reply_to_id=reply.id if reply else None,
        media_duration_ms=min(duration_ms, MAX_VOICE_MS),
    )
    return _save_and_publish(db, storage, message, raw, match, ext=ext, content_type=content_type)


@router.put("/matches/{match_id}/messages/{message_id}/reaction", response_model=list[ReactionOut])
def react(match_id: uuid.UUID, message_id: uuid.UUID, body: ReactionBody, user: CurrentUser, db: DbSession) -> list[ReactionOut]:
    """Set your reaction to a message (one each; a new one replaces the old), or remove it with null.
    Returns everyone's reactions to that message."""
    match = active_match(db, user, match_id)
    message = db.get(Message, message_id)
    if message is None or message.match_id != match.id or message.kind == "system":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found.")
    before = db.scalar(
        select(MessageReaction.emoji).where(MessageReaction.message_id == message.id, MessageReaction.user_id == user.id)
    )
    if body.emoji is None:
        db.execute(delete(MessageReaction).where(MessageReaction.message_id == message.id, MessageReaction.user_id == user.id))
    else:
        db.execute(
            pg_insert(MessageReaction)
            .values(message_id=message.id, user_id=user.id, emoji=body.emoji, created_at=utcnow())
            .on_conflict_do_update(
                index_elements=[MessageReaction.message_id, MessageReaction.user_id],
                set_={"emoji": body.emoji, "created_at": utcnow()},
            )
        )
    db.commit()
    db.refresh(message)
    reactions = [ReactionOut.model_validate(r) for r in message.reactions]
    hub.publish_from_thread(
        [match.user_a_id, match.user_b_id],
        {
            "type": "reaction",
            "matchId": str(match.id),
            "messageId": str(message.id),
            "reactions": [r.model_dump(mode="json", by_alias=True) for r in reactions],
        },
    )
    # Tell the author when someone else reacts (not when it's removed or unchanged)
    if body.emoji is not None and body.emoji != before and message.sender_id != user.id:
        push.notify(
            [message.sender_id],
            "messages",
            "{name}",
            f"Reacted {body.emoji} to your message",
            f"/chat/{match.id}?userId={user.id}&name={{name}}",
            about=user.id,
        )
    return reactions

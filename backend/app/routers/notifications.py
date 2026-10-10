"""Phones that get push notifications, and which notifications each person wants."""

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import delete

from app.deps import CurrentUser, DbSession
from app.models import PushToken
from app.push import prefs_of
from app.schemas import NotificationSettings, PushTokenBody
from app.security import utcnow

router = APIRouter(tags=["notifications"])


@router.put("/me/push-tokens", status_code=status.HTTP_204_NO_CONTENT)
def register_push_token(body: PushTokenBody, user: CurrentUser, db: DbSession) -> Response:
    """The app calls this on start. A phone that changed accounts moves to the new one."""
    token = db.get(PushToken, body.token)
    if token is None:
        db.add(PushToken(token=body.token, user_id=user.id, platform=body.platform))
    else:
        token.user_id = user.id
        token.platform = body.platform
        token.last_seen_at = utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me/push-tokens", status_code=status.HTTP_204_NO_CONTENT)
def remove_push_token(user: CurrentUser, db: DbSession, token: str = Query(max_length=200)) -> Response:
    """Signing out: this phone stops getting this account's notifications."""
    db.execute(delete(PushToken).where(PushToken.token == token, PushToken.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/notification-settings", response_model=NotificationSettings)
def get_notification_settings(user: CurrentUser) -> NotificationSettings:
    return NotificationSettings(**prefs_of(user))


@router.put("/me/notification-settings", response_model=NotificationSettings)
def set_notification_settings(body: NotificationSettings, user: CurrentUser, db: DbSession) -> NotificationSettings:
    user.notification_prefs = body.model_dump()
    db.commit()
    return NotificationSettings(**prefs_of(user))

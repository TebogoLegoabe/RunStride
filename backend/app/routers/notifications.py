"""Phones that get push notifications, and which notifications each person wants."""

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import delete

from app.deps import AppSettings, CurrentUser, DbSession
from app.models import PushToken, WebPushSubscription
from app.push import prefs_of
from app.schemas import NotificationSettings, PushTokenBody, WebPushBody, WebPushKey
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


# --- Browser notifications (the web app) ---


@router.get("/push/web-key", response_model=WebPushKey)
def web_push_key(settings: AppSettings) -> WebPushKey:
    """The server's public key, which the browser needs to subscribe. 404: browser push isn't set up."""
    if not (settings.vapid_public_key and settings.vapid_private_key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Browser notifications aren't set up.")
    return WebPushKey(public_key=settings.vapid_public_key)


@router.put("/me/web-push", status_code=status.HTTP_204_NO_CONTENT)
def save_web_push(body: WebPushBody, user: CurrentUser, db: DbSession) -> Response:
    """The web app calls this after the browser allows notifications. A browser that switched
    accounts moves to the new one."""
    sub = db.get(WebPushSubscription, body.endpoint)
    if sub is None:
        db.add(WebPushSubscription(endpoint=body.endpoint, user_id=user.id, p256dh=body.keys.p256dh, auth=body.keys.auth))
    else:
        sub.user_id, sub.p256dh, sub.auth = user.id, body.keys.p256dh, body.keys.auth
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/me/web-push", status_code=status.HTTP_204_NO_CONTENT)
def remove_web_push(user: CurrentUser, db: DbSession, endpoint: str = Query(max_length=1000)) -> Response:
    db.execute(
        delete(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint, WebPushSubscription.user_id == user.id)
    )
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

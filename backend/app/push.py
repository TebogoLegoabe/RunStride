"""Push notifications to phones, through Expo's push service.

Every notification goes through notify(), which runs in the background so a slow push service
never slows down sending a message. It checks each person's notification settings, sends to all
their phones, and forgets phones that have uninstalled the app.

Development (PUSH_PROVIDER=console) prints notifications to the logs instead of sending them.
"""

import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote

import httpx
from sqlalchemy import delete, select

from app.config import get_settings
from app.db import SessionLocal
from app.models import Profile, PushToken, User, WebPushSubscription

log = logging.getLogger("runstride.push")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_BATCH = 100  # most notifications Expo accepts in one request

# What people can switch off, one by one; "enabled" switches off everything
CATEGORIES = ("messages", "matches", "races", "swaps")
DEFAULT_PREFS = {"enabled": True, **{c: True for c in CATEGORIES}}


def prefs_of(user: User) -> dict:
    return {**DEFAULT_PREFS, **(user.notification_prefs or {})}


@dataclass(frozen=True)
class Push:
    token: str
    title: str
    body: str
    url: str  # where tapping it opens in the app, e.g. /chat/<id>


class PushSender(Protocol):
    def send(self, pushes: list[Push]) -> set[str]:
        """Send; returns tokens the push service says no longer exist."""


class ConsolePushSender:
    def send(self, pushes: list[Push]) -> set[str]:
        for p in pushes:
            log.info("PUSH to %s… | %s | %s | %s", p.token[:28], p.title, p.body, p.url)
        return set()


class ExpoPushSender:
    def __init__(self, access_token: str = ""):
        self.access_token = access_token

    def send(self, pushes: list[Push]) -> set[str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.access_token:
            headers["Authorization"] = f"Bearer {self.access_token}"
        gone: set[str] = set()
        for start in range(0, len(pushes), EXPO_BATCH):
            batch = pushes[start : start + EXPO_BATCH]
            payload = [
                {"to": p.token, "title": p.title, "body": p.body, "data": {"url": p.url}, "sound": "default"}
                for p in batch
            ]
            try:
                res = httpx.post(EXPO_PUSH_URL, json=payload, headers=headers, timeout=10)
                res.raise_for_status()
            except httpx.HTTPError:
                log.exception("Expo push request failed")
                continue
            gone |= unregistered_tokens(res.json(), batch)
        return gone


def unregistered_tokens(response: dict, batch: list[Push]) -> set[str]:
    """Tokens Expo reports as DeviceNotRegistered (the app was uninstalled or the token expired)."""
    gone = set()
    for push, ticket in zip(batch, response.get("data") or []):
        if ticket.get("status") == "error":
            if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                gone.add(push.token)
            else:
                log.warning("Push to %s… failed: %s", push.token[:28], ticket.get("message"))
    return gone


@dataclass(frozen=True)
class WebPush:
    endpoint: str
    p256dh: str
    auth: str
    title: str
    body: str
    url: str


class WebPushSender:
    """Browser notifications, signed with the server's VAPID key."""

    def __init__(self, private_key: str, subject: str):
        self.private_key = private_key
        self.subject = subject

    def send(self, pushes: list[WebPush]) -> set[str]:
        """Send; returns endpoints the browser's push service says are gone (unsubscribed)."""
        import json

        from pywebpush import WebPushException, webpush

        gone: set[str] = set()
        for p in pushes:
            try:
                webpush(
                    subscription_info={"endpoint": p.endpoint, "keys": {"p256dh": p.p256dh, "auth": p.auth}},
                    data=json.dumps({"title": p.title, "body": p.body, "url": p.url}),
                    vapid_private_key=self.private_key,
                    vapid_claims={"sub": self.subject},
                    ttl=60 * 60 * 24,
                    timeout=10,
                )
            except WebPushException as e:
                status = getattr(e.response, "status_code", None)
                if status in (404, 410):
                    gone.add(p.endpoint)
                else:
                    log.warning("Web push to %s… failed: %s", p.endpoint[:40], e)
            except Exception:
                log.exception("Web push to %s… failed", p.endpoint[:40])
        return gone


class ConsoleWebPushSender:
    def send(self, pushes: list[WebPush]) -> set[str]:
        for p in pushes:
            log.info("WEB PUSH to %s… | %s | %s | %s", p.endpoint[:40], p.title, p.body, p.url)
        return set()


def get_web_push_sender():
    """None when browser notifications aren't set up (no VAPID keys)."""
    settings = get_settings()
    if not (settings.vapid_public_key and settings.vapid_private_key):
        return None
    if settings.push_provider != "expo":
        return ConsoleWebPushSender()
    return WebPushSender(settings.vapid_private_key, settings.vapid_subject)


def web_sender():
    return get_web_push_sender()


def get_push_sender() -> PushSender:
    settings = get_settings()
    if settings.push_provider == "expo":
        return ExpoPushSender(settings.expo_access_token)
    return ConsolePushSender()


# Tests replace these to send synchronously to a fake
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")


def _dispatch(job) -> None:
    _executor.submit(job)


def sender() -> PushSender:
    return get_push_sender()


def notify(
    user_ids,
    category: str,
    title: str,
    body: str,
    url: str,
    *,
    about: uuid.UUID | None = None,
) -> None:
    """Send a push to these people's phones, if they want this kind of notification.

    `about`: the person it's about; "{name}" in the title, body or url becomes their display name.
    Returns straight away; the work happens in the background."""
    recipients = [u for u in dict.fromkeys(user_ids) if u is not None]
    if not recipients:
        return
    _dispatch(lambda: _deliver(recipients, category, title, body, url, about))


def notify_admins(db, title: str, body: str, url: str, *, exclude=None) -> None:
    """Tell every admin about something waiting for review (a race suggestion, an ID check).
    Follows their notification settings: all push off means none."""
    admin_ids = db.scalars(select(User.id).where(User.is_admin.is_(True))).all()
    notify([a for a in admin_ids if a != exclude], "admin", title, body, url)


def _deliver(recipients, category, title, body, url, about) -> None:
    try:
        with SessionLocal() as db:
            name = "Someone"
            if about is not None:
                name = db.scalar(select(Profile.display_name).where(Profile.user_id == about)) or "A runner"
            wanted = [
                u.id
                for u in db.scalars(select(User).where(User.id.in_(recipients))).all()
                if prefs_of(u)["enabled"] and prefs_of(u).get(category, True)
            ]
            if not wanted:
                return
            fill = lambda text: text.replace("{name}", name)  # noqa: E731
            link = url.replace("{name}", quote(name))

            # Phones (the Android and iPhone apps)
            tokens = db.scalars(select(PushToken.token).where(PushToken.user_id.in_(wanted))).all()
            if tokens:
                pushes = [Push(token=t, title=fill(title), body=fill(body), url=link) for t in tokens]
                gone = sender().send(pushes)
                if gone:
                    db.execute(delete(PushToken).where(PushToken.token.in_(gone)))
                    db.commit()

            # Browsers (the web app)
            web = web_sender()
            subs = db.scalars(select(WebPushSubscription).where(WebPushSubscription.user_id.in_(wanted))).all()
            if web is not None and subs:
                gone_web = web.send([
                    WebPush(endpoint=s.endpoint, p256dh=s.p256dh, auth=s.auth, title=fill(title), body=fill(body), url=link)
                    for s in subs
                ])
                if gone_web:
                    db.execute(delete(WebPushSubscription).where(WebPushSubscription.endpoint.in_(gone_web)))
                    db.commit()
    except Exception:
        log.exception("Couldn't send %s notification", category)

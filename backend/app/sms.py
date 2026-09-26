import logging
from typing import Protocol

import httpx

from app.config import get_settings

logger = logging.getLogger("runstride.sms")


class SmsError(Exception):
    """The provider didn't accept the message."""


class SmsSender(Protocol):
    def send(self, to: str, message: str) -> None:
        """Send one SMS to an E.164 number. Raises SmsError if it can't be sent."""
        ...


class ConsoleSmsSender:
    """Development sender: prints the message to the API logs instead of texting it."""

    def send(self, to: str, message: str) -> None:
        logger.info("SMS to %s: %s", to, message)


class BulkSmsSender:
    """BulkSMS.com JSON API (https://www.bulksms.com/developer/json/v1/).

    Authenticates with an API token (ID + secret) over HTTP Basic auth.
    """

    def __init__(
        self,
        token_id: str,
        token_secret: str,
        base_url: str = "https://api.bulksms.com/v1",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._auth = (token_id, token_secret)
        self._base_url = base_url.rstrip("/")
        self._transport = transport

    def send(self, to: str, message: str) -> None:
        try:
            with httpx.Client(timeout=10, transport=self._transport) as client:
                res = client.post(
                    f"{self._base_url}/messages",
                    # auto-unicode: switch encoding automatically if the text has emoji or accents
                    params={"auto-unicode": "true"},
                    json={"to": to, "body": message},
                    auth=self._auth,
                )
        except httpx.HTTPError as exc:
            raise SmsError(f"BulkSMS unreachable: {exc}") from exc
        if res.is_error:
            # 401 bad token, 403 out of credits, 400 bad number/request, 429 rate limited.
            # The message text isn't logged: it may contain a sign-in code.
            raise SmsError(f"BulkSMS rejected the message: HTTP {res.status_code} {res.text[:300]}")


def get_sms_sender() -> SmsSender:
    settings = get_settings()
    if settings.sms_provider == "bulksms":
        if not (settings.bulksms_token_id and settings.bulksms_token_secret):
            raise RuntimeError("SMS_PROVIDER=bulksms needs BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET")
        return BulkSmsSender(settings.bulksms_token_id, settings.bulksms_token_secret, settings.bulksms_base_url)
    if settings.is_development:
        return ConsoleSmsSender()
    raise RuntimeError("No SMS provider configured: set SMS_PROVIDER=bulksms and its credentials")


def get_optional_sms_sender() -> SmsSender | None:
    """For messages that must not block the action they belong to (e.g. panic alerts):
    None when no provider is configured, instead of an error."""
    try:
        return get_sms_sender()
    except RuntimeError:
        return None

import logging
from typing import Protocol

from app.config import get_settings

logger = logging.getLogger("runstride.sms")


class SmsSender(Protocol):
    def send(self, to: str, message: str) -> None: ...


class ConsoleSmsSender:
    """Development sender: prints the message to the API logs instead of texting it."""

    def send(self, to: str, message: str) -> None:
        logger.info("SMS to %s: %s", to, message)


def get_sms_sender() -> SmsSender:
    if not get_settings().is_development:
        # Swap in a real provider (Twilio, Clickatell, ...) before deploying.
        raise RuntimeError("No SMS provider configured for this environment")
    return ConsoleSmsSender()


def get_optional_sms_sender() -> SmsSender | None:
    """For messages that must not block the action they belong to (e.g. panic alerts):
    None when no provider is configured, instead of an error."""
    try:
        return get_sms_sender()
    except RuntimeError:
        return None

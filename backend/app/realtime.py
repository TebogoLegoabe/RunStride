"""Live events to connected apps over WebSockets.

The hub lives in this process's memory, so it only reaches clients connected to the
same API server. That's fine with one server; with several, publish through Redis
pub/sub instead and have each server forward to its own sockets.
"""

import logging
import uuid
from collections import defaultdict
from collections.abc import Iterable

import anyio.from_thread
from fastapi import WebSocket

from app.models import Message
from app.schemas import MessageOut

logger = logging.getLogger("runstride.realtime")


class Hub:
    def __init__(self) -> None:
        # One user can be connected from several devices or tabs
        self._sockets: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)

    def add(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        self._sockets[user_id].add(ws)

    def remove(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        sockets = self._sockets.get(user_id)
        if sockets is not None:
            sockets.discard(ws)
            if not sockets:
                del self._sockets[user_id]

    async def publish(self, user_ids: Iterable[uuid.UUID], event: dict) -> None:
        for user_id in user_ids:
            for ws in list(self._sockets.get(user_id, ())):
                try:
                    await ws.send_json(event)
                except Exception:  # dead connection: forget it, the app will reconnect
                    self.remove(user_id, ws)

    def publish_from_thread(self, user_ids: Iterable[uuid.UUID], event: dict) -> None:
        """For sync route handlers, which FastAPI runs in worker threads."""
        try:
            anyio.from_thread.run(self.publish, list(user_ids), event)
        except RuntimeError:
            # Not running inside the server (e.g. a script): nobody to notify live
            logger.debug("publish skipped outside the event loop: %s", event.get("type"))


hub = Hub()


def publish_message(message: Message, recipients: Iterable[uuid.UUID]) -> MessageOut:
    out = MessageOut.model_validate(message, from_attributes=True)
    hub.publish_from_thread(recipients, {"type": "message", "message": out.model_dump(mode="json", by_alias=True)})
    return out

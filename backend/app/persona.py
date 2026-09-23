"""Minimal client for Persona's identity verification API.

We never receive or store ID images or ID numbers: Persona collects them in its own
hosted flow and we only keep the inquiry ID and its status.
"""

import hashlib
import hmac
import time
from collections.abc import Iterator
from dataclasses import dataclass

import httpx

from app.config import get_settings

WEBHOOK_TOLERANCE_SECONDS = 300


class PersonaError(Exception):
    pass


class PersonaNotConfigured(PersonaError):
    pass


@dataclass(frozen=True)
class Inquiry:
    id: str
    status: str


class PersonaClient:
    def __init__(
        self,
        api_key: str,
        template_id: str,
        base_url: str,
        api_version: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.template_id = template_id
        self._http = httpx.Client(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Persona-Version": api_version,
                "Key-Inflection": "kebab",
                "Accept": "application/json",
            },
            timeout=15,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def _post(self, path: str, body: dict) -> dict:
        return self._send("POST", path, json=body)

    def _send(self, method: str, path: str, **kwargs) -> dict:
        try:
            res = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise PersonaError(f"{method} {path}: {exc}") from exc
        if res.is_error:
            raise PersonaError(f"{method} {path}: HTTP {res.status_code} {res.text[:300]}")
        return res.json()

    def create_inquiry(self) -> Inquiry:
        body = self._post("/inquiries", {"data": {"attributes": {"inquiry-template-id": self.template_id}}})
        return Inquiry(id=body["data"]["id"], status=body["data"]["attributes"]["status"])

    def get_inquiry(self, inquiry_id: str) -> Inquiry:
        body = self._send("GET", f"/inquiries/{inquiry_id}")
        return Inquiry(id=body["data"]["id"], status=body["data"]["attributes"]["status"])

    def one_time_link(self, inquiry_id: str) -> str:
        """A single-use URL to Persona's hosted flow for this inquiry (also resumes an unfinished one)."""
        body = self._post(f"/inquiries/{inquiry_id}/generate-one-time-link", {"meta": {}})
        return body["meta"]["one-time-link"]


def get_persona_client() -> Iterator[PersonaClient]:
    settings = get_settings()
    if not (settings.persona_api_key and settings.persona_inquiry_template_id):
        raise PersonaNotConfigured("PERSONA_API_KEY and PERSONA_INQUIRY_TEMPLATE_ID must be set")
    client = PersonaClient(
        api_key=settings.persona_api_key,
        template_id=settings.persona_inquiry_template_id,
        base_url=settings.persona_api_base_url,
        api_version=settings.persona_api_version,
    )
    try:
        yield client
    finally:
        client.close()


def verify_webhook_signature(header: str | None, body: bytes, secret: str, now: float | None = None) -> bool:
    """Check a Persona-Signature header: "t=<unix ts>,v1=<hex hmac>".

    During secret rotation Persona sends two space-separated t/v1 sets; either may match.
    Old timestamps are rejected so a captured request can't be replayed later.
    """
    if not header or not secret:
        return False
    now = time.time() if now is None else now
    for part in header.split(" "):
        fields = dict(kv.split("=", 1) for kv in part.split(",") if "=" in kv)
        timestamp, signature = fields.get("t"), fields.get("v1")
        if not timestamp or not signature or not timestamp.isdigit():
            continue
        if abs(now - int(timestamp)) > WEBHOOK_TOLERANCE_SECONDS:
            continue
        expected = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
        if hmac.compare_digest(expected, signature):
            return True
    return False

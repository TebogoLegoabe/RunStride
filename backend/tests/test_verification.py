import hashlib
import hmac
import json
import re
import time

import httpx
import pytest

from app.main import app
from app.persona import PersonaClient, get_persona_client, verify_webhook_signature
from tests.conftest import sign_in

TEMPLATE_ID = "itmpl_test123"
WEBHOOK_SECRET = "wbhsec_test_secret"
PROFILE = {"displayName": "Thandi", "birthDate": "1996-04-12", "bio": None}


class FakePersona:
    """Stands in for api.withpersona.com, so the real PersonaClient code runs in tests."""

    def __init__(self) -> None:
        self.statuses: dict[str, str] = {}
        self.requests: list[httpx.Request] = []
        self.down = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.down:
            return httpx.Response(503, text="unavailable")
        path = request.url.path.removeprefix("/api/v1")

        if request.method == "POST" and path == "/inquiries":
            attrs = json.loads(request.content)["data"]["attributes"]
            assert attrs["inquiry-template-id"] == TEMPLATE_ID
            inquiry_id = f"inq_{len(self.statuses) + 1}"
            self.statuses[inquiry_id] = "created"
            return httpx.Response(201, json=self._inquiry(inquiry_id))

        match = re.fullmatch(r"/inquiries/(inq_\w+)(/generate-one-time-link)?", path)
        if match and match.group(1) in self.statuses:
            inquiry_id = match.group(1)
            if match.group(2):
                body = self._inquiry(inquiry_id)
                body["meta"] = {"one-time-link": f"https://withpersona.com/verify?code=otl_{inquiry_id}"}
                return httpx.Response(200, json=body)
            return httpx.Response(200, json=self._inquiry(inquiry_id))
        return httpx.Response(404, json={"errors": [{"title": "Not found"}]})

    def _inquiry(self, inquiry_id: str) -> dict:
        return {"data": {"type": "inquiry", "id": inquiry_id, "attributes": {"status": self.statuses[inquiry_id]}}}

    def created_count(self) -> int:
        return sum(1 for r in self.requests if r.method == "POST" and r.url.path.endswith("/inquiries"))


@pytest.fixture
def persona(client, settings):
    fake = FakePersona()
    settings.persona_webhook_secret = WEBHOOK_SECRET

    def override():
        c = PersonaClient("persona_sandbox_key", TEMPLATE_ID, "https://api.withpersona.com/api/v1",
                          "2023-01-05", transport=httpx.MockTransport(fake.handler))
        yield c
        c.close()

    app.dependency_overrides[get_persona_client] = override
    return fake


@pytest.fixture
def headers(client, auth_headers):
    client.put("/me/profile", json=PROFILE, headers=auth_headers).raise_for_status()
    return auth_headers


def start(client, headers):
    return client.post("/verification/start", headers=headers)


def refresh(client, headers) -> dict:
    res = client.post("/verification/refresh", headers=headers)
    res.raise_for_status()
    return res.json()


def signed_webhook(client, event_name, inquiry_id, secret=WEBHOOK_SECRET, timestamp=None):
    body = json.dumps({
        "data": {
            "type": "event",
            "id": "evt_1",
            "attributes": {
                "name": event_name,
                "payload": {"data": {"type": "inquiry", "id": inquiry_id, "attributes": {"status": "ignored"}}},
            },
        }
    }).encode()
    t = str(int(timestamp if timestamp is not None else time.time()))
    sig = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return client.post(
        "/webhooks/persona",
        content=body,
        headers={"Persona-Signature": f"t={t},v1={sig}", "Content-Type": "application/json"},
    )


def test_initial_state(client, persona, headers):
    res = client.get("/verification", headers=headers)

    assert res.json() == {"status": "unverified", "attemptsRemaining": 3, "canStart": True}


def test_start_requires_profile(client, persona, auth_headers):
    assert start(client, auth_headers).status_code == 409


def test_start_creates_inquiry_and_returns_link(client, persona, headers):
    res = start(client, headers)

    assert res.status_code == 200
    assert res.json() == {"verificationUrl": "https://withpersona.com/verify?code=otl_inq_1"}
    create = persona.requests[0]
    assert create.headers["Authorization"] == "Bearer persona_sandbox_key"
    assert create.headers["Persona-Version"] == "2023-01-05"


def test_start_again_resumes_unfinished_inquiry(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "pending"

    res = start(client, headers)

    assert res.json()["verificationUrl"].endswith("otl_inq_1")
    assert persona.created_count() == 1


def test_approved_inquiry_verifies_user(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "approved"

    state = refresh(client, headers)

    assert state == {"status": "verified", "attemptsRemaining": 3, "canStart": False}
    assert client.get("/me", headers=headers).json()["verificationStatus"] == "verified"
    assert start(client, headers).status_code == 409


def test_completed_inquiry_is_pending_review(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "completed"

    assert refresh(client, headers)["status"] == "pending"
    res = start(client, headers)
    assert res.status_code == 409
    assert "being reviewed" in res.json()["detail"]


def test_declined_allows_retry_until_limit(client, persona, headers, settings):
    for n in range(1, settings.max_verification_attempts + 1):
        assert start(client, headers).status_code == 200
        persona.statuses[f"inq_{n}"] = "declined"
        state = refresh(client, headers)
        assert state["status"] == "rejected"
        assert state["attemptsRemaining"] == settings.max_verification_attempts - n

    assert state["canStart"] is False
    res = start(client, headers)
    assert res.status_code == 403
    assert "contact support" in res.json()["detail"]


def test_expired_inquiry_can_restart_without_using_an_attempt(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "expired"

    state = refresh(client, headers)
    assert state == {"status": "unverified", "attemptsRemaining": 3, "canStart": True}

    assert start(client, headers).json()["verificationUrl"].endswith("otl_inq_2")


def test_webhook_updates_status_from_persona_api(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "approved"

    res = signed_webhook(client, "inquiry.approved", "inq_1")

    assert res.status_code == 200
    assert client.get("/me", headers=headers).json()["verificationStatus"] == "verified"


def test_webhook_rejects_bad_signature(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "approved"

    res = signed_webhook(client, "inquiry.approved", "inq_1", secret="wrong-secret")

    assert res.status_code == 401
    assert client.get("/me", headers=headers).json()["verificationStatus"] == "unverified"


def test_webhook_rejects_replayed_old_request(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "approved"

    res = signed_webhook(client, "inquiry.approved", "inq_1", timestamp=time.time() - 3600)

    assert res.status_code == 401


def test_webhook_for_unknown_inquiry_is_ignored(client, persona):
    persona.statuses["inq_999"] = "approved"

    assert signed_webhook(client, "inquiry.approved", "inq_999").status_code == 200


def test_late_webhook_for_old_inquiry_does_not_override_current_attempt(client, persona, headers):
    start(client, headers)
    persona.statuses["inq_1"] = "declined"
    refresh(client, headers)
    start(client, headers)  # second attempt: inq_2, in progress

    signed_webhook(client, "inquiry.declined", "inq_1")

    assert client.get("/verification", headers=headers).json()["status"] == "unverified"


def test_persona_outage_returns_502(client, persona, headers):
    persona.down = True

    res = start(client, headers)

    assert res.status_code == 502
    assert "temporarily unavailable" in res.json()["detail"]


def test_not_configured_returns_503(client, headers):
    # No persona fixture: the real dependency runs with no API key set
    res = start(client, headers)

    assert res.status_code == 503


def test_signature_accepts_either_secret_during_rotation():
    body = b'{"x":1}'
    now = time.time()
    t = str(int(now))
    good = hmac.new(b"new-secret", f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    header = f"t={t},v1={'0' * 64} t={t},v1={good}"

    assert verify_webhook_signature(header, body, "new-secret", now=now)
    assert not verify_webhook_signature(header, body, "other-secret", now=now)
    assert not verify_webhook_signature(None, body, "new-secret", now=now)
    assert not verify_webhook_signature(header, body, "", now=now)


def test_verification_can_be_switched_off_in_development(client, settings, headers):
    assert client.get("/me", headers=headers).json()["verificationRequired"] is True

    settings.require_id_verification = False

    assert client.get("/me", headers=headers).json()["verificationRequired"] is False


def test_verification_cannot_be_switched_off_outside_development():
    from app.config import Settings

    with pytest.raises(ValueError, match="REQUIRE_ID_VERIFICATION"):
        Settings(environment="production", secret_key="x" * 40, require_id_verification=False)

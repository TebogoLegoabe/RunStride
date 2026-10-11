import base64
import json

import httpx
import pytest
from sqlalchemy import select

from app import sms as sms_module
from app.config import Settings
from app.main import app
from app.models import OtpCode
from app.sms import BulkSmsSender, ConsoleSmsSender, SmsError, get_sms_sender


def fake_bulksms(status_code=201, captured=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(request)
        if status_code >= 400:
            return httpx.Response(status_code, json={"type": "https://developer.bulksms.com/json/v1/errors#insufficient-credits", "status": status_code})
        return httpx.Response(201, json=[{"id": "4321", "type": "SENT", "status": {"type": "ACCEPTED"}}])

    return httpx.MockTransport(handler)


# --- The BulkSMS client ---


def test_bulksms_sends_the_right_request():
    captured = []
    sender = BulkSmsSender("token-id", "token-secret", transport=fake_bulksms(captured=captured))

    sender.send("+27821234567", "Your RunStride code is 123456 🏃")

    [req] = captured
    assert req.method == "POST"
    assert req.url.host == "api.bulksms.com"
    assert req.url.path == "/v1/messages"
    assert req.url.params["auto-unicode"] == "true"
    assert req.headers["Authorization"] == "Basic " + base64.b64encode(b"token-id:token-secret").decode()
    assert json.loads(req.content) == {"to": "+27821234567", "body": "Your RunStride code is 123456 🏃"}


@pytest.mark.parametrize("status_code", [400, 401, 403, 429, 503])
def test_bulksms_errors_raise_sms_error(status_code):
    sender = BulkSmsSender("id", "secret", transport=fake_bulksms(status_code))

    with pytest.raises(SmsError, match=str(status_code)):
        sender.send("+27821234567", "hi")


def test_bulksms_unreachable_raises_sms_error():
    def boom(request):
        raise httpx.ConnectError("no route")

    sender = BulkSmsSender("id", "secret", transport=httpx.MockTransport(boom))

    with pytest.raises(SmsError, match="unreachable"):
        sender.send("+27821234567", "hi")


# --- Choosing a provider ---


@pytest.mark.parametrize(
    "overrides, expected",
    [
        ({"sms_provider": "console"}, ConsoleSmsSender),
        ({"sms_provider": "bulksms", "bulksms_token_id": "a", "bulksms_token_secret": "b"}, BulkSmsSender),
        (
            {"sms_provider": "bulksms", "bulksms_token_id": "a", "bulksms_token_secret": "b", "environment": "production",
             "secret_key": "x" * 40, "photo_storage": "s3"},
            BulkSmsSender,
        ),
    ],
)
def test_provider_selection(monkeypatch, overrides, expected):
    monkeypatch.setattr(sms_module, "get_settings", lambda: Settings(**overrides))

    assert isinstance(get_sms_sender(), expected)


@pytest.mark.parametrize(
    "overrides",
    [
        # Missing credentials. Spelled out as empty so a developer's real keys in backend/.env
        # can't make this pass or fail.
        {"sms_provider": "bulksms", "bulksms_token_id": "", "bulksms_token_secret": ""},
    ],
)
def test_misconfigured_provider_refuses(monkeypatch, overrides):
    monkeypatch.setattr(sms_module, "get_settings", lambda: Settings(**overrides))

    with pytest.raises(RuntimeError):
        get_sms_sender()


def test_production_refuses_to_start_with_the_console_sender():
    """Texts printed to a log instead of sent: caught when the settings load, not on first sign-in."""
    with pytest.raises(ValueError, match="SMS_PROVIDER"):
        Settings(environment="production", secret_key="x" * 40, photo_storage="s3", sms_provider="console")


# --- Sign-in codes: fraud limits and delivery failures ---


def test_only_south_african_numbers(client, sms):
    res = client.post("/auth/otp/send", json={"phone": "+44 7400 123456"})

    assert res.status_code == 422
    assert "South Africa" in res.json()["detail"]
    assert sms.messages == []


def test_per_network_limit_across_numbers(client, sms, settings):
    settings.otp_max_sends_per_ip_per_hour = 2
    for n in range(2):
        client.post("/auth/otp/send", json={"phone": f"082 555 100{n}"}).raise_for_status()

    res = client.post("/auth/otp/send", json={"phone": "082 555 1009"})

    assert res.status_code == 429
    assert "this network" in res.json()["detail"]
    assert len(sms.messages) == 2


def test_daily_cap_pauses_sign_ups(client, sms, settings):
    settings.otp_max_sends_per_day = 1
    client.post("/auth/otp/send", json={"phone": "082 555 1000"}).raise_for_status()

    res = client.post("/auth/otp/send", json={"phone": "082 555 1001"})

    assert res.status_code == 503
    assert len(sms.messages) == 1


def test_undelivered_code_is_cancelled(client, db):
    class Failing:
        def send(self, to, message):
            raise SmsError("out of credits")

    app.dependency_overrides[get_sms_sender] = lambda: Failing()

    res = client.post("/auth/otp/send", json={"phone": "082 555 1000"})

    assert res.status_code == 503
    assert "couldn't send" in res.json()["detail"]
    otp = db.scalar(select(OtpCode))
    assert otp.consumed_at is not None  # can never be used


def test_code_message_warns_not_to_share(client, sms):
    client.post("/auth/otp/send", json={"phone": "082 555 1000"})

    assert "Never share it" in sms.messages[0][1]


def test_code_message_avoids_the_wording_bulksms_rejects(client, sms):
    """BulkSMS's route silently failed "Your RunStride code is 123456" (FAILED.NOT_SENT, 0 credits)
    and delivered "RunStride: use 123456 to sign in". Don't drift back to the rejected form."""
    client.post("/auth/otp/send", json={"phone": "082 555 1000"})

    body = sms.messages[0][1]
    assert "code is" not in body.lower()
    assert body.startswith("RunStride: use ") and " to sign in." in body
    assert body.isascii() and len(body) <= 160  # one text, one credit


# --- Protecting the SMS budget ---


def test_one_number_cannot_drain_the_credits(client, sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    settings.otp_max_sends_per_hour = 100  # so the daily cap is the thing being tested
    settings.otp_max_sends_per_number_per_day = 3
    for _ in range(3):
        client.post("/auth/otp/send", json={"phone": "082 555 1000"}).raise_for_status()

    res = client.post("/auth/otp/send", json={"phone": "082 555 1000"})

    assert res.status_code == 429
    assert "tomorrow" in res.json()["detail"]
    assert len(sms.messages) == 3
    # Someone else is unaffected
    client.post("/auth/otp/send", json={"phone": "082 555 2000"}).raise_for_status()


def test_defaults_leave_headroom_in_a_2000_credit_bundle():
    s = Settings()
    assert s.otp_max_sends_per_day <= 500  # a bad day can't spend the whole bundle
    assert s.otp_max_sends_per_hour <= 3 and s.otp_max_sends_per_number_per_day <= 6
    assert s.otp_resend_cooldown_seconds >= 60


def test_codes_fit_in_one_text():
    """Over 160 characters (or any emoji/accent) costs extra credits."""
    sample = "RunStride: use 123456 to sign in. It expires in 10 minutes. Never share it with anyone."
    assert len(sample) <= 160 and sample.isascii()


def test_credit_balance_is_read_from_the_profile():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/profile")
        return httpx.Response(200, json={"credits": {"balance": 1234.5}})

    sender = BulkSmsSender("id", "secret", transport=httpx.MockTransport(handler))
    assert sender.credits() == 1234.5


def test_credit_balance_failures_are_not_fatal():
    sender = BulkSmsSender("id", "secret", transport=httpx.MockTransport(lambda r: httpx.Response(401)))
    assert sender.credits() is None
    odd = BulkSmsSender("id", "secret", transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    assert odd.credits() is None

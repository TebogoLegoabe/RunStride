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
             "secret_key": "x" * 40},
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
        {"sms_provider": "bulksms"},  # missing credentials
        {"sms_provider": "console", "environment": "production", "secret_key": "x" * 40},  # console in production
    ],
)
def test_misconfigured_provider_refuses(monkeypatch, overrides):
    monkeypatch.setattr(sms_module, "get_settings", lambda: Settings(**overrides))

    with pytest.raises(RuntimeError):
        get_sms_sender()


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

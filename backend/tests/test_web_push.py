"""Browser notifications (Web Push)."""
import base64
import importlib.util
from pathlib import Path

import pytest

import app.push as push
from tests.test_notifications import match, phone, pushes  # noqa: F401 (fixtures)

SUB = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc123", "keys": {"p256dh": "BPk" + "x" * 80, "auth": "authsecret123"}}


class FakeWebSender:
    def __init__(self):
        self.sent = []
        self.gone = set()

    def send(self, items):
        self.sent.extend(items)
        return {i.endpoint for i in items} & self.gone


@pytest.fixture
def web(monkeypatch):
    fake = FakeWebSender()
    monkeypatch.setattr(push, "web_sender", lambda: fake)
    monkeypatch.setattr(push, "_dispatch", lambda job: job())
    return fake


def test_the_key_endpoint_says_when_browser_push_is_off_or_on(client, settings):
    assert client.get("/push/web-key").status_code == 404
    settings.vapid_public_key, settings.vapid_private_key = "PUBLIC", "PRIVATE"
    assert client.get("/push/web-key").json() == {"publicKey": "PUBLIC"}


def test_a_message_reaches_the_other_persons_browser(client, make_runner, web):
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    assert client.put("/me/web-push", json=SUB, headers=thandi["headers"]).status_code == 204
    match_id = match(client, thandi, sipho)

    client.post(f"/matches/{match_id}/messages", json={"body": "hi"}, headers=sipho["headers"]).raise_for_status()

    assert [w.endpoint for w in web.sent][-1] == SUB["endpoint"]
    assert web.sent[-1].url.startswith("/chat/")


def test_a_browser_that_unsubscribed_is_forgotten(client, make_runner, web, db):
    from sqlalchemy import text

    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    client.put("/me/web-push", json=SUB, headers=thandi["headers"]).raise_for_status()
    web.gone.add(SUB["endpoint"])
    match_id = match(client, thandi, sipho)
    client.post(f"/matches/{match_id}/messages", json={"body": "hi"}, headers=sipho["headers"]).raise_for_status()

    assert db.execute(text("select count(*) from web_push_subscriptions")).scalar() == 0


def test_signing_out_removes_the_browser(client, make_runner, db):
    from sqlalchemy import text

    thandi = make_runner()
    client.put("/me/web-push", json=SUB, headers=thandi["headers"]).raise_for_status()
    client.delete("/me/web-push", params={"endpoint": SUB["endpoint"]}, headers=thandi["headers"]).raise_for_status()
    assert db.execute(text("select count(*) from web_push_subscriptions")).scalar() == 0


def test_keys_from_the_key_script_can_sign_web_pushes(capsys):
    """The private key format scripts/make_vapid_keys.py prints is the one pywebpush signs with."""
    from py_vapid import Vapid

    script = Path(__file__).resolve().parents[2] / "scripts" / "make_vapid_keys.py"
    if not script.exists():
        pytest.skip("key script is outside the container")
    spec = importlib.util.spec_from_file_location("make_vapid_keys", script)
    spec.loader.exec_module(importlib.util.module_from_spec(spec))
    lines = dict(line.split("=", 1) for line in capsys.readouterr().out.strip().splitlines())
    vapid = Vapid.from_string(lines["VAPID_PRIVATE_KEY"])
    headers = vapid.sign({"sub": "mailto:test@example.com", "aud": "https://fcm.googleapis.com"})
    assert headers["Authorization"].startswith("vapid t=")
    assert len(base64.urlsafe_b64decode(lines["VAPID_PUBLIC_KEY"] + "==")) == 65

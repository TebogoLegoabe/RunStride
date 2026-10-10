"""Push notifications and Google sign-in."""

import pytest

import app.push as push
from app.google_auth import GoogleIdentity, InvalidGoogleToken, get_google_verifier
from app.main import app
from tests.test_races import admin, join, make_race, verification_off  # noqa: F401 (fixtures)


class FakePushSender:
    def __init__(self):
        self.sent: list[push.Push] = []
        self.gone: set[str] = set()

    def send(self, pushes):
        self.sent.extend(pushes)
        return {p.token for p in pushes} & self.gone


@pytest.fixture
def pushes(monkeypatch):
    fake = FakePushSender()
    monkeypatch.setattr(push, "sender", lambda: fake)
    monkeypatch.setattr(push, "_dispatch", lambda job: job())  # send straight away
    return fake


def phone(client, runner, token="ExponentPushToken[abcdefghij]"):
    res = client.put("/me/push-tokens", json={"token": token, "platform": "ios"}, headers=runner["headers"])
    assert res.status_code == 204
    return token


def match(client, a, b) -> str:
    client.post(f"/discover/{b['id']}/like", headers=a["headers"]).raise_for_status()
    return client.post(f"/discover/{a['id']}/like", headers=b["headers"]).json()["match"]["id"]


# --- Settings and phones ---


def test_settings_default_on_and_can_be_changed(client, make_runner):
    runner = make_runner()
    assert client.get("/me/notification-settings", headers=runner["headers"]).json() == {
        "enabled": True,
        "messages": True,
        "matches": True,
        "races": True,
        "swaps": True,
    }
    body = {"enabled": True, "messages": True, "matches": False, "races": True, "swaps": False}
    assert client.put("/me/notification-settings", json=body, headers=runner["headers"]).json() == body
    assert client.get("/me/notification-settings", headers=runner["headers"]).json() == body


def test_a_phone_moves_to_the_account_that_signed_in_last(client, make_runner, pushes):
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    token = phone(client, thandi)
    phone(client, sipho, token)  # same phone, signed in as Sipho now
    match_id = match(client, thandi, sipho)
    client.post(f"/matches/{match_id}/messages", json={"body": "hi"}, headers=sipho["headers"])
    assert pushes.sent == []  # the phone belongs to Sipho, the sender

    client.delete("/me/push-tokens", params={"token": token}, headers=sipho["headers"])
    client.post(f"/matches/{match_id}/messages", json={"body": "hi"}, headers=thandi["headers"])
    assert pushes.sent == []


# --- What sends a push ---


def test_message_and_match_pushes(client, make_runner, pushes):
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    phone(client, thandi)
    sipho_phone = phone(client, sipho, "ExponentPushToken[sipho12345]")

    # Thandi likes first; Sipho's like makes the match, so Thandi is told
    match_id = match(client, thandi, sipho)
    assert [(p.token, p.title) for p in pushes.sent] == [("ExponentPushToken[abcdefghij]", "It's a match!")]
    assert pushes.sent[0].url.startswith(f"/chat/{match_id}")

    pushes.sent.clear()
    client.post(f"/matches/{match_id}/messages", json={"body": "See you at parkrun?"}, headers=thandi["headers"])
    assert len(pushes.sent) == 1
    sent = pushes.sent[0]
    assert sent.token == sipho_phone  # the other person, never the sender
    assert sent.body == "Sent you a message"  # message text stays off the lock screen
    assert "parkrun" not in sent.title + sent.body


def test_settings_switch_pushes_off(client, make_runner, pushes):
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    phone(client, sipho)
    match_id = match(client, sipho, thandi)  # Thandi's like makes it; Sipho is told
    assert len(pushes.sent) == 1

    # Messages off: no message pushes, but matches still come through
    off = {"enabled": True, "messages": False, "matches": True, "races": True, "swaps": True}
    client.put("/me/notification-settings", json=off, headers=sipho["headers"])
    client.post(f"/matches/{match_id}/messages", json={"body": "hi"}, headers=thandi["headers"])
    assert len(pushes.sent) == 1

    # Everything off: only in the app
    client.put("/me/notification-settings", json={**off, "enabled": False, "messages": True}, headers=sipho["headers"])
    client.post(f"/matches/{match_id}/messages", json={"body": "hello?"}, headers=thandi["headers"])
    assert len(pushes.sent) == 1


def test_race_pushes(client, make_race, make_runner, pushes):
    race = make_race(window=(-1, 5))
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    for runner in (thandi, sipho):
        join(client, runner, race)
    phone(client, thandi)

    client.post(
        f"/races/{race['id']}/messages", json={"body": f"<@{thandi['id']}> pacing together?"}, headers=sipho["headers"]
    )
    assert pushes.sent[-1].title.endswith("mentioned you") and pushes.sent[-1].url == f"/race/{race['id']}"

    client.post("/chat-requests", json={"toUserId": thandi["id"], "raceId": race["id"]}, headers=sipho["headers"])
    assert pushes.sent[-1].title.endswith("wants to chat")
    assert "Blouberg Marathon" in pushes.sent[-1].body


def test_uninstalled_phones_are_forgotten(client, make_runner, pushes, db):
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    token = phone(client, thandi)
    pushes.gone.add(token)  # Expo says: DeviceNotRegistered
    match(client, thandi, sipho)
    from app.models import PushToken

    assert db.get(PushToken, token) is None


def test_expo_ticket_errors():
    batch = [push.Push("t1", "a", "b", "/"), push.Push("t2", "a", "b", "/"), push.Push("t3", "a", "b", "/")]
    response = {
        "data": [
            {"status": "ok", "id": "x"},
            {"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}},
            {"status": "error", "message": "too big", "details": {"error": "MessageTooBig"}},
        ]
    }
    assert push.unregistered_tokens(response, batch) == {"t2"}


# --- Google sign-in ---


class FakeGoogle:
    def __init__(self):
        self.identities = {}

    def verify(self, id_token, client_ids):
        if id_token not in self.identities:
            raise InvalidGoogleToken("bad signature")
        return self.identities[id_token]


@pytest.fixture
def google(settings):
    settings.google_client_ids = ["web-client.apps.googleusercontent.com"]
    fake = FakeGoogle()
    fake.identities["token-thandi-1234567890"] = GoogleIdentity("g-111", "thandi@example.com", True, "Thandi")
    fake.identities["token-unverified-1234567"] = GoogleIdentity("g-222", "x@example.com", False, "X")
    app.dependency_overrides[get_google_verifier] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_google_verifier, None)


def google_sign_in(client, token="token-thandi-1234567890"):
    return client.post("/auth/google", json={"idToken": token})


def test_google_sign_in_creates_then_reuses_the_account(client, google):
    first = google_sign_in(client)
    assert first.status_code == 200
    body = first.json()
    assert body["profileComplete"] is False and body["suggestedName"] == "Thandi"
    me = client.get("/me", headers={"Authorization": f"Bearer {body['token']}"}).json()
    assert me["phone"] is None and me["email"] == "thandi@example.com" and me["hasGoogle"] is True

    again = google_sign_in(client).json()
    assert again["userId"] == body["userId"]


def test_google_sign_in_rejects_bad_tokens(client, google, settings):
    assert google_sign_in(client, "token-forged-123456789012").status_code == 401
    assert google_sign_in(client, "token-unverified-1234567").status_code == 401
    settings.google_client_ids = []
    assert google_sign_in(client).status_code == 503  # not set up


def test_connect_google_to_a_phone_account(client, make_runner, google):
    runner = make_runner()
    res = client.post("/me/google", json={"idToken": "token-thandi-1234567890"}, headers=runner["headers"])
    assert res.json()["hasGoogle"] is True
    # Signing in with Google now opens the same account
    assert google_sign_in(client).json()["userId"] == runner["id"]

    other = make_runner()
    taken = client.post("/me/google", json={"idToken": "token-thandi-1234567890"}, headers=other["headers"])
    assert taken.status_code == 409

    assert client.delete("/me/google", headers=runner["headers"]).json()["hasGoogle"] is False


def test_google_only_accounts_cant_disconnect_google(client, google):
    token = google_sign_in(client).json()["token"]
    res = client.delete("/me/google", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 409

from datetime import timedelta

import pytest
from sqlalchemy import text

from app.security import utcnow


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


@pytest.fixture
def pair(client, make_runner):
    """Two matched runners and their match ID."""
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).raise_for_status()
    match = client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"]).json()["match"]
    return thandi, sipho, match["id"]


def send(client, runner, match_id, body="Hi!"):
    return client.post(f"/matches/{match_id}/messages", json={"body": body}, headers=runner["headers"])


def messages(client, runner, match_id, **params) -> list[dict]:
    res = client.get(f"/matches/{match_id}/messages", params=params, headers=runner["headers"])
    res.raise_for_status()
    return res.json()


def matches(client, runner) -> list[dict]:
    return client.get("/matches", headers=runner["headers"]).json()


def test_send_and_read_messages(client, pair):
    thandi, sipho, match_id = pair

    res = send(client, thandi, match_id, "  Parkrun on Saturday?  ")

    assert res.status_code == 201
    msg = res.json()
    assert msg["body"] == "Parkrun on Saturday?"
    assert msg["senderId"] == thandi["id"]
    assert msg["readAt"] is None
    assert [m["id"] for m in messages(client, sipho, match_id)] == [msg["id"]]


def test_only_participants_can_chat(client, pair, make_runner):
    _, _, match_id = pair
    outsider = make_runner(gender="man", interested_in=["woman"])

    assert send(client, outsider, match_id).status_code == 404
    assert client.get(f"/matches/{match_id}/messages", headers=outsider["headers"]).status_code == 404


def test_blank_and_long_messages_rejected(client, pair):
    thandi, _, match_id = pair

    blank = send(client, thandi, match_id, "   ")
    assert blank.status_code == 422
    assert blank.json()["detail"] == "Message can't be empty."
    assert send(client, thandi, match_id, "x" * 1001).status_code == 422


def test_matches_list_shows_last_message_and_unread(client, pair):
    thandi, sipho, match_id = pair
    send(client, thandi, match_id, "First")
    send(client, thandi, match_id, "Second")

    [summary] = matches(client, sipho)
    assert summary["lastMessage"]["body"] == "Second"
    assert summary["lastMessage"]["senderId"] == thandi["id"]
    assert summary["unreadCount"] == 2
    assert matches(client, thandi)[0]["unreadCount"] == 0  # your own messages aren't unread


def test_mark_read(client, pair):
    thandi, sipho, match_id = pair
    send(client, thandi, match_id)

    assert client.post(f"/matches/{match_id}/read", headers=sipho["headers"]).status_code == 204

    assert matches(client, sipho)[0]["unreadCount"] == 0
    assert messages(client, thandi, match_id)[0]["readAt"] is not None


def test_pagination_before_and_after(client, pair, settings):
    thandi, _, match_id = pair
    ids = [send(client, thandi, match_id, f"m{i}").json()["id"] for i in range(5)]

    latest = messages(client, thandi, match_id, limit=2)
    assert [m["id"] for m in latest] == ids[3:]  # oldest-first within the page

    older = messages(client, thandi, match_id, before=ids[3], limit=2)
    assert [m["id"] for m in older] == ids[1:3]

    newer = messages(client, thandi, match_id, after=ids[1])
    assert [m["id"] for m in newer] == ids[2:]


def test_unmatch_closes_chat_for_both(client, pair):
    thandi, sipho, match_id = pair
    send(client, thandi, match_id)

    assert client.delete(f"/matches/{match_id}", headers=sipho["headers"]).status_code == 204

    assert matches(client, thandi) == []
    assert matches(client, sipho) == []
    assert send(client, thandi, match_id).status_code == 404


def test_unmatch_keeps_messages_for_safety_reports(client, pair, db):
    thandi, sipho, match_id = pair
    send(client, thandi, match_id)
    client.delete(f"/matches/{match_id}", headers=sipho["headers"])

    assert db.execute(text("SELECT count(*) FROM messages WHERE match_id = :m"), {"m": match_id}).scalar() == 1


def test_per_minute_rate_limit(client, pair, settings):
    thandi, _, match_id = pair
    settings.messages_per_minute = 3
    for _ in range(3):
        send(client, thandi, match_id).raise_for_status()

    res = send(client, thandi, match_id)

    assert res.status_code == 429
    assert "too quickly" in res.json()["detail"]


def test_new_accounts_have_hourly_limit(client, pair, settings, db):
    thandi, sipho, match_id = pair
    settings.new_account_messages_per_hour = 2
    for _ in range(2):
        send(client, thandi, match_id).raise_for_status()

    res = send(client, thandi, match_id)
    assert res.status_code == 429
    assert "New accounts" in res.json()["detail"]

    # An older account isn't affected
    db.execute(
        text("UPDATE users SET created_at = :t WHERE id = :id"),
        {"t": utcnow() - timedelta(days=3), "id": thandi["id"]},
    )
    db.commit()
    assert send(client, thandi, match_id).status_code == 201


def test_websocket_delivers_messages_live(client, pair):
    thandi, sipho, match_id = pair
    token = sipho["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json() == {"type": "ready"}

        sent = send(client, thandi, match_id, "Live!").json()
        event = ws.receive_json()
        assert event["type"] == "message"
        assert event["message"]["id"] == sent["id"]
        assert event["message"]["body"] == "Live!"

        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_websocket_read_and_unmatch_events(client, pair):
    thandi, sipho, match_id = pair
    send(client, thandi, match_id)
    token = thandi["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        ws.receive_json()

        client.post(f"/matches/{match_id}/read", headers=sipho["headers"])
        assert ws.receive_json()["type"] == "read"

        client.delete(f"/matches/{match_id}", headers=sipho["headers"])
        assert ws.receive_json() == {"type": "match_ended", "matchId": match_id}


def test_websocket_rejects_bad_token(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": "nonsense"})
        message = ws.receive()
        assert message["type"] == "websocket.close"
        assert message["code"] == 4401

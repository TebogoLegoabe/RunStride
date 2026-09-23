from datetime import datetime, timedelta, timezone

import pytest

SAST = timezone(timedelta(hours=2))


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


@pytest.fixture
def pair(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).raise_for_status()
    match_id = client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"]).json()["match"]["id"]
    return thandi, sipho, match_id


def saturday_7am() -> str:
    return (datetime.now(SAST) + timedelta(days=3)).replace(hour=7, minute=0, second=0, microsecond=0).isoformat()


def suggest(client, runner, match_id, **overrides):
    body = {"startsAt": saturday_7am(), "place": "Emmarentia Dam, main gate", "distanceKm": 8, **overrides}
    return client.post(f"/matches/{match_id}/run-dates", json=body, headers=runner["headers"])


def answer(client, runner, run_id, action):
    return client.post(f"/run-dates/{run_id}/{action}", headers=runner["headers"])


def chat(client, runner, match_id) -> list[dict]:
    return client.get(f"/matches/{match_id}/messages", headers=runner["headers"]).json()


def test_suggestion_appears_in_chat_as_a_card(client, pair):
    thandi, sipho, match_id = pair

    res = suggest(client, thandi, match_id, note="Easy pace, coffee after?")

    assert res.status_code == 201
    card = res.json()
    assert card["kind"] == "run_date"
    assert card["body"] == "Suggested a run at Emmarentia Dam, main gate"
    run = card["runDate"]
    assert run["status"] == "proposed"
    assert run["distanceKm"] == 8
    assert run["note"] == "Easy pace, coffee after?"
    assert run["proposedById"] == thandi["id"]

    [seen_by_sipho] = chat(client, sipho, match_id)
    assert seen_by_sipho["runDate"]["id"] == run["id"]
    match = client.get("/matches", headers=sipho["headers"]).json()[0]
    assert match["unreadCount"] == 1
    assert match["lastMessage"]["body"].startswith("Suggested a run")


def test_accept_updates_the_card_and_adds_a_note(client, pair):
    thandi, sipho, match_id = pair
    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]

    res = answer(client, sipho, run_id, "accept")

    assert res.status_code == 200
    assert res.json()["status"] == "accepted"
    messages = chat(client, thandi, match_id)
    assert [m["kind"] for m in messages] == ["run_date", "system"]
    assert messages[0]["runDate"]["status"] == "accepted"  # the card shows the current state
    assert messages[1]["body"] == "Accepted the run 🎉"
    assert messages[1]["senderId"] == sipho["id"]


def test_decline(client, pair):
    thandi, sipho, match_id = pair
    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]

    assert answer(client, sipho, run_id, "decline").json()["status"] == "declined"
    # Declined: a new suggestion is allowed
    assert suggest(client, sipho, match_id).status_code == 201


def test_cannot_answer_your_own_suggestion(client, pair):
    thandi, _, match_id = pair
    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]

    res = answer(client, thandi, run_id, "accept")

    assert res.status_code == 409
    assert res.json()["detail"] == "You can't answer your own suggestion."


def test_only_one_suggestion_waiting_at_a_time(client, pair):
    thandi, sipho, match_id = pair
    suggest(client, thandi, match_id).raise_for_status()

    res = suggest(client, sipho, match_id)

    assert res.status_code == 409
    assert "waiting for a reply" in res.json()["detail"]


def test_cancel_rules(client, pair):
    thandi, sipho, match_id = pair
    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]

    # While waiting, only the person who suggested it can cancel; the other declines
    assert answer(client, sipho, run_id, "cancel").status_code == 409
    assert answer(client, thandi, run_id, "cancel").json()["status"] == "cancelled"
    assert answer(client, sipho, run_id, "accept").status_code == 409

    # Once accepted, either person can cancel
    second = suggest(client, thandi, match_id).json()["runDate"]["id"]
    answer(client, sipho, second, "accept").raise_for_status()
    assert answer(client, sipho, second, "cancel").json()["status"] == "cancelled"
    assert chat(client, thandi, match_id)[-1]["body"] == "Cancelled the run"


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"startsAt": (datetime.now(SAST) - timedelta(hours=1)).isoformat()}, "Pick a time in the future."),
        ({"startsAt": (datetime.now(SAST) + timedelta(days=90)).isoformat()}, "Runs can be planned up to 60 days ahead."),
        ({"startsAt": "2030-01-01T07:00:00"}, "Include a timezone with the start time."),
        ({"place": " "}, "Please say where to meet."),
    ],
)
def test_suggestion_validation(client, pair, overrides, message):
    thandi, _, match_id = pair

    res = suggest(client, thandi, match_id, **overrides)

    assert res.status_code == 422
    assert res.json()["detail"] == message


def test_outsiders_and_ended_matches(client, pair, make_runner):
    thandi, sipho, match_id = pair
    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]
    outsider = make_runner(gender="man", interested_in=["woman"])

    assert answer(client, outsider, run_id, "accept").status_code == 404
    assert suggest(client, outsider, match_id).status_code == 404

    client.delete(f"/matches/{match_id}", headers=thandi["headers"])
    assert answer(client, sipho, run_id, "accept").status_code == 404


def test_run_card_updates_arrive_live(client, pair):
    thandi, sipho, match_id = pair
    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]
    token = thandi["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        ws.receive_json()

        answer(client, sipho, run_id, "accept")

        note = ws.receive_json()
        assert note["type"] == "message"
        assert note["message"]["kind"] == "system"
        update = ws.receive_json()
        assert update["type"] == "run_date"
        assert update["runDate"]["status"] == "accepted"


def test_typed_messages_are_always_text(client, pair):
    thandi, _, match_id = pair

    res = client.post(
        f"/matches/{match_id}/messages", json={"body": "hi", "kind": "system"}, headers=thandi["headers"]
    )

    assert res.json()["kind"] == "text"


def test_seed_runners_auto_accept_in_development(client, pair, monkeypatch):
    from app import dev_seed

    thandi, sipho, match_id = pair
    monkeypatch.setattr(dev_seed, "SEED_PHONE_PREFIX", sipho["phone"])  # treat Sipho as a seed runner
    monkeypatch.setattr(dev_seed.time, "sleep", lambda _: None)

    run_id = suggest(client, thandi, match_id).json()["runDate"]["id"]

    messages = chat(client, thandi, match_id)
    assert messages[0]["runDate"]["id"] == run_id
    assert messages[0]["runDate"]["status"] == "accepted"
    assert messages[-1]["body"] == "Accepted the run 🎉"

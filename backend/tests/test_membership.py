"""RunStride Plus, race passes, Taken mode, swap alerts and store purchases."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

import app.membership as membership
from tests.test_races import admin, buy, join, make_race, verification_off  # noqa: F401 (fixtures)


def me(client, runner) -> dict:
    res = client.get("/me/membership", headers=runner["headers"])
    res.raise_for_status()
    return res.json()


def runners(client, runner, race, **params):
    return client.get(f"/races/{race['id']}/attendees", params=params, headers=runner["headers"])


def chat_request(client, runner, to, race=None, listing=None):
    body = {"toUserId": to["id"], **({"raceId": race["id"]} if race else {}), **({"listingId": listing} if listing else {})}
    return client.post("/chat-requests", json=body, headers=runner["headers"])


def post_listing(client, runner, race, kind, label="Half marathon"):
    event = next(e["id"] for e in race["events"] if e["label"] == label)
    res = client.post(
        f"/races/{race['id']}/listings", json={"kind": kind, "raceEventId": event}, headers=runner["headers"]
    )
    res.raise_for_status()
    return res.json()


# --- What you have ---


def test_new_accounts_are_free_and_looking(client, make_runner):
    runner = make_runner()
    m = me(client, runner)
    assert m["plus"] == {"active": False, "expiresAt": None, "source": None}
    assert m["datingMode"] == "looking"
    assert m["racePassCredits"] == 0 and m["racePasses"] == []
    assert m["limits"]["dailyLikes"] == membership.FREE_DAILY_LIKES
    assert m["testPurchases"] is True


def test_test_purchases_grant_plus_and_stack(client, make_runner):
    runner = make_runner()
    m = buy(client, runner, "plus_monthly")
    assert m["plus"]["active"] and m["plus"]["source"] == "dev"
    month_end = datetime.fromisoformat(m["plus"]["expiresAt"])
    # A second purchase extends from the end of the first, not from now
    m = buy(client, runner, "plus_weekly")
    assert datetime.fromisoformat(m["plus"]["expiresAt"]) - month_end == timedelta(days=7)


def test_test_purchases_only_in_development(client, make_runner, settings):
    runner = make_runner()
    settings.test_purchases = False
    res = client.post("/billing/test-purchase", json={"productId": "plus_monthly"}, headers=runner["headers"])
    assert res.status_code == 404


# --- Free limits ---


def test_daily_like_limit(client, make_runner, monkeypatch):
    monkeypatch.setattr(membership, "FREE_DAILY_LIKES", 1)
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    lwazi = make_runner(gender="man", interested_in=["woman"], km_north=1)

    assert client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).status_code == 200
    second = client.post(f"/discover/{lwazi['id']}/like", headers=thandi["headers"])
    assert second.status_code == 402
    assert "likes" in second.json()["detail"]
    # Passing is never limited
    assert client.post(f"/discover/{lwazi['id']}/pass", headers=thandi["headers"]).status_code == 200

    # Plus: no limit
    buy(client, thandi)
    bongani = make_runner(gender="man", interested_in=["woman"], km_north=2)
    assert client.post(f"/discover/{bongani['id']}/like", headers=thandi["headers"]).status_code == 200


def test_free_runners_list_shows_a_few(client, make_race, make_runner, monkeypatch):
    monkeypatch.setattr(membership, "FREE_RUNNERS_VISIBLE", 2)
    # routers.races imported the number; patch it there too
    import app.routers.races as races_router

    monkeypatch.setattr(races_router, "FREE_RUNNERS_VISIBLE", 2)
    race = make_race()
    thandi = make_runner()
    join(client, thandi, race)
    others = [make_runner(gender="man", interested_in=["woman"]) for _ in range(4)]
    for o in others:
        join(client, o, race, "Marathon")

    free = runners(client, thandi, race).json()
    assert len(free["runners"]) == 2 and free["hiddenCount"] == 2 and free["fullAccess"] is False
    # Filters are part of full access
    assert runners(client, thandi, race, similar_pace=True).status_code == 402

    buy(client, thandi, "race_pass", race)
    full = runners(client, thandi, race).json()
    assert len(full["runners"]) == 4 and full["hiddenCount"] == 0 and full["fullAccess"] is True
    marathon = next(e["id"] for e in race["events"] if e["label"] == "Marathon")
    assert len(runners(client, thandi, race, race_event_id=marathon).json()["runners"]) == 4
    assert runners(client, thandi, race, age_min=40).json()["runners"] == []


def test_one_free_chat_request_per_race(client, make_race, make_runner):
    race = make_race(window=(-1, 5))
    thandi = make_runner()
    sipho, lwazi, bongani = (make_runner(gender="man", interested_in=["woman"]) for _ in range(3))
    for runner in (thandi, sipho, lwazi, bongani):
        join(client, runner, race)

    assert chat_request(client, thandi, sipho, race).status_code == 201
    limited = chat_request(client, thandi, lwazi, race)
    assert limited.status_code == 402
    # Messaging about a swap post is always free
    listing = post_listing(client, bongani, race, "offering")
    assert chat_request(client, thandi, bongani, listing=listing["id"]).status_code == 201
    # A race pass lifts the limit for that race
    buy(client, thandi, "race_pass", race)
    assert chat_request(client, thandi, lwazi, race).status_code == 201


# --- Taken mode ---


def test_taken_mode(client, make_race, make_runner):
    race = make_race(window=(-1, 5))
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    for runner in (thandi, sipho):
        join(client, runner, race)
    listing = post_listing(client, sipho, race, "offering")

    res = client.put("/me/dating-mode", json={"mode": "taken"}, headers=sipho["headers"])
    assert res.json()["datingMode"] == "taken"

    # Out of Discover and the race's runner list, both ways
    assert all(c["userId"] != sipho["id"] for c in client.get("/discover", headers=thandi["headers"]).json())
    assert runners(client, thandi, race).json()["runners"] == []
    assert client.get("/discover", headers=sipho["headers"]).status_code == 409
    assert chat_request(client, thandi, sipho, race).status_code == 404
    # Races and swaps carry on
    assert chat_request(client, thandi, sipho, listing=listing["id"]).status_code == 201
    msg = client.post(f"/races/{race['id']}/messages", json={"body": "Still running it!"}, headers=sipho["headers"])
    assert msg.status_code == 201

    client.put("/me/dating-mode", json={"mode": "looking"}, headers=sipho["headers"])
    assert any(c["userId"] == sipho["id"] for c in client.get("/discover", headers=thandi["headers"]).json())


# --- Likes you ---


def test_likes_you(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    lwazi = make_runner(gender="man", interested_in=["woman"], km_north=1)
    client.post(f"/discover/{thandi['id']}/like", headers=lwazi["headers"]).raise_for_status()

    # Free: just the number
    assert client.get("/me/likes", headers=thandi["headers"]).json() == {"count": 1, "people": []}
    cards = client.get("/discover", headers=thandi["headers"]).json()
    assert not any(c["likesYou"] for c in cards)

    # Plus: who, and they come first in Discover
    buy(client, thandi)
    likes = client.get("/me/likes", headers=thandi["headers"]).json()
    assert [p["id"] for p in likes["people"]] == [lwazi["id"]]
    cards = client.get("/discover", headers=thandi["headers"]).json()
    assert cards[0]["userId"] == lwazi["id"] and cards[0]["likesYou"] is True
    assert {c["userId"] for c in cards} == {sipho["id"], lwazi["id"]}


# --- Swap alerts ---


def test_swap_alerts(client, make_race, make_runner):
    race = make_race(window=(-1, 5))
    thandi = make_runner()  # needs an entry, has Plus
    nomsa = make_runner()  # needs an entry, free
    sipho = make_runner(gender="man", interested_in=["woman"])
    for runner in (thandi, nomsa, sipho):
        join(client, runner, race)
    buy(client, thandi)
    post_listing(client, thandi, race, "looking")
    post_listing(client, nomsa, race, "looking")
    token = thandi["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        ws.receive_json()
        offer = post_listing(client, sipho, race, "offering")
        event = ws.receive_json()

    assert event["type"] == "swap_match"
    assert event["listingId"] == offer["id"] and event["eventLabel"] == "Half marathon"
    assert offer["interestedCount"] == 2  # two people looking for this distance

    summary = client.get(f"/races/{race['id']}", headers=thandi["headers"]).json()
    assert summary["unreadSwapMatches"] == 1
    assert client.get("/me/race-alerts", headers=thandi["headers"]).json() == {"mentions": 0, "swapMatches": 1}
    # Free: no alerts
    assert client.get(f"/races/{race['id']}", headers=nomsa["headers"]).json()["unreadSwapMatches"] == 0

    assert client.post(f"/races/{race['id']}/swaps/seen", headers=thandi["headers"]).status_code == 204
    assert client.get("/me/race-alerts", headers=thandi["headers"]).json()["swapMatches"] == 0


# --- Race passes ---


def test_race_pass_credits(client, make_race, make_runner):
    race = make_race()
    other_race = make_race(name="Two Oceans")
    runner = make_runner()
    join(client, runner, race)

    assert client.post(f"/races/{race['id']}/race-pass", headers=runner["headers"]).status_code == 402
    m = buy(client, runner, "race_pass")  # bought, not yet used
    assert m["racePassCredits"] == 1

    res = client.post(f"/races/{race['id']}/race-pass", headers=runner["headers"])
    m = res.json()
    assert m["racePassCredits"] == 0
    assert [p["raceName"] for p in m["racePasses"]] == ["Blouberg Marathon"]
    # It only covers that race, until just after it
    assert datetime.fromisoformat(m["racePasses"][0]["expiresAt"]).date() > datetime.fromisoformat(race["endsOn"]).date()
    assert client.get("/discover", params={"race_id": race["id"]}, headers=runner["headers"]).status_code == 200
    join(client, runner, other_race)
    assert client.get("/discover", params={"race_id": other_race["id"]}, headers=runner["headers"]).status_code == 402


# --- Admins giving Plus ---


def test_admins_give_and_take_plus(client, admin, make_runner):
    tester = make_runner()
    res = client.post("/admin/plus", json={"phone": tester["phone"], "days": 90}, headers=admin["headers"])
    assert res.json()["active"] and res.json()["source"] == "admin"
    assert client.post("/admin/plus", json={"phone": tester["phone"]}, headers=tester["headers"]).status_code == 403

    client.delete(f"/admin/plus/{tester['phone']}", headers=admin["headers"]).raise_for_status()
    assert me(client, tester)["plus"]["active"] is False


# --- App store purchases (RevenueCat) ---

AUTH = "Bearer test-webhook-secret"


@pytest.fixture
def store(settings):
    settings.revenuecat_webhook_auth = AUTH


def rc_event(user_id, type_, product, expires=None, **extra):
    return {
        "api_version": "1.0",
        "event": {
            "id": str(uuid.uuid4()),
            "type": type_,
            "app_user_id": user_id,
            "product_id": product,
            "original_transaction_id": "orig-1",
            "transaction_id": str(uuid.uuid4()),
            "expiration_at_ms": int(expires.timestamp() * 1000) if expires else None,
            **extra,
        },
    }


def send(client, payload, auth=AUTH):
    return client.post("/webhooks/revenuecat", json=payload, headers={"Authorization": auth})


def test_webhook_needs_setup_and_the_secret(client, settings, make_runner):
    runner = make_runner()
    payload = rc_event(runner["id"], "INITIAL_PURCHASE", "plus_monthly", datetime.now(timezone.utc) + timedelta(days=30))
    assert send(client, payload).status_code == 503  # not set up
    settings.revenuecat_webhook_auth = AUTH
    assert send(client, payload, auth="Bearer wrong").status_code == 401
    assert me(client, runner)["plus"]["active"] is False


def test_store_subscription_lifecycle(client, store, make_runner):
    runner = make_runner()
    soon = datetime.now(timezone.utc) + timedelta(days=30)
    purchase = rc_event(runner["id"], "INITIAL_PURCHASE", "plus_monthly", soon)
    assert send(client, purchase).status_code == 200
    m = me(client, runner)
    assert m["plus"]["active"] and m["plus"]["source"] == "store"

    # The same event delivered twice is handled once; a renewal moves the same subscription on
    assert send(client, purchase).status_code == 200
    later = soon + timedelta(days=30)
    send(client, rc_event(runner["id"], "RENEWAL", "plus_monthly", later))
    assert datetime.fromisoformat(me(client, runner)["plus"]["expiresAt"]) == later.replace(microsecond=later.microsecond // 1000 * 1000)

    # Cancelling keeps Plus until the paid period ends; expiry ends it
    send(client, rc_event(runner["id"], "CANCELLATION", "plus_monthly", later))
    assert me(client, runner)["plus"]["active"] is True
    send(client, rc_event(runner["id"], "EXPIRATION", "plus_monthly", datetime.now(timezone.utc) - timedelta(seconds=1)))
    assert me(client, runner)["plus"]["active"] is False


def test_store_race_pass_and_unknown_users(client, store, make_runner):
    runner = make_runner()
    assert send(client, rc_event(runner["id"], "NON_RENEWING_PURCHASE", "race_pass")).status_code == 200
    assert me(client, runner)["racePassCredits"] == 1
    # Purchases for someone we don't know are acknowledged (so the store stops retrying) and ignored
    assert send(client, rc_event("$RCAnonymousID:abc", "INITIAL_PURCHASE", "plus_monthly")).status_code == 200


# --- Entry alerts ---


def wants(client, runner, race, *labels):
    ids = [e["id"] for e in race["events"] if e["label"] in labels]
    return client.put(f"/races/{race['id']}/wants", json={"raceEventIds": ids}, headers=runner["headers"])


def test_entry_alerts_can_be_set_before_the_window_opens(client, make_race, make_runner):
    upcoming = make_race(starts_in=30, window=(5, 20))
    no_transfers = make_race(name="Two Oceans")
    runner = make_runner()
    join(client, runner, upcoming)
    join(client, runner, no_transfers)

    res = wants(client, runner, upcoming, "Half marathon", "Marathon")
    assert res.status_code == 200
    assert len(res.json()["raceEventIds"]) == 2 and res.json()["alerts"] is False
    # Changing them replaces the list
    assert len(wants(client, runner, upcoming, "Marathon").json()["raceEventIds"]) == 1
    # A race without an official transfer window has nothing to alert about
    assert wants(client, runner, no_transfers, "Marathon").status_code == 409
    other_race_event = no_transfers["events"][0]["id"]
    bad = client.put(f"/races/{upcoming['id']}/wants", json={"raceEventIds": [other_race_event]}, headers=runner["headers"])
    assert bad.status_code == 422


def test_entry_alert_fires_when_an_entry_is_offered(client, make_race, make_runner):
    race = make_race(window=(-1, 5))
    thandi = make_runner()  # wants a half marathon entry, has Plus
    nomsa = make_runner()  # wants one too, free
    sipho = make_runner(gender="man", interested_in=["woman"])  # selling
    for runner in (thandi, nomsa, sipho):
        join(client, runner, race)
    buy(client, thandi)
    assert wants(client, thandi, race, "Half marathon").json()["alerts"] is True
    wants(client, nomsa, race, "Half marathon")
    token = thandi["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        ws.receive_json()
        offer = post_listing(client, sipho, race, "offering")
        event = ws.receive_json()

    assert event["type"] == "swap_match" and event["listingId"] == offer["id"]
    # Both people wanting it count as interest, even though neither posted
    assert offer["interestedCount"] == 2
    assert client.get("/me/race-alerts", headers=thandi["headers"]).json()["swapMatches"] == 1
    assert client.get(f"/races/{race['id']}", headers=nomsa["headers"]).json()["unreadSwapMatches"] == 0

    client.post(f"/races/{race['id']}/swaps/seen", headers=thandi["headers"])
    assert client.get("/me/race-alerts", headers=thandi["headers"]).json()["swapMatches"] == 0
    # Other distances don't trigger it
    post_listing(client, sipho, race, "offering", "Marathon")
    assert client.get("/me/race-alerts", headers=thandi["headers"]).json()["swapMatches"] == 0


# --- Settings for hosting ---


def test_database_urls_from_hosts_use_the_psycopg3_driver():
    from app.config import Settings

    for given in ("postgresql://u:p@h:5432/db", "postgres://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"):
        assert Settings(database_url=given).database_url == "postgresql+psycopg://u:p@h:5432/db"


def test_production_refuses_unsafe_settings():
    from app.config import Settings

    good = dict(
        environment="production",
        secret_key="x" * 40,
        photo_storage="s3",
        sms_provider="bulksms",
        require_id_verification=True,
    )
    assert Settings(**good).test_purchases is False  # forced off, never on in production
    for bad in ({"photo_storage": "local"}, {"sms_provider": "console"}, {"secret_key": "dev-only-insecure-secret-change-me-before-deploying"}):
        with pytest.raises(ValueError):
            Settings(**{**good, **bad})

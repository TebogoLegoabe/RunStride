from datetime import date, timedelta

import pytest
from sqlalchemy import text

from app.races import sa_today


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


@pytest.fixture
def admin(make_runner, db):
    moderator = make_runner(gender="non_binary", interested_in=["non_binary"])
    db.execute(text("UPDATE users SET is_admin = true WHERE id = :id"), {"id": moderator["id"]})
    db.commit()
    return moderator


def day(offset: int) -> str:
    return (sa_today() + timedelta(days=offset)).isoformat()


@pytest.fixture
def make_race(client, admin):
    def make(starts_in=3, window=None, **overrides) -> dict:
        body = {
            "name": "Blouberg Marathon",
            "startsOn": day(starts_in),
            "endsOn": day(starts_in + 1),
            "venue": "Eden on the Bay",
            "city": "Bloubergstrand",
            "province": "Western Cape",
            "officialUrl": "https://example.com/blouberg",
            "events": [
                {"label": "Marathon", "distanceKm": 42.2},
                {"label": "Half marathon", "distanceKm": 21.1},
                {"label": "10 km", "distanceKm": 10},
            ],
            **overrides,
        }
        if window is not None:
            body["substitutionOpensOn"], body["substitutionClosesOn"] = day(window[0]), day(window[1])
        res = client.post("/admin/races", json=body, headers=admin["headers"])
        res.raise_for_status()
        return res.json()

    return make


def event_id(race: dict, label: str) -> str:
    return next(e["id"] for e in race["events"] if e["label"] == label)


def join(client, runner, race, label="Half marathon"):
    res = client.put(
        f"/races/{race['id']}/attendance",
        json={"role": "running", "raceEventId": event_id(race, label)},
        headers=runner["headers"],
    )
    res.raise_for_status()
    return res.json()


# --- Races and attendance ---


def test_admins_create_races_others_cannot(client, make_race, make_runner):
    race = make_race()
    assert race["status"] == "published"
    assert [e["label"] for e in race["events"]] == ["Marathon", "Half marathon", "10 km"]  # longest first

    runner = make_runner()
    res = client.post("/admin/races", json={"name": "x"}, headers=runner["headers"])
    assert res.status_code == 403


def test_upcoming_races_listed_soonest_first(client, make_race, make_runner, db):
    later = make_race(starts_in=20, name="Later Race")
    sooner = make_race(starts_in=2, name="Sooner Race")
    past = make_race(starts_in=1, name="Past Race")
    db.execute(
        text("UPDATE races SET starts_on = :d, ends_on = :d WHERE id = :id"),
        {"d": sa_today() - timedelta(days=3), "id": past["id"]},
    )
    db.commit()
    runner = make_runner()

    names = [r["name"] for r in client.get("/races", headers=runner["headers"]).json()]

    assert names == ["Sooner Race", "Later Race"]
    found = client.get("/races", params={"q": "sooner"}, headers=runner["headers"]).json()
    assert [r["id"] for r in found] == [sooner["id"]]
    assert later["id"]


def test_suggested_races_wait_for_approval(client, admin, make_runner):
    runner = make_runner()
    other = make_runner(gender="man", interested_in=["woman"])
    suggestion = client.post(
        "/races/suggestions",
        json={"name": "Two Oceans", "startsOn": day(30), "venue": "UCT", "city": "Cape Town"},
        headers=runner["headers"],
    ).json()
    assert suggestion["status"] == "pending"

    assert client.get("/races", headers=other["headers"]).json() == []
    assert client.get(f"/races/{suggestion['id']}", headers=other["headers"]).status_code == 404
    assert client.get(f"/races/{suggestion['id']}", headers=runner["headers"]).status_code == 200  # own

    pending = client.get("/admin/races", headers=admin["headers"]).json()
    assert [r["id"] for r in pending] == [suggestion["id"]]
    client.post(f"/admin/races/{suggestion['id']}/approve", headers=admin["headers"]).raise_for_status()
    assert [r["name"] for r in client.get("/races", headers=other["headers"]).json()] == ["Two Oceans"]


def test_attendance(client, make_race, make_runner):
    race = make_race()
    runner = make_runner()

    missing_distance = client.put(
        f"/races/{race['id']}/attendance", json={"role": "running"}, headers=runner["headers"]
    )
    assert missing_distance.status_code == 422

    detail = join(client, runner, race, "Marathon")
    assert detail["myAttendance"] == {
        "role": "running",
        "raceEventId": event_id(race, "Marathon"),
        "eventLabel": "Marathon",
    }
    assert detail["attendingCount"] == 1
    assert next(e for e in detail["events"] if e["label"] == "Marathon")["runnerCount"] == 1

    supporting = client.put(
        f"/races/{race['id']}/attendance", json={"role": "supporting"}, headers=runner["headers"]
    ).json()
    assert supporting["myAttendance"]["role"] == "supporting"
    assert supporting["myAttendance"]["raceEventId"] is None

    left = client.delete(f"/races/{race['id']}/attendance", headers=runner["headers"]).json()
    assert left["myAttendance"] is None
    assert left["attendingCount"] == 0


def test_cannot_pick_another_races_distance(client, make_race, make_runner):
    race, other_race = make_race(), make_race(name="Other")
    runner = make_runner()

    res = client.put(
        f"/races/{race['id']}/attendance",
        json={"role": "running", "raceEventId": event_id(other_race, "Marathon")},
        headers=runner["headers"],
    )

    assert res.status_code == 422


def test_editing_a_race_keeps_runners_distances(client, make_race, make_runner, admin):
    race = make_race()
    runner = make_runner()
    join(client, runner, race, "Half marathon")
    events = [
        {"id": e["id"], "label": e["label"].upper(), "distanceKm": e["distanceKm"]} for e in race["events"]
    ]

    client.put(
        f"/admin/races/{race['id']}",
        json={"name": race["name"], "startsOn": race["startsOn"], "venue": "New venue", "city": "Cape Town",
              "events": events},
        headers=admin["headers"],
    ).raise_for_status()

    mine = client.get(f"/races/{race['id']}", headers=runner["headers"]).json()["myAttendance"]
    assert mine["eventLabel"] == "HALF MARATHON"


# --- Who's going ---


def test_attendees_only_visible_to_attendees(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, sipho, race, "Marathon")

    assert client.get(f"/races/{race['id']}/attendees", headers=thandi["headers"]).status_code == 403

    join(client, thandi, race)
    attendees = client.get(f"/races/{race['id']}/attendees", headers=thandi["headers"]).json()
    assert [(a["userId"], a["eventLabel"], a["connection"]) for a in attendees] == [
        (sipho["id"], "Marathon", "none")
    ]


def test_blocked_people_hidden_from_race_spaces(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    client.post(f"/races/{race['id']}/messages", json={"body": "Anyone carpooling?"}, headers=sipho["headers"])

    client.post(f"/users/{sipho['id']}/block", headers=thandi["headers"])

    assert client.get(f"/races/{race['id']}/attendees", headers=thandi["headers"]).json() == []
    assert client.get(f"/races/{race['id']}/messages", headers=thandi["headers"]).json() == []


# --- Race group chat ---


def test_race_chat(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)

    outsider_post = client.post(f"/races/{race['id']}/messages", json={"body": "hi"}, headers=sipho["headers"])
    assert outsider_post.status_code == 403

    join(client, sipho, race)
    msg = client.post(
        f"/races/{race['id']}/messages", json={"body": "Pacing 5:30 for the half, join me!"}, headers=sipho["headers"]
    ).json()
    assert msg["sender"]["id"] == sipho["id"]
    assert msg["sender"]["displayName"]

    chat = client.get(f"/races/{race['id']}/messages", headers=thandi["headers"]).json()
    assert [m["body"] for m in chat] == ["Pacing 5:30 for the half, join me!"]


def test_race_chat_is_live(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    token = thandi["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        ws.receive_json()
        client.post(f"/races/{race['id']}/messages", json={"body": "See you at the start"}, headers=sipho["headers"])
        event = ws.receive_json()

    assert event["type"] == "race_message"
    assert event["message"]["body"] == "See you at the start"


def test_moderators_can_remove_race_messages(client, make_race, make_runner, admin):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    msg = client.post(f"/races/{race['id']}/messages", json={"body": "spam spam"}, headers=sipho["headers"]).json()

    assert client.delete(f"/admin/race-messages/{msg['id']}", headers=thandi["headers"]).status_code == 403
    assert client.delete(f"/admin/race-messages/{msg['id']}", headers=admin["headers"]).status_code == 204

    assert client.get(f"/races/{race['id']}/messages", headers=thandi["headers"]).json() == []


def test_race_chat_rate_limit(client, make_race, make_runner):
    race = make_race()
    runner = make_runner()
    join(client, runner, race)
    for n in range(10):
        client.post(f"/races/{race['id']}/messages", json={"body": f"m{n}"}, headers=runner["headers"]).raise_for_status()

    res = client.post(f"/races/{race['id']}/messages", json={"body": "one more"}, headers=runner["headers"])

    assert res.status_code == 429


def test_reports_from_race_chat_keep_the_messages(client, make_race, make_runner, admin):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    client.post(f"/races/{race['id']}/messages", json={"body": "Selling fake bibs, DM me"}, headers=sipho["headers"])

    report_id = client.post(
        "/reports",
        json={"reportedUserId": sipho["id"], "raceId": race["id"], "reason": "spam"},
        headers=thandi["headers"],
    ).json()["id"]

    evidence = client.get(f"/admin/reports/{report_id}", headers=admin["headers"]).json()["evidence"]
    assert [m["body"] for m in evidence["raceMessages"]] == ["Selling fake bibs, DM me"]


# --- Entry swap board ---


@pytest.mark.parametrize(
    "window, message",
    [
        (None, "doesn't have an official entry transfer window"),
        ((2, 5), "hasn't opened yet"),
        ((-10, -1), "has closed"),
    ],
)
def test_swaps_only_inside_the_official_window(client, make_race, make_runner, window, message):
    race = make_race(starts_in=20, window=window)
    runner = make_runner()
    join(client, runner, race)

    res = client.post(
        f"/races/{race['id']}/listings",
        json={"kind": "offering", "raceEventId": event_id(race, "Half marathon"), "priceRands": 350},
        headers=runner["headers"],
    )

    assert res.status_code == 409
    assert message in res.json()["detail"]
    assert client.get(f"/races/{race['id']}/listings", headers=runner["headers"]).json() == []


def test_swap_board_inside_the_window(client, make_race, make_runner):
    race = make_race(starts_in=20, window=(-2, 3))
    assert race["swapWindow"] == "open"
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)

    offer = client.post(
        f"/races/{race['id']}/listings",
        json={"kind": "offering", "raceEventId": event_id(race, "Half marathon"), "priceRands": 350,
              "note": "Injured, can't run"},
        headers=sipho["headers"],
    ).json()
    looking = client.post(
        f"/races/{race['id']}/listings",
        json={"kind": "looking", "raceEventId": event_id(race, "Marathon"), "priceRands": 999},
        headers=thandi["headers"],
    ).json()

    assert offer["eventLabel"] == "Half marathon"
    assert offer["priceRands"] == 350
    assert looking["priceRands"] is None  # prices only make sense for offers
    board = client.get(f"/races/{race['id']}/listings", headers=thandi["headers"]).json()
    assert [(l["kind"], l["mine"]) for l in board] == [("looking", True), ("offering", False)]


def test_listing_limits_and_closing(client, make_race, make_runner):
    race = make_race(starts_in=20, window=(-2, 3))
    runner = make_runner()
    join(client, runner, race)
    body = {"kind": "offering", "raceEventId": event_id(race, "10 km")}
    first = client.post(f"/races/{race['id']}/listings", json=body, headers=runner["headers"]).json()
    client.post(f"/races/{race['id']}/listings", json=body, headers=runner["headers"]).raise_for_status()

    assert client.post(f"/races/{race['id']}/listings", json=body, headers=runner["headers"]).status_code == 409

    client.post(f"/listings/{first['id']}/close", headers=runner["headers"]).raise_for_status()
    assert client.post(f"/races/{race['id']}/listings", json=body, headers=runner["headers"]).status_code == 201

    client.delete(f"/races/{race['id']}/attendance", headers=runner["headers"])
    join(client, runner, race)
    assert client.get(f"/races/{race['id']}/listings", headers=runner["headers"]).json() == []


# --- Chat requests ---


def test_chat_request_needs_both_at_the_race(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)

    res = client.post(
        "/chat-requests", json={"toUserId": sipho["id"], "raceId": race["id"]}, headers=thandi["headers"]
    )

    assert res.status_code == 403


def test_accepted_request_becomes_a_race_chat(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)

    request = client.post(
        "/chat-requests",
        json={"toUserId": thandi["id"], "raceId": race["id"], "note": "Want to run the half together?"},
        headers=sipho["headers"],
    ).json()
    assert request["incoming"] is False

    [incoming] = client.get("/chat-requests", headers=thandi["headers"]).json()
    assert incoming["incoming"] is True
    assert incoming["note"] == "Want to run the half together?"
    assert incoming["raceName"] == "Blouberg Marathon"
    attendee = client.get(f"/races/{race['id']}/attendees", headers=thandi["headers"]).json()[0]
    assert attendee["connection"] == "incoming"

    accepted = client.post(f"/chat-requests/{incoming['id']}/accept", headers=thandi["headers"]).json()

    [match] = client.get("/matches", headers=sipho["headers"]).json()
    assert match["id"] == accepted["matchId"]
    assert match["kind"] == "race"
    assert match["originRaceName"] == "Blouberg Marathon"
    sent = client.post(f"/matches/{match['id']}/messages", json={"body": "Great!"}, headers=sipho["headers"])
    assert sent.status_code == 201
    assert client.get("/chat-requests", headers=thandi["headers"]).json() == []


def test_asking_back_connects_straight_away(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    client.post("/chat-requests", json={"toUserId": thandi["id"], "raceId": race["id"]}, headers=sipho["headers"])

    res = client.post(
        "/chat-requests", json={"toUserId": sipho["id"], "raceId": race["id"]}, headers=thandi["headers"]
    ).json()

    assert res["status"] == "accepted"
    assert res["matchId"]


def test_declined_requests_cannot_be_resent(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    request = client.post(
        "/chat-requests", json={"toUserId": thandi["id"], "raceId": race["id"]}, headers=sipho["headers"]
    ).json()

    client.post(f"/chat-requests/{request['id']}/decline", headers=thandi["headers"]).raise_for_status()

    again = client.post(
        "/chat-requests", json={"toUserId": thandi["id"], "raceId": race["id"]}, headers=sipho["headers"]
    )
    assert again.status_code == 409
    assert client.get("/chat-requests", headers=sipho["headers"]).json() == []


def test_request_from_a_swap_post(client, make_race, make_runner):
    race = make_race(starts_in=20, window=(-1, 3))
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    listing = client.post(
        f"/races/{race['id']}/listings",
        json={"kind": "offering", "raceEventId": event_id(race, "Half marathon")},
        headers=sipho["headers"],
    ).json()

    request = client.post(
        "/chat-requests", json={"toUserId": sipho["id"], "listingId": listing["id"]}, headers=thandi["headers"]
    ).json()

    assert request["raceId"] == race["id"]
    [incoming] = client.get("/chat-requests", headers=sipho["headers"]).json()
    assert incoming["listingKind"] == "offering"


def test_blocked_people_cannot_request(client, make_race, make_runner):
    race = make_race()
    thandi, sipho = make_runner(), make_runner(gender="man", interested_in=["woman"])
    join(client, thandi, race)
    join(client, sipho, race)
    client.post(f"/users/{sipho['id']}/block", headers=thandi["headers"])

    res = client.post("/chat-requests", json={"toUserId": thandi["id"], "raceId": race["id"]}, headers=sipho["headers"])

    assert res.status_code == 404


# --- Discover ---


def test_discover_shows_shared_races_and_can_filter(client, make_race, make_runner):
    race = make_race()
    thandi = make_runner()
    at_race = make_runner(gender="man", interested_in=["woman"])
    not_at_race = make_runner(gender="man", interested_in=["woman"], km_north=2)
    join(client, thandi, race, "Half marathon")
    join(client, at_race, race, "Marathon")

    cards = {c["userId"]: c for c in client.get("/discover", headers=thandi["headers"]).json()}
    assert cards[at_race["id"]]["sharedRaces"] == [
        {"raceId": race["id"], "name": "Blouberg Marathon", "startsOn": race["startsOn"], "eventLabel": "Marathon"}
    ]
    assert cards[not_at_race["id"]]["sharedRaces"] == []

    filtered = client.get("/discover", params={"race_id": race["id"]}, headers=thandi["headers"]).json()
    assert [c["userId"] for c in filtered] == [at_race["id"]]


def test_race_filter_needs_you_at_the_race(client, make_race, make_runner):
    race = make_race()
    thandi = make_runner()

    res = client.get("/discover", params={"race_id": race["id"]}, headers=thandi["headers"])

    assert res.status_code == 403


def test_sa_today_is_a_date():
    assert isinstance(sa_today(), date)


# --- Filters and paging ---


def names(client, runner, **params) -> list[str]:
    res = client.get("/races", params=params, headers=runner["headers"])
    res.raise_for_status()
    return [r["name"] for r in res.json()]


def test_filter_by_province(client, make_race, make_runner):
    make_race(name="Cape Race", province="Western Cape")
    make_race(name="Jozi Race", province="Gauteng", city="Johannesburg")
    runner = make_runner()

    assert names(client, runner, province="Gauteng") == ["Jozi Race"]


def test_filter_by_dates(client, make_race, make_runner):
    make_race(name="Soon", starts_in=2)
    make_race(name="Next month", starts_in=40)
    runner = make_runner()

    assert names(client, runner, date_to=day(10)) == ["Soon"]
    assert names(client, runner, date_from=day(30)) == ["Next month"]
    # A multi-day race counts if any of its days fall in the range
    assert names(client, runner, date_from=day(3), date_to=day(3)) == ["Soon"]  # starts day 2, ends day 3


def test_filter_by_distance(client, make_race, make_runner):
    make_race(name="Big one")  # marathon, half and 10 km
    make_race(name="Fun run", events=[{"label": "5 km", "distanceKm": 5}])
    make_race(name="Ultra", events=[{"label": "Ultra", "distanceKm": 56}])
    runner = make_runner()

    assert names(client, runner, distance="5k") == ["Fun run"]
    assert sorted(names(client, runner, distance=["half", "ultra"])) == ["Big one", "Ultra"]


def test_paging(client, make_race, make_runner):
    for n in range(5):
        make_race(name=f"Race {n}", starts_in=n + 1)
    runner = make_runner()

    first = names(client, runner, limit=2)
    second = names(client, runner, limit=2, offset=2)
    last = names(client, runner, limit=2, offset=4)

    assert first == ["Race 0", "Race 1"]
    assert second == ["Race 2", "Race 3"]
    assert last == ["Race 4"]  # shorter than the limit: no more pages

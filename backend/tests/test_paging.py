"""Pages and filters: matches, the swap board, admin lists; verified sellers."""
from sqlalchemy import text

from tests.test_notifications import match  # noqa: F401
from tests.test_races import admin, day, event_id, join, make_race, verification_off  # noqa: F401 (fixtures)


def test_matches_come_in_pages_newest_activity_first(client, make_runner):
    thandi = make_runner()
    others = [make_runner(gender="man", interested_in=["woman"]) for _ in range(3)]
    match_ids = [match(client, thandi, o) for o in others]
    # A message in the oldest match moves it to the top
    client.post(f"/matches/{match_ids[0]}/messages", json={"body": "hi"}, headers=others[0]["headers"])

    first = client.get("/matches", params={"limit": 2}, headers=thandi["headers"])
    second = client.get("/matches", params={"limit": 2, "offset": 2}, headers=thandi["headers"])

    assert first.headers["X-Total-Count"] == "3"
    assert [m["id"] for m in first.json()] == [match_ids[0], match_ids[2]]
    assert [m["id"] for m in second.json()] == [match_ids[1]]


def test_swap_board_pages_filters_and_verified_sellers(client, make_race, make_runner, db):
    race = make_race(starts_in=20, window=(-2, 3))
    thandi = make_runner()
    sellers = [make_runner(gender="man", interested_in=["woman"]) for _ in range(3)]
    join(client, thandi, race)
    for s in sellers:
        join(client, s, race)
    for s, label in zip(sellers, ["Half marathon", "Half marathon", "Marathon"]):
        client.post(
            f"/races/{race['id']}/listings",
            json={"kind": "offering", "raceEventId": event_id(race, label), "priceRands": 300},
            headers=s["headers"],
        ).raise_for_status()
    db.execute(text("UPDATE users SET verification_status = 'verified' WHERE id = :id"), {"id": sellers[0]["id"]})
    db.commit()
    url = f"/races/{race['id']}/listings"

    page = client.get(url, params={"limit": 2}, headers=thandi["headers"])
    assert page.headers["X-Total-Count"] == "3"
    assert len(page.json()) == 2
    assert len(client.get(url, params={"limit": 2, "offset": 2}, headers=thandi["headers"]).json()) == 1

    marathon = client.get(url, params={"raceEventId": event_id(race, "Marathon")}, headers=thandi["headers"])
    assert marathon.status_code == 200
    only = client.get(url, params={"race_event_id": event_id(race, "Marathon")}, headers=thandi["headers"])
    assert [l["eventLabel"] for l in only.json()] == ["Marathon"]
    assert client.get(url, params={"kind": "looking"}, headers=thandi["headers"]).json() == []

    everything = client.get(url, headers=thandi["headers"]).json()
    assert sorted(l["sellerVerified"] for l in everything) == [False, False, True]


def test_admin_race_list_pages(client, admin, make_runner):
    runner = make_runner(gender="man", interested_in=["woman"])
    for i in range(3):
        client.post(
            "/races/suggestions",
            json={"name": f"Race {i}", "startsOn": day(30 + i), "venue": "Table Mountain", "city": "Cape Town",
                  "events": [{"label": "10 km", "distanceKm": 10}]},
            headers=runner["headers"],
        )
    page = client.get("/admin/races", params={"limit": 2}, headers=admin["headers"])

    assert page.headers["X-Total-Count"] == "3"
    assert len(page.json()) == 2
    assert len(client.get("/admin/races", params={"limit": 2, "offset": 2}, headers=admin["headers"]).json()) == 1

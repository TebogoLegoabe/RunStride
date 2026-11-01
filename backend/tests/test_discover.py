import pytest
from sqlalchemy import text

from app.matching import RunnerTraits, compatibility


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


def feed(client, runner) -> list[dict]:
    res = client.get("/discover", headers=runner["headers"])
    res.raise_for_status()
    return res.json()


def feed_ids(client, runner) -> list[str]:
    return [c["userId"] for c in feed(client, runner)]


def test_discover_requires_location(client, auth_headers):
    res = client.get("/discover", headers=auth_headers)

    assert res.status_code == 409


def test_mutual_match_appears_with_card_details(client, make_runner):
    thandi = make_runner(gender="woman", interested_in=["man"])
    sipho = make_runner(gender="man", interested_in=["woman"], km_north=5, pace=345)

    cards = feed(client, thandi)

    assert [c["userId"] for c in cards] == [sipho["id"]]
    card = cards[0]
    # ~5 km apart, but stored locations are rounded to ~1 km, so distance is approximate by design
    assert card["distanceKm"] in (5, 6)
    assert card["age"] == 30
    assert card["paceSecondsPerKm"] == 345
    assert card["photos"][0].startswith("/media/photos/")
    assert 0 < card["compatibility"] <= 100
    assert feed_ids(client, sipho) == [thandi["id"]]


def test_gender_preference_must_match_both_ways(client, make_runner):
    thandi = make_runner(gender="woman", interested_in=["man"])
    make_runner(gender="man", interested_in=["man"])  # interested in men only

    assert feed_ids(client, thandi) == []


def test_age_range_must_match_both_ways(client, make_runner):
    thandi = make_runner(age=30, age_range=(25, 35))
    make_runner(gender="man", interested_in=["woman"], age=45)  # too old for her
    make_runner(gender="man", interested_in=["woman"], age=32, age_range=(20, 28))  # she's too old for him

    assert feed_ids(client, thandi) == []


def test_distance_is_the_viewers_own(client, make_runner):
    thandi = make_runner(max_km=50)
    near = make_runner(gender="man", interested_in=["woman"], km_north=8, max_km=10)
    small_radius = make_runner(gender="man", interested_in=["woman"], km_north=15, max_km=10)
    make_runner(gender="man", interested_in=["woman"], km_north=60, max_km=100)  # beyond her 50 km

    # His 10 km only limits who he sees; she still sees him within her 50 km
    assert set(feed_ids(client, thandi)) == {near["id"], small_radius["id"]}
    assert thandi["id"] not in feed_ids(client, small_radius)


def test_unverified_users_hidden_when_verification_required(client, make_runner, settings, db):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    settings.require_id_verification = True

    assert feed_ids(client, thandi) == []

    db.execute(text("UPDATE users SET verification_status = 'verified' WHERE id = :id"), {"id": sipho["id"]})
    db.commit()
    cards = feed(client, thandi)
    assert [c["userId"] for c in cards] == [sipho["id"]]
    assert cards[0]["verified"] is True


def test_more_compatible_runners_rank_first(client, make_runner):
    thandi = make_runner(pace=330, terrains=["trail"], goals=["marathon"])
    unlike = make_runner(gender="man", interested_in=["woman"], km_north=1, pace=480, terrains=["track"], goals=["5k"])
    alike = make_runner(gender="man", interested_in=["woman"], km_north=10, pace=335, terrains=["trail"], goals=["marathon"])

    assert feed_ids(client, thandi) == [alike["id"], unlike["id"]]


def test_mutual_likes_create_a_match(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])

    first = client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).json()
    assert first == {"matched": False, "match": None}
    assert feed_ids(client, thandi) == []  # already swiped

    second = client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"]).json()
    assert second["matched"] is True
    assert second["match"]["userId"] == thandi["id"]

    her_matches = client.get("/matches", headers=thandi["headers"]).json()
    assert [m["userId"] for m in her_matches] == [sipho["id"]]
    assert her_matches[0]["id"] == second["match"]["id"]


def test_pass_hides_both_ways(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])

    res = client.post(f"/discover/{sipho['id']}/pass", headers=thandi["headers"])

    assert res.json() == {"matched": False, "match": None}
    assert feed_ids(client, thandi) == []
    assert feed_ids(client, sipho) == []


def test_like_back_after_pass_is_not_a_match(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{thandi['id']}/pass", headers=sipho["headers"])

    res = client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"])

    assert res.status_code == 404
    assert client.get("/matches", headers=thandi["headers"]).json() == []


def test_cannot_like_someone_outside_your_preferences(client, make_runner):
    thandi = make_runner()
    other_woman = make_runner(gender="woman", interested_in=["man"])

    res = client.post(f"/discover/{other_woman['id']}/like", headers=thandi["headers"])

    assert res.status_code == 404


def test_location_is_rounded_before_storing(client, make_runner, db):
    thandi = make_runner()
    client.put(
        "/me/location", json={"latitude": -26.123456, "longitude": 28.987654}, headers=thandi["headers"]
    ).raise_for_status()

    lat, lng = db.execute(
        text("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM users WHERE id = :id"),
        {"id": thandi["id"]},
    ).one()
    assert (lat, lng) == (-26.12, 28.99)


def test_compatibility_scores():
    base = RunnerTraits(330, 30, ["road", "trail"], ["half_marathon"], ["morning"])

    assert compatibility(base, base) == 100
    opposite = RunnerTraits(600, 5, ["track"], ["ultra"], ["evening"])
    assert compatibility(base, opposite) < 15
    close = RunnerTraits(345, 25, ["road"], ["half_marathon", "social"], ["morning"])
    assert compatibility(base, opposite) < compatibility(base, close) < 100
    # Optional run times left empty are neutral, not a penalty to zero
    no_times = RunnerTraits(330, 30, ["road", "trail"], ["half_marathon"], [])
    assert compatibility(base, no_times) > 90


def test_new_and_active_runners_rank_higher(client, make_runner, db):
    thandi = make_runner()
    older = make_runner(gender="man", interested_in=["woman"], km_north=1)
    newer = make_runner(gender="man", interested_in=["woman"], km_north=10)
    # Same running profile: only newness and activity differ
    db.execute(
        text("UPDATE users SET created_at = now() - interval '90 days', last_seen_at = now() - interval '60 days', "
             "last_login_at = now() - interval '60 days' WHERE id = :id"),
        {"id": older["id"]},
    )
    db.commit()

    assert feed_ids(client, thandi) == [newer["id"], older["id"]]


def test_second_look_is_plus_only(client, make_runner):
    thandi = make_runner()
    res = client.get("/discover?passed=true", headers=thandi["headers"])
    assert res.status_code == 402


def test_plus_second_look_shows_passes_and_can_like_them(client, make_runner):
    from tests.test_races import buy

    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"])
    client.post(f"/discover/{sipho['id']}/pass", headers=thandi["headers"])
    assert sipho["id"] not in feed_ids(client, thandi)

    buy(client, thandi)
    passed = client.get("/discover?passed=true", headers=thandi["headers"]).json()
    assert [c["userId"] for c in passed] == [sipho["id"]]

    res = client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).json()
    assert res["matched"] is True
    assert client.get("/discover?passed=true", headers=thandi["headers"]).json() == []


def test_free_users_cannot_turn_a_pass_into_a_like(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"])
    client.post(f"/discover/{sipho['id']}/pass", headers=thandi["headers"])

    res = client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).json()
    assert res["matched"] is False

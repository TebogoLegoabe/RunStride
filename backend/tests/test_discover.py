from datetime import date
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import text

from app.matching import RunnerTraits, compatibility
from tests.conftest import sign_in

JHB = (-26.20, 28.04)
KM_LAT = 0.009  # roughly 1 km of latitude


def png() -> bytes:
    out = BytesIO()
    Image.new("RGB", (20, 20), "teal").save(out, "PNG")
    return out.getvalue()


def birth_for(age: int) -> str:
    today = date.today()
    return today.replace(year=today.year - age, month=1, day=1).isoformat()


@pytest.fixture
def make_runner(client, sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    counter = iter(range(100))

    def make(
        gender="woman",
        interested_in=("man",),
        age=30,
        age_range=(25, 40),
        km_north=0.0,
        max_km=25,
        pace=330,
        terrains=("road",),
        goals=("social",),
        run_times=("morning",),
        weekly_km=25,
    ) -> dict:
        phone = f"+2782555{next(counter):04d}"
        token = sign_in(client, sms, phone=phone)["token"]
        h = {"Authorization": f"Bearer {token}"}
        client.put(
            "/me/profile", json={"displayName": phone[-4:], "birthDate": birth_for(age)}, headers=h
        ).raise_for_status()
        client.post("/me/photos", headers=h, files={"file": ("p.png", png(), "image/png")}).raise_for_status()
        client.put(
            "/me/running-profile",
            json={
                "paceSecondsPerKm": pace,
                "weeklyKm": weekly_km,
                "terrains": list(terrains),
                "goals": list(goals),
                "runTimes": list(run_times),
            },
            headers=h,
        ).raise_for_status()
        client.put(
            "/me/dating-preferences",
            json={
                "gender": gender,
                "interestedIn": list(interested_in),
                "ageMin": age_range[0],
                "ageMax": age_range[1],
                "maxDistanceKm": max_km,
            },
            headers=h,
        ).raise_for_status()
        client.put(
            "/me/location", json={"latitude": JHB[0] + km_north * KM_LAT, "longitude": JHB[1]}, headers=h
        ).raise_for_status()
        user_id = client.get("/me", headers=h).json()["id"]
        return {"headers": h, "id": user_id}

    return make


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


def test_distance_uses_the_smaller_maximum(client, make_runner):
    thandi = make_runner(max_km=50)
    near = make_runner(gender="man", interested_in=["woman"], km_north=8, max_km=10)
    make_runner(gender="man", interested_in=["woman"], km_north=15, max_km=10)  # beyond his 10 km
    make_runner(gender="man", interested_in=["woman"], km_north=60, max_km=100)  # beyond her 50 km

    assert feed_ids(client, thandi) == [near["id"]]


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

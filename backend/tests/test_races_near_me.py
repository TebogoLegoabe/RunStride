"""Races near me: a radius from where the runner is, and the distance on each race."""
from tests.test_races import admin, day, make_race, verification_off  # noqa: F401 (fixtures)

# Around Cape Town: the city itself, Stellenbosch (about 45 km away) and Johannesburg (about 1,260 km)
CAPE_TOWN = (-33.9249, 18.4241)


def set_location(client, headers, point=CAPE_TOWN):
    client.put("/me/location", json={"latitude": point[0], "longitude": point[1]}, headers=headers).raise_for_status()


def test_races_are_found_by_distance_from_you(client, admin, make_runner, make_race):
    make_race(name="Cape Town Run", city="Cape Town", province="Western Cape")
    make_race(name="Winelands Run", city="Stellenbosch", province="Western Cape")
    make_race(name="Joburg Run", city="Johannesburg", province="Gauteng")
    runner = make_runner(gender="man", interested_in=["woman"])
    set_location(client, runner["headers"])

    def names(**params):
        return [r["name"] for r in client.get("/races", params=params, headers=runner["headers"]).json()]

    assert sorted(names()) == ["Cape Town Run", "Joburg Run", "Winelands Run"]  # no radius: everything
    assert sorted(names(radius_km=100)) == ["Cape Town Run", "Winelands Run"]
    assert names(radius_km=10) == ["Cape Town Run"]
    assert sorted(names(radius_km=2000)) == ["Cape Town Run", "Joburg Run", "Winelands Run"]


def test_each_race_says_how_far_away_it_is(client, admin, make_runner, make_race):
    make_race(name="Winelands Run", city="Stellenbosch", province="Western Cape")
    runner = make_runner(gender="man", interested_in=["woman"])
    set_location(client, runner["headers"])

    race = client.get("/races", headers=runner["headers"]).json()[0]

    assert 35 < race["distanceKm"] < 55


def test_near_me_needs_your_location(client, admin, make_runner, make_race):
    make_race(city="Cape Town", province="Western Cape")
    runner = make_runner(gender="man", interested_in=["woman"])
    # make_runner shares a location, so remove it the way an account without one would look
    from sqlalchemy import text

    from tests.conftest import SessionLocal

    with SessionLocal() as db:
        db.execute(text("UPDATE users SET location = NULL WHERE id = :id"), {"id": runner["id"]})
        db.commit()

    res = client.get("/races", params={"radius_km": 50}, headers=runner["headers"])

    assert res.status_code == 409 and "location" in res.json()["detail"]


def test_a_town_we_dont_know_is_left_out_of_near_me(client, admin, make_runner, make_race):
    make_race(name="Mystery Run", city="Nowhereville", province="Western Cape")
    make_race(name="Cape Town Run", city="Cape Town", province="Western Cape")
    runner = make_runner(gender="man", interested_in=["woman"])
    set_location(client, runner["headers"])

    near = client.get("/races", params={"radius_km": 500}, headers=runner["headers"]).json()

    assert [r["name"] for r in near] == ["Cape Town Run"]
    everywhere = client.get("/races", headers=runner["headers"]).json()
    assert {r["name"] for r in everywhere} == {"Mystery Run", "Cape Town Run"}
    assert next(r for r in everywhere if r["name"] == "Mystery Run")["distanceKm"] is None

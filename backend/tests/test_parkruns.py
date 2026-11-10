"""Weekly parkruns: one entry per Saturday, listed apart from the races."""
from datetime import date

from app.parkrun_import import generate, read_parkruns, saturdays
from app.races import sa_today
from tests.test_races import admin, join, make_race, verification_off  # noqa: F401 (fixtures)

DELTA = {
    "name": "Delta parkrun",
    "venue": "Delta Park",
    "city": "Johannesburg",
    "province": "Gauteng",
    "latitude": "-26.125349",
    "longitude": "28.009354",
    "url": "https://www.parkrun.co.za/delta/",
}


def test_saturdays_start_today_when_today_is_one():
    assert saturdays(date(2026, 11, 10), 2) == [date(2026, 11, 14), date(2026, 11, 21)]  # from a Tuesday
    assert saturdays(date(2026, 11, 14), 1) == [date(2026, 11, 14)]
    assert saturdays(date(2026, 11, 15), 1) == [date(2026, 11, 21)]  # from a Sunday


def test_the_parkrun_list_is_complete_and_inside_south_africa():
    rows = read_parkruns()
    assert len(rows) > 200 and len({r["name"] for r in rows}) == len(rows)
    for row in rows:
        assert row["name"] and row["venue"] and row["city"] and row["province"]
        assert -35.5 <= float(row["latitude"]) <= -21.5 and 16 <= float(row["longitude"]) <= 33.5


def test_parkruns_are_listed_apart_from_races(client, db, make_race, make_runner):
    race = make_race()
    thandi = make_runner()
    assert generate(db, weeks=2, parkruns=[DELTA]) == {"added": 2, "updated": 0}
    # Running it again changes nothing
    assert generate(db, weeks=2, parkruns=[DELTA]) == {"added": 0, "updated": 2}
    db.commit()

    def listed(**params) -> list[dict]:
        res = client.get("/races", params=params, headers=thandi["headers"])
        res.raise_for_status()
        return res.json()

    assert [r["id"] for r in listed()] == [race["id"]]
    parkruns = listed(kind="parkrun")
    assert [(r["name"], r["kind"], r["startsOn"]) for r in parkruns] == [
        ("Delta parkrun", "parkrun", day.isoformat()) for day in saturdays(sa_today(), 2)
    ]

    # A parkrun you've joined shows up with your races
    detail = client.get(f"/races/{parkruns[0]['id']}", headers=thandi["headers"]).json()
    join(client, thandi, detail, "5 km")
    assert [r["id"] for r in listed(mine=True)] == [parkruns[0]["id"]]

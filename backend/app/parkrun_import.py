"""List the weekly parkruns for the next few Saturdays.

    docker compose exec api python -m app.parkrun_import            # the next 4 Saturdays
    docker compose exec api python -m app.parkrun_import --weeks 8

A parkrun happens every Saturday, but a race here is one dated event, so each parkrun in
data/za_parkruns.csv (name, venue, city, province, latitude, longitude, url) gets one entry per
Saturday, of kind "parkrun". They're listed apart from the races (GET /races?kind=parkrun).

Run it again every few weeks to add the following Saturdays: entries that already exist are
updated, not duplicated, and the ones that have passed drop off the list by themselves.
"""

import argparse
import csv
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Race, RaceEvent
from app.races import sa_today

PARKRUNS_FILE = Path(__file__).resolve().parent.parent / "data" / "za_parkruns.csv"
DISTANCE_LABEL, DISTANCE_KM = "5 km", 5.0


def saturdays(first_day: date, weeks: int) -> list[date]:
    """The next `weeks` Saturdays, counting `first_day` itself if it's one."""
    first = first_day + timedelta(days=(5 - first_day.weekday()) % 7)  # Monday is 0, Saturday 5
    return [first + timedelta(weeks=n) for n in range(weeks)]


def read_parkruns(path: Path = PARKRUNS_FILE) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return [{key: (value or "").strip() for key, value in row.items()} for row in csv.DictReader(f)]


def generate(db, weeks: int = 4, today: date | None = None, parkruns: list[dict] | None = None) -> dict[str, int]:
    """Add or update every parkrun for each of the next `weeks` Saturdays. The caller commits."""
    days = saturdays(today or sa_today(), weeks)
    existing = {
        (race.name, race.starts_on): race
        for race in db.scalars(select(Race).where(Race.kind == "parkrun", Race.starts_on.in_(days))).all()
    }
    counts = {"added": 0, "updated": 0}
    for row in parkruns if parkruns is not None else read_parkruns():
        for day in days:
            race = existing.get((row["name"], day))
            if race is None:
                # The one distance is only set here, so people who joined keep their choice on later runs
                race = Race(
                    kind="parkrun",
                    status="published",
                    name=row["name"],
                    starts_on=day,
                    ends_on=day,
                    events=[RaceEvent(label=DISTANCE_LABEL, distance_km=DISTANCE_KM)],
                )
                db.add(race)
                counts["added"] += 1
            else:
                counts["updated"] += 1
            race.venue, race.city = row["venue"], row["city"]
            race.province = row["province"] or None
            race.official_url = row["url"] or None
            race.latitude, race.longitude = float(row["latitude"]), float(row["longitude"])
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--weeks", type=int, default=4, choices=range(1, 13), metavar="1-12")
    args = parser.parse_args()
    with SessionLocal() as db:
        counts = generate(db, weeks=args.weeks)
        db.commit()
    print(f"parkrun Saturdays added: {counts['added']}, updated: {counts['updated']}.")


if __name__ == "__main__":
    main()

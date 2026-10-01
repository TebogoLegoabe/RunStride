"""Import races from a CSV file (e.g. exported from a spreadsheet).

    docker compose exec api python -m app.race_import data/races.csv

Columns (header row required):
    name, starts_on, ends_on, venue, city, province, official_url,
    substitution_opens_on, substitution_closes_on, substitution_url, events

Dates are YYYY-MM-DD. ends_on and the substitution columns may be empty.
events lists the distances, separated by ";", each as  label|distance_km|start time
with the start time in South African time (YYYY-MM-DD HH:MM) or empty, e.g.
    Marathon|42.2|2026-10-03 05:30; Half marathon|21.1|2026-10-04 06:00

A race with the same name and start date as an existing one is updated, not duplicated,
so the same file can be imported again after corrections.
"""

import argparse
import csv
import sys
from datetime import date, datetime
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Race, RaceEvent
from app.races import SA_TZ
from app.schemas import RaceBody


def parse_events(cell: str) -> list[dict]:
    events = []
    for chunk in filter(None, (c.strip() for c in (cell or "").split(";"))):
        parts = [p.strip() for p in chunk.split("|")]
        if len(parts) not in (2, 3):
            raise ValueError(f"event '{chunk}' should be label|distance_km|start time")
        starts_at = None
        if len(parts) == 3 and parts[2]:
            starts_at = datetime.strptime(parts[2], "%Y-%m-%d %H:%M").replace(tzinfo=SA_TZ)
        events.append({"label": parts[0], "distance_km": float(parts[1]), "starts_at": starts_at})
    return events


def row_to_body(row: dict) -> RaceBody:
    def opt(key: str) -> str | None:
        return (row.get(key) or "").strip() or None

    return RaceBody(
        name=row["name"].strip(),
        starts_on=date.fromisoformat(row["starts_on"].strip()),
        ends_on=date.fromisoformat(opt("ends_on")) if opt("ends_on") else None,
        venue=row["venue"].strip(),
        city=row["city"].strip(),
        province=opt("province"),
        official_url=opt("official_url"),
        substitution_opens_on=date.fromisoformat(opt("substitution_opens_on")) if opt("substitution_opens_on") else None,
        substitution_closes_on=date.fromisoformat(opt("substitution_closes_on")) if opt("substitution_closes_on") else None,
        substitution_url=opt("substitution_url"),
        events=parse_events(row.get("events", "")),
    )


def upsert(db, body: RaceBody) -> str:
    race = db.scalar(select(Race).where(Race.name == body.name, Race.starts_on == body.starts_on))
    action = "updated"
    if race is None:
        race = Race(status="published")
        db.add(race)
        action = "added"
    race.name, race.starts_on, race.ends_on = body.name, body.starts_on, body.ends_on
    race.venue, race.city, race.province = body.venue, body.city, body.province
    race.official_url = body.official_url
    race.substitution_opens_on = body.substitution_opens_on
    race.substitution_closes_on = body.substitution_closes_on
    race.substitution_url = body.substitution_url
    # Match distances by label, so people who already chose one keep it
    existing = {e.label.lower(): e for e in race.events}
    events = []
    for item in body.events:
        event = existing.get(item.label.lower()) or RaceEvent()
        event.label, event.distance_km, event.starts_at = item.label, item.distance_km, item.starts_at
        events.append(event)
    race.events = events
    return action


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_file", type=Path)
    args = parser.parse_args()

    if not args.csv_file.is_file():
        # Inside Docker, /app is the backend folder, so data/x.csv means backend/data/x.csv
        available = sorted(str(p) for p in Path("data").glob("*.csv"))
        raise SystemExit(
            f"Can't find {args.csv_file}. Put your CSV in the backend/data folder "
            f"(it's /app/data inside the container).\n"
            f"CSV files found there: {', '.join(available) or 'none'}"
        )

    counts = {"added": 0, "updated": 0}
    errors = []
    with SessionLocal() as db, args.csv_file.open(newline="", encoding="utf-8-sig") as f:
        for line_no, row in enumerate(csv.DictReader(f), start=2):
            try:
                body = row_to_body(row)
            except (KeyError, ValueError, ValidationError) as exc:
                errors.append(f"line {line_no}: {exc}")
                continue
            counts[upsert(db, body)] += 1
        if errors:
            db.rollback()
            print("Nothing imported: fix these rows first.", file=sys.stderr)
            for e in errors:
                print("  " + e, file=sys.stderr)
            raise SystemExit(1)
        db.commit()
    print(f"Races added: {counts['added']}, updated: {counts['updated']}.")


if __name__ == "__main__":
    main()

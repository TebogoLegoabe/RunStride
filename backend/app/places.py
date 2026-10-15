"""Where South African towns are, so a race can be found "near me".

data/za_places.csv lists the towns races have been held in (city, province, latitude, longitude). A race
gets its position from that table by its town, unless the CSV or the admin form gives exact coordinates.
A town that isn't in the table simply doesn't show up in "near me" until someone adds it.
"""
import csv
from functools import lru_cache
from pathlib import Path

PLACES_FILE = Path(__file__).resolve().parent.parent / "data" / "za_places.csv"


@lru_cache
def _places() -> dict[tuple[str, str], tuple[float, float]]:
    table: dict[tuple[str, str], tuple[float, float]] = {}
    if not PLACES_FILE.is_file():
        return table
    with PLACES_FILE.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            point = (float(row["latitude"]), float(row["longitude"]))
            table[(row["city"].strip().lower(), row["province"].strip().lower())] = point
            table.setdefault((row["city"].strip().lower(), ""), point)  # town alone, if the province differs
    return table


def place_coords(city: str | None, province: str | None) -> tuple[float, float] | None:
    """(latitude, longitude) for a town, or None if we don't know it."""
    if not city:
        return None
    table = _places()
    key = city.strip().lower()
    return table.get((key, (province or "").strip().lower())) or table.get((key, ""))

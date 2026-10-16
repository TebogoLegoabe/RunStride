"""Running clubs and groups people belong to: tidy names, and recognise the same club spelled differently."""
import re

MAX_CLUBS = 3
MAX_CLUB_LENGTH = 60
# Words that don't tell clubs apart: "Hout Bay Harriers AC" and "Hout Bay Harriers" are one club,
# and so are "Vitality" and "Vitality Run Club"
_GENERIC = {"club", "ac", "athletics", "athletic", "running", "run", "the", "and"}

# Suggested when someone starts typing, alongside the clubs other runners here have added
SEED_CLUBS = ["parkrun", "Nike Run Club", "Vitality"]


def clean_club(name: str) -> str:
    return re.sub(r"\s+", " ", name or "").strip()


def club_key(name: str) -> str:
    """Same key for the same club, however it's capitalised, punctuated or suffixed."""
    words = re.sub(r"[^a-z0-9 ]", "", clean_club(name).casefold().replace("&", " and ")).split()
    kept = [w for w in words if w not in _GENERIC]
    return "".join(kept or words)


def shared_clubs(mine: list[str], theirs: list[str]) -> list[str]:
    """Their clubs that are also one of mine (in their own spelling)."""
    my_keys = {club_key(c) for c in mine}
    return [c for c in theirs if club_key(c) in my_keys]

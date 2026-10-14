"""South African ID numbers: 13 digits, YYMMDD SSSS C A Z.

YYMMDD is the birth date, SSSS a sequence (0000-4999 female, 5000-9999 male), C is 0 for citizens and
1 for permanent residents, A is a legacy digit and Z a Luhn check digit. A number that passes these
checks is well-formed; it does not prove the person holds it. That is what the ID photo review is for.
"""
import hashlib
import hmac
from dataclasses import dataclass
from datetime import date

from app.config import get_settings


class InvalidSaId(ValueError):
    pass


@dataclass(frozen=True)
class SaId:
    number: str
    born: tuple[int, int, int]  # year % 100, month, day
    citizen: bool
    sequence: int


def _luhn_ok(number: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(number)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def clean(raw: str) -> str:
    return "".join(ch for ch in raw if ch.isdigit())


def parse_sa_id(raw: str) -> SaId:
    number = clean(raw)
    if len(number) != 13:
        raise InvalidSaId("An ID number has 13 digits.")
    if not _luhn_ok(number):
        raise InvalidSaId("That ID number isn't valid. Please check it.")
    yy, mm, dd = int(number[0:2]), int(number[2:4]), int(number[4:6])
    # Century doesn't matter here (we compare to the profile's date); just check the day exists
    try:
        date(2000 if yy % 4 == 0 else 2001, mm, dd)
    except ValueError:
        raise InvalidSaId("The birth date in that ID number isn't valid.") from None
    if number[10] not in "01":
        raise InvalidSaId("That ID number isn't valid. Please check it.")
    return SaId(number=number, born=(yy, mm, dd), citizen=number[10] == "0", sequence=int(number[6:10]))


def matches_birth_date(sa_id: SaId, birth_date: date) -> bool:
    return sa_id.born == (birth_date.year % 100, birth_date.month, birth_date.day)


def id_fingerprint(number: str) -> str:
    """One-way fingerprint, kept after the review so the same ID can't open many accounts or come back
    after a ban. Keyed with the server secret so it can't be rebuilt by guessing numbers."""
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"sa-id:{number}".encode(), hashlib.sha256).hexdigest()

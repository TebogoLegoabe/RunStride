"""Development only: fill the discover feed with fake runners.

    docker compose exec api python -m app.dev_seed             # 30 runners near the newest real user with a location
    docker compose exec api python -m app.dev_seed --count 50
    docker compose exec api python -m app.dev_seed --match-me   # all compatible with you
    docker compose exec api python -m app.dev_seed --races      # seed runners join races and chat
    docker compose exec api python -m app.dev_seed --lat -26.20 --lng 28.04
    docker compose exec api python -m app.dev_seed --clear     # remove every seed runner and their photos
"""

import argparse
from dataclasses import dataclass
import math
import random
import time
import uuid
from datetime import date
from io import BytesIO

from geoalchemy2 import WKTElement
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import delete, select, text

from app import run_dates
from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    DatingPreferences,
    Match,
    Message,
    Profile,
    ProfilePhoto,
    Race,
    RaceAttendance,
    RaceMessage,
    RunDate,
    RunningProfile,
    Swipe,
    User,
    VerificationStatus,
)
from app.races import sa_today
from app.realtime import publish_message
from app.security import utcnow
from app.storage import get_photo_storage

# Real South African numbers never start with 0 after +27, so these can't collide with real users
SEED_PHONE_PREFIX = "+270000"
JOHANNESBURG = (-26.20, 28.04)
RADIUS_KM = 30
# Share of seed runners who have already liked each real user, so matches can happen
LIKES_REAL_USERS = 0.4

NAMES = {
    "woman": ["Thandi", "Lerato", "Naledi", "Zanele", "Ayesha", "Chloe", "Nomsa", "Palesa", "Refilwe",
              "Anika", "Kgomotso", "Megan", "Priya", "Lindiwe", "Busi", "Karabo", "Amahle", "Jess"],
    "man": ["Sipho", "Thabo", "Kagiso", "Mpho", "Ruan", "Tshepo", "Bongani", "Liam", "Ahmed", "Lwazi",
            "Kabelo", "Jaco", "Neo", "Themba", "Rohan", "Sizwe", "Dylan", "Musa"],
    "non_binary": ["Alex", "Sam", "Jordan", "Riley", "Kai"],
}
BIOS = [
    "Parkrun every Saturday, coffee straight after.",
    "Training for my first half. Looking for someone to keep me honest on long runs.",
    "Trail runner at heart. Happiest on a muddy hill.",
    "Early mornings before work. The quiet roads are the best part.",
    "Recovering sprinter learning to love the long run.",
    "Comrades one day. For now: 10Ks and good conversation.",
    None,
]
REPLIES = [
    "Haha love that! Are you a morning or evening runner?",
    "Nice! What's your favourite route around here?",
    "I'm training for a half at the moment. You?",
    "A parkrun date could be fun, keen?",
    "Sounds good! What pace do you usually run?",
    "That's awesome. I'm always looking for a running buddy.",
]
RACE_CHAT = [
    "Anyone else nervous? First time at this one!",
    "Pacing 5:30/km for the half if anyone wants to join.",
    "Where's everyone parking? Heard it fills up early.",
    "Who's keen for coffee after the finish?",
    "Weather looks perfect for Sunday 🙌",
    "Doing the 10 km with my running club, come say hi at the start.",
    "Tip: get there 45 min early, the toilet queues are long.",
]
COLORS = ["#4ecdc4", "#f59e0b", "#8b5cf6", "#ef4444", "#10b981", "#3b82f6", "#ec4899"]


def placeholder_photo(name: str, color: str) -> bytes:
    img = Image.new("RGB", (800, 1000), color)
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=380)
    draw.text((400, 480), name[0], fill="white", font=font, anchor="mm")
    draw.text((400, 880), "SEED", fill="white", font=ImageFont.load_default(size=48), anchor="mm")
    out = BytesIO()
    img.save(out, "JPEG", quality=80)
    return out.getvalue()


def random_point_near(lat: float, lng: float, radius_km: float) -> tuple[float, float]:
    distance = radius_km * math.sqrt(random.random())  # uniform over the disc, not bunched at the centre
    bearing = random.uniform(0, 2 * math.pi)
    d_lat = distance * math.cos(bearing) / 111.0
    d_lng = distance * math.sin(bearing) / (111.0 * math.cos(math.radians(lat)))
    return round(lat + d_lat, 2), round(lng + d_lng, 2)


def pick_interested_in(gender: str) -> list[str]:
    roll = random.random()
    if roll < 0.15:
        return ["woman", "man", "non_binary"]
    if gender == "woman":
        return ["man"] if roll < 0.85 else ["woman"]
    if gender == "man":
        return ["woman"] if roll < 0.85 else ["man"]
    return ["woman", "man", "non_binary"]


@dataclass(frozen=True)
class MatchTarget:
    """The real user --match-me generates runners for."""

    phone: str
    gender: str
    age: int
    interested_in: list[str]
    age_min: int
    age_max: int


def newest_real_user() -> MatchTarget | None:
    """The most recently active real user who has finished their dating preferences."""
    with SessionLocal() as db:
        user = db.scalar(
            select(User)
            .join(DatingPreferences, DatingPreferences.user_id == User.id)
            .join(Profile, Profile.user_id == User.id)
            .where(User.phone.not_like(f"{SEED_PHONE_PREFIX}%"))
            .order_by(User.last_login_at.desc().nulls_last())
            .limit(1)
        )
        if user is None:
            return None
        prefs, today = user.dating_preferences, date.today()
        born = user.profile.birth_date
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        return MatchTarget(user.phone, prefs.gender, age, list(prefs.interested_in), prefs.age_min, prefs.age_max)


def identity_for(target: MatchTarget | None) -> tuple[str, int, list[str], int, int]:
    """(gender, age, interested_in, age_min, age_max) for one seed runner.

    With a target, the runner is someone the target could match with: a gender they want,
    an age in their range, wanting the target's gender, with the target's age in range.
    """
    if target is None:
        gender = random.choices(["woman", "man", "non_binary"], weights=[45, 45, 10])[0]
        age = random.randint(21, 45)
        return gender, age, pick_interested_in(gender), max(18, age - random.randint(4, 8)), min(99, age + random.randint(4, 10))

    gender = random.choice(target.interested_in)
    age = random.randint(max(18, target.age_min), min(99, target.age_max))
    interested_in = {target.gender}
    if random.random() < 0.3:
        interested_in.add(random.choice(["woman", "man", "non_binary"]))
    age_min = max(18, min(age - random.randint(3, 8), target.age))
    age_max = min(99, max(age + random.randint(3, 8), target.age))
    return gender, age, sorted(interested_in), age_min, age_max


def seed(count: int, center: tuple[float, float], target: MatchTarget | None = None) -> None:
    storage = get_photo_storage()
    today = date.today()
    with SessionLocal() as db:
        existing = db.scalars(select(User.phone).where(User.phone.like(f"{SEED_PHONE_PREFIX}%"))).all()
        next_number = len(existing) + 1
        real_user_ids = db.scalars(select(User.id).where(User.phone.not_like(f"{SEED_PHONE_PREFIX}%"))).all()
        for i in range(count):
            gender, age, interested_in, age_min, age_max = identity_for(target)
            name = random.choice(NAMES[gender])
            lat, lng = random_point_near(*center, RADIUS_KM)

            user = User(
                phone=f"{SEED_PHONE_PREFIX}{next_number + i:05d}",
                verification_status=VerificationStatus.verified,
                location=WKTElement(f"POINT({lng} {lat})", srid=4326),
            )
            user.profile = Profile(
                display_name=name,
                birth_date=today.replace(year=today.year - age, month=random.randint(1, 12), day=random.randint(1, 28)),
                bio=random.choice(BIOS),
            )
            color = random.choice(COLORS)
            user.profile.photos = [
                ProfilePhoto(url=storage.save(placeholder_photo(name, color)), position=0)
            ]
            user.running_profile = RunningProfile(
                pace_seconds_per_km=random.randint(270, 480),
                weekly_km=random.randint(5, 80),
                terrains=random.sample(["road", "trail", "track", "treadmill"], k=random.randint(1, 3)),
                goals=random.sample(
                    ["social", "fitness", "5k", "10k", "half_marathon", "marathon", "ultra"], k=random.randint(1, 3)
                ),
                run_times=random.sample(["early_morning", "morning", "lunchtime", "evening"], k=random.randint(0, 2)),
            )
            user.dating_preferences = DatingPreferences(
                gender=gender,
                interested_in=interested_in,
                age_min=age_min,
                age_max=age_max,
                max_distance_km=100 if target else random.choice([25, 50, 100]),
            )
            db.add(user)
            db.flush()
            for real_user_id in real_user_ids:
                if random.random() < LIKES_REAL_USERS:
                    db.add(Swipe(swiper_id=user.id, target_id=real_user_id, liked=True))
        db.commit()
    print(f"Created {count} seed runners within {RADIUS_KM} km of {center[0]:.2f}, {center[1]:.2f}.")
    if target:
        print(f"All of them match the preferences of {target.phone}.")
    print("Some already like you: like them back to see a match.")


def clear() -> None:
    storage = get_photo_storage()
    with SessionLocal() as db:
        seed_users = select(User.id).where(User.phone.like(f"{SEED_PHONE_PREFIX}%"))
        urls = db.scalars(select(ProfilePhoto.url).where(ProfilePhoto.user_id.in_(seed_users))).all()
        result = db.execute(delete(User).where(User.phone.like(f"{SEED_PHONE_PREFIX}%")))
        db.commit()
    for url in urls:
        storage.delete(url)
    print(f"Removed {result.rowcount} seed runners and {len(urls)} photos.")


def default_center() -> tuple[float, float]:
    """The newest real user who has shared a location, else Johannesburg."""
    with SessionLocal() as db:
        row = db.execute(
            text(
                "SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM users "
                "WHERE location IS NOT NULL AND phone NOT LIKE :seed "
                "ORDER BY location_updated_at DESC LIMIT 1"
            ),
            {"seed": f"{SEED_PHONE_PREFIX}%"},
        ).first()
    return (row[0], row[1]) if row else JOHANNESBURG


def dev_auto_reply(match_id: uuid.UUID, sender_id: uuid.UUID) -> None:
    """Development only: a seed runner answers your message a couple of seconds later,
    so live chat can be tried with one account. Real users never trigger this."""
    with SessionLocal() as db:
        match = db.get(Match, match_id)
        if match is None or match.ended_at is not None:
            return
        other = db.get(User, match.other_user_id(sender_id))
        if other is None or not other.phone.startswith(SEED_PHONE_PREFIX):
            return
        time.sleep(2)  # feels like someone typing
        reply = Message(match_id=match.id, sender_id=other.id, body=random.choice(REPLIES), created_at=utcnow())
        db.add(reply)
        db.commit()
        publish_message(reply, [match.user_a_id, match.user_b_id])


def dev_auto_accept_run(run_date_id: uuid.UUID, proposer_id: uuid.UUID) -> None:
    """Development only: a seed runner accepts your run suggestion a couple of seconds later."""
    with SessionLocal() as db:
        run = db.get(RunDate, run_date_id)
        match = db.get(Match, run.match_id) if run else None
        if match is None or match.ended_at is not None:
            return
        other = db.get(User, match.other_user_id(proposer_id))
        if other is None or not other.phone.startswith(SEED_PHONE_PREFIX):
            return
        time.sleep(2)
        db.refresh(run)
        if run.status == "proposed":
            run_dates.respond(db, run, match, other, "accept")


def seed_race_activity(share: float = 0.6, messages_per_race: int = 5) -> None:
    """Seed runners join upcoming races (spread over the distances) and chat in them."""
    with SessionLocal() as db:
        races = db.scalars(select(Race).where(Race.status == "published", Race.ends_on >= sa_today())).all()
        runners = db.scalars(select(User).where(User.phone.like(f"{SEED_PHONE_PREFIX}%"))).all()
        if not races or not runners:
            raise SystemExit("Need upcoming races and seed runners first (import races, then run dev_seed).")
        for race in races:
            going = [r for r in runners if random.random() < share]
            for runner in going:
                if db.get(RaceAttendance, (race.id, runner.id)):
                    continue
                running = race.events and random.random() < 0.85
                db.add(
                    RaceAttendance(
                        race_id=race.id,
                        user_id=runner.id,
                        role="running" if running else "supporting",
                        race_event_id=random.choice(race.events).id if running else None,
                    )
                )
            for runner in random.sample(going, k=min(messages_per_race, len(going))):
                db.add(
                    RaceMessage(race_id=race.id, sender_id=runner.id, body=random.choice(RACE_CHAT), created_at=utcnow())
                )
            print(f"{race.name}: {len(going)} seed runners going")
        db.commit()


def main() -> None:
    if not get_settings().is_development:
        raise SystemExit("dev_seed only runs with ENVIRONMENT=development.")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=30)
    parser.add_argument("--lat", type=float)
    parser.add_argument("--lng", type=float)
    parser.add_argument("--clear", action="store_true", help="remove all seed runners")
    parser.add_argument(
        "--races", action="store_true", help="seed runners join upcoming races and post in their chats"
    )
    parser.add_argument(
        "--match-me",
        action="store_true",
        help="make every runner a possible match for the most recently active real user",
    )
    args = parser.parse_args()

    if args.clear:
        clear()
        return
    if args.races:
        seed_race_activity()
        return
    center = (args.lat, args.lng) if args.lat is not None and args.lng is not None else default_center()
    target = None
    if args.match_me:
        target = newest_real_user()
        if target is None:
            raise SystemExit("No real user with dating preferences yet: finish onboarding in the app first.")
    seed(args.count, center, target)


if __name__ == "__main__":
    main()

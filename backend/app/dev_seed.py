"""Development only: fill the discover feed with fake runners.

    docker compose exec api python -m app.dev_seed             # 30 runners near the newest real user with a location
    docker compose exec api python -m app.dev_seed --count 50
    docker compose exec api python -m app.dev_seed --lat -26.20 --lng 28.04
    docker compose exec api python -m app.dev_seed --clear     # remove every seed runner and their photos
"""

import argparse
import math
import random
import time
import uuid
from datetime import date
from io import BytesIO

from geoalchemy2 import WKTElement
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import delete, select, text

from app.config import get_settings
from app.db import SessionLocal
from app.models import (
    DatingPreferences,
    Match,
    Message,
    Profile,
    ProfilePhoto,
    RunningProfile,
    Swipe,
    User,
    VerificationStatus,
)
from app.realtime import publish_message
from app.security import utcnow
from app.storage import LocalPhotoStorage

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


def seed(count: int, center: tuple[float, float]) -> None:
    storage = LocalPhotoStorage(get_settings().media_dir)
    today = date.today()
    with SessionLocal() as db:
        existing = db.scalars(select(User.phone).where(User.phone.like(f"{SEED_PHONE_PREFIX}%"))).all()
        next_number = len(existing) + 1
        real_user_ids = db.scalars(select(User.id).where(User.phone.not_like(f"{SEED_PHONE_PREFIX}%"))).all()
        for i in range(count):
            gender = random.choices(["woman", "man", "non_binary"], weights=[45, 45, 10])[0]
            name = random.choice(NAMES[gender])
            age = random.randint(21, 45)
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
                interested_in=pick_interested_in(gender),
                age_min=max(18, age - random.randint(4, 8)),
                age_max=min(99, age + random.randint(4, 10)),
                max_distance_km=random.choice([25, 50, 100]),
            )
            db.add(user)
            db.flush()
            for real_user_id in real_user_ids:
                if random.random() < LIKES_REAL_USERS:
                    db.add(Swipe(swiper_id=user.id, target_id=real_user_id, liked=True))
        db.commit()
    print(f"Created {count} seed runners within {RADIUS_KM} km of {center[0]:.2f}, {center[1]:.2f}.")
    print("Some already like you: like them back to see a match.")


def clear() -> None:
    storage = LocalPhotoStorage(get_settings().media_dir)
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


def main() -> None:
    if not get_settings().is_development:
        raise SystemExit("dev_seed only runs with ENVIRONMENT=development.")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--count", type=int, default=30)
    parser.add_argument("--lat", type=float)
    parser.add_argument("--lng", type=float)
    parser.add_argument("--clear", action="store_true", help="remove all seed runners")
    args = parser.parse_args()

    if args.clear:
        clear()
        return
    center = (args.lat, args.lng) if args.lat is not None and args.lng is not None else default_center()
    seed(args.count, center)


if __name__ == "__main__":
    main()

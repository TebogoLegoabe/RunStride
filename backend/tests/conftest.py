import os
import re
from datetime import date
from io import BytesIO
from pathlib import Path

# Point the app at the test database before anything imports app.db
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://runstride:runstride@localhost:5433/runstride_test"
)
# Tests assume production-like defaults, whatever a developer has in backend/.env
# (environment variables take priority over the .env file)
os.environ["REQUIRE_ID_VERIFICATION"] = "true"
os.environ["PERSONA_API_KEY"] = ""
os.environ["PERSONA_INQUIRY_TEMPLATE_ID"] = ""
os.environ["PERSONA_WEBHOOK_SECRET"] = ""

import pytest  # noqa: E402
from PIL import Image  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.sms import get_optional_sms_sender, get_sms_sender  # noqa: E402
from app.storage import LocalPhotoStorage, get_photo_storage  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parent.parent


class FakeSmsSender:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    def send(self, to: str, message: str) -> None:
        self.messages.append((to, message))

    def last_code(self) -> str:
        match = re.search(r"\b(\d{6})\b", self.messages[-1][1])
        assert match, "no code in last SMS"
        return match.group(1)


@pytest.fixture(scope="session", autouse=True)
def migrated_db():
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(config, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    yield
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users, profiles, profile_photos, otp_codes, verification_inquiries, running_profiles, dating_preferences, swipes, matches, messages, blocks, reports, run_dates, trusted_contacts, run_shares, run_check_ins CASCADE"))


@pytest.fixture
def sms() -> FakeSmsSender:
    return FakeSmsSender()


@pytest.fixture
def settings():
    # A copy tests can tweak (e.g. cooldown) without leaking into other tests
    return get_settings().model_copy()


@pytest.fixture
def storage(tmp_path) -> LocalPhotoStorage:
    return LocalPhotoStorage(tmp_path)


@pytest.fixture
def client(sms, settings, storage):
    app.dependency_overrides[get_sms_sender] = lambda: sms
    app.dependency_overrides[get_optional_sms_sender] = lambda: sms
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_photo_storage] = lambda: storage
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def sign_in(client, sms, phone="082 123 4567") -> dict:
    client.post("/auth/otp/send", json={"phone": phone}).raise_for_status()
    res = client.post("/auth/otp/verify", json={"phone": phone, "code": sms.last_code()})
    res.raise_for_status()
    return res.json()


@pytest.fixture
def auth_headers(client, sms) -> dict[str, str]:
    return {"Authorization": f"Bearer {sign_in(client, sms)['token']}"}


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


# --- Building complete, discoverable runners through the real API ---

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
        return {"headers": h, "id": user_id, "phone": phone}

    return make

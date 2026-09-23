import os
import re
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
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.sms import get_sms_sender  # noqa: E402
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
        conn.execute(text("TRUNCATE users, profiles, profile_photos, otp_codes, verification_inquiries, running_profiles, dating_preferences, swipes, matches CASCADE"))


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

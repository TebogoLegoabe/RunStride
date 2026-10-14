import pytest
from sqlalchemy import text

from app.main import app
from app.sa_id import InvalidSaId, id_fingerprint, parse_sa_id
from app.storage import get_id_storage
from tests.conftest import png as make_png, sign_in

PROFILE = {"displayName": "Thandi", "birthDate": "1996-04-12", "bio": None}


def make_id(yymmdd="960412", sequence="5009", citizen="0", legacy="8") -> str:
    """A well-formed SA ID number: the first 12 digits plus the Luhn check digit."""
    body = f"{yymmdd}{sequence}{citizen}{legacy}"
    for check in range(10):
        total = 0
        for i, ch in enumerate(reversed(body + str(check))):
            d = int(ch)
            if i % 2 == 1:
                d = d * 2 - 9 if d * 2 > 9 else d * 2
            total += d
        if total % 10 == 0:
            return body + str(check)
    raise AssertionError


class FakeIdStorage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def save(self, kind: str, data: bytes) -> str:
        key = f"{kind}/{len(self.files)}.jpg"
        self.files[key] = data
        return key

    def link(self, key: str, seconds: int = 600) -> str:
        return f"https://private.example/{key}?signature=x"

    def delete(self, key: str) -> None:
        self.files.pop(key, None)


@pytest.fixture
def ids(client, settings):
    storage = FakeIdStorage()
    settings.id_bucket = "ids"
    settings.id_access_key_id = "k"
    settings.id_secret_access_key = "s"
    app.dependency_overrides[get_id_storage] = lambda: storage
    yield storage
    app.dependency_overrides.pop(get_id_storage, None)


@pytest.fixture
def png():
    return make_png()


@pytest.fixture
def headers(client, auth_headers):
    client.put("/me/profile", json=PROFILE, headers=auth_headers).raise_for_status()
    return auth_headers


def post(client, headers, png, number=None):
    return client.post(
        "/me/id-check",
        data={"id_number": number or make_id()},
        files={"id_photo": ("id.png", png, "image/png"), "selfie": ("me.png", png, "image/png")},
        headers=headers,
    )


def make_admin(client, db):
    admin = sign_in(client, SmsOutbox.sms, phone="083 555 0001")
    db.execute(text("UPDATE users SET is_admin = true WHERE id = :id"), {"id": admin["userId"]})
    db.commit()
    return {"Authorization": f"Bearer {admin['token']}"}


class SmsOutbox:
    sms = None


@pytest.fixture(autouse=True)
def _outbox(sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    settings.otp_max_sends_per_hour = 50
    SmsOutbox.sms = sms


def test_id_number_checks():
    assert parse_sa_id(make_id()).born == (96, 4, 12)
    assert parse_sa_id(make_id()[:6] + " " + make_id()[6:]).number == make_id()  # spaces are fine
    for bad in ("123", make_id()[:12] + str((int(make_id()[12]) + 1) % 10), make_id(yymmdd="961331"), "abcdefghijklm"):
        with pytest.raises(InvalidSaId):
            parse_sa_id(bad)


def test_fingerprint_is_stable_and_not_the_number():
    number = make_id()
    assert id_fingerprint(number) == id_fingerprint(number)
    assert number not in id_fingerprint(number)


def test_not_available_until_the_private_bucket_is_set_up(client, headers, png):
    assert client.get("/me/id-check", headers=headers).json()["available"] is False
    assert post(client, headers, png).status_code == 503


def test_submitting_puts_the_user_in_review(client, headers, ids, png):
    res = post(client, headers, png)

    assert res.status_code == 201
    assert res.json()["status"] == "pending"
    assert len(ids.files) == 2
    assert client.get("/me", headers=headers).json()["verificationStatus"] == "pending"
    assert post(client, headers, png).status_code == 409  # one at a time


def test_a_birth_date_that_does_not_match_is_refused(client, headers, ids, png):
    res = post(client, headers, png, number=make_id(yymmdd="900101"))

    assert res.status_code == 422
    assert "match" in res.json()["detail"]
    assert ids.files == {}


def test_a_made_up_number_is_refused(client, headers, ids, png):
    assert post(client, headers, png, number=make_id()[:12] + str((int(make_id()[12]) + 1) % 10)).status_code == 422


def test_admin_approves_and_the_files_are_deleted(client, db, headers, ids, png):
    post(client, headers, png).raise_for_status()
    admin = make_admin(client, db)

    queue = client.get("/admin/id-checks", headers=admin).json()
    assert len(queue) == 1
    item = queue[0]
    assert item["bornMatches"] is True and item["displayName"] == "Thandi"
    assert item["idNumber"] == make_id()
    assert item["idPhotoUrl"].startswith("https://private.example/ids/")

    assert client.post(f"/admin/id-checks/{item['id']}/approve", headers=admin).status_code == 204

    assert ids.files == {}  # ID photo and selfie are gone
    assert client.get("/me", headers=headers).json()["verificationStatus"] == "verified"
    assert client.get("/me/id-check", headers=headers).json()["status"] == "approved"
    assert client.get("/admin/id-checks", headers=admin).json() == []
    assert db.execute(text("SELECT id_number FROM id_submissions")).scalar() is None  # typed number cleared


def test_rejection_gives_a_reason_and_allows_a_retry(client, db, headers, ids, png):
    post(client, headers, png).raise_for_status()
    admin = make_admin(client, db)
    item = client.get("/admin/id-checks", headers=admin).json()[0]

    client.post(
        f"/admin/id-checks/{item['id']}/reject", json={"reason": "The selfie is blurry"}, headers=admin
    ).raise_for_status()

    state = client.get("/me/id-check", headers=headers).json()
    assert state["status"] == "rejected" and state["rejectReason"] == "The selfie is blurry"
    assert state["attemptsLeft"] == 2
    assert post(client, headers, png).status_code == 201  # may try again


def test_one_id_number_cannot_verify_two_accounts(client, sms, db, headers, ids, png):
    post(client, headers, png).raise_for_status()
    admin = make_admin(client, db)
    item = client.get("/admin/id-checks", headers=admin).json()[0]
    client.post(f"/admin/id-checks/{item['id']}/approve", headers=admin).raise_for_status()

    other = sign_in(client, sms, phone="084 555 0002")
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    client.put("/me/profile", json=PROFILE, headers=other_headers).raise_for_status()

    res = post(client, other_headers, png)
    assert res.status_code == 409
    assert "already linked" in res.json()["detail"]


def test_a_banned_persons_id_cannot_be_used_again(client, sms, db, headers, ids, png):
    post(client, headers, png).raise_for_status()
    db.execute(text("UPDATE users SET account_status = 'banned' WHERE verification_status = 'pending'"))
    db.commit()

    other = sign_in(client, sms, phone="084 555 0002")
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    client.put("/me/profile", json=PROFILE, headers=other_headers).raise_for_status()

    assert post(client, other_headers, png).status_code == 403


def test_only_admins_can_review(client, headers, ids):
    assert client.get("/admin/id-checks", headers=headers).status_code == 403

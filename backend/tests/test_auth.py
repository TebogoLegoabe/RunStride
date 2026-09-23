from datetime import timedelta

from sqlalchemy import select, update

from app.models import OtpCode, User, VerificationStatus
from app.security import utcnow
from tests.conftest import sign_in

PHONE_LOCAL = "082 123 4567"
PHONE_E164 = "+27821234567"


def test_send_normalizes_south_african_number(client, sms):
    res = client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})

    assert res.status_code == 200
    assert res.json() == {"sent": True, "phone": PHONE_E164}
    assert sms.messages[0][0] == PHONE_E164


def test_send_rejects_invalid_number(client, sms):
    res = client.post("/auth/otp/send", json={"phone": "12345"})

    assert res.status_code == 422
    assert res.json()["detail"] == "That doesn't look like a valid phone number."
    assert sms.messages == []


def test_code_is_stored_hashed(client, sms, db):
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})

    stored = db.scalar(select(OtpCode))
    assert sms.last_code() not in stored.code_hash


def test_verify_creates_user_and_returns_token(client, sms, db):
    body = sign_in(client, sms)

    assert body["profileComplete"] is False
    user = db.scalar(select(User))
    assert body["userId"] == str(user.id)
    assert user.phone == PHONE_E164
    assert user.verification_status == VerificationStatus.unverified

    me = client.get("/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json() == {
        "id": str(user.id),
        "phone": PHONE_E164,
        "verificationStatus": "unverified",
        "verificationRequired": True,
        "profileComplete": False,
    }


def test_returning_user_gets_same_account(client, sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    first = sign_in(client, sms)
    second = sign_in(client, sms, phone="+27 82 123 4567")

    assert first["userId"] == second["userId"]


def test_wrong_code_rejected(client, sms):
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})
    wrong = "000000" if sms.last_code() != "000000" else "111111"

    res = client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": wrong})

    assert res.status_code == 400
    assert res.json()["detail"] == "That code is incorrect."


def test_locked_after_max_attempts_even_with_right_code(client, sms, settings):
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})
    code = sms.last_code()
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(settings.otp_max_attempts):
        client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": wrong})

    res = client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": code})

    assert res.status_code == 429


def test_code_is_single_use(client, sms):
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})
    code = sms.last_code()
    client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": code}).raise_for_status()

    res = client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": code})

    assert res.status_code == 400


def test_expired_code_rejected(client, sms, db):
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})
    db.execute(update(OtpCode).values(expires_at=utcnow() - timedelta(seconds=1)))
    db.commit()

    res = client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": sms.last_code()})

    assert res.status_code == 400
    assert "expired" in res.json()["detail"]


def test_new_code_invalidates_previous(client, sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})
    old_code = sms.last_code()
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})
    new_code = sms.last_code()

    if old_code != new_code:
        res = client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": old_code})
        assert res.status_code == 400
    res = client.post("/auth/otp/verify", json={"phone": PHONE_LOCAL, "code": new_code})
    assert res.status_code == 200


def test_resend_cooldown(client, sms):
    client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})

    res = client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})

    assert res.status_code == 429
    assert len(sms.messages) == 1


def test_hourly_send_limit(client, sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    for _ in range(settings.otp_max_sends_per_hour):
        client.post("/auth/otp/send", json={"phone": PHONE_LOCAL}).raise_for_status()

    res = client.post("/auth/otp/send", json={"phone": PHONE_LOCAL})

    assert res.status_code == 429
    assert "Too many codes" in res.json()["detail"]


def test_me_requires_valid_token(client):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401

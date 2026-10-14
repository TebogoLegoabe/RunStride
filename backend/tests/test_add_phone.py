"""Google-only accounts add a phone number; an existing phone account is joined, not duplicated."""
from sqlalchemy import text

from tests.conftest import sign_in
from tests.test_notifications import google, google_sign_in  # noqa: F401 (fixtures)

GOOGLE_TOKEN = "token-thandi-1234567890"


def google_account(client):
    body = google_sign_in(client, GOOGLE_TOKEN).json()
    return body, {"Authorization": f"Bearer {body['token']}"}


def add_phone(client, sms, headers, phone="082 123 4567"):
    client.post("/auth/otp/send", json={"phone": phone}).raise_for_status()
    return client.post("/auth/phone", json={"phone": phone, "code": sms.last_code()}, headers=headers)


def test_a_google_account_can_add_a_new_phone_number(client, sms, settings, google):
    settings.otp_resend_cooldown_seconds = 0
    body, headers = google_account(client)
    assert client.get("/me", headers=headers).json()["phone"] is None

    res = add_phone(client, sms, headers)

    assert res.status_code == 200
    assert res.json()["userId"] == body["userId"]
    assert client.get("/me", headers=headers).json()["phone"] == "+27821234567"


def test_a_number_that_already_has_an_account_is_joined_not_duplicated(client, sms, settings, db, google):
    settings.otp_resend_cooldown_seconds = 0
    phone_account = sign_in(client, sms, phone="082 123 4567")
    _, google_headers = google_account(client)

    res = add_phone(client, sms, google_headers)

    assert res.status_code == 200
    assert res.json()["userId"] == phone_account["userId"]  # the phone account carries on
    assert db.execute(text("SELECT count(*) FROM users")).scalar() == 1
    me = client.get("/me", headers={"Authorization": f"Bearer {res.json()['token']}"}).json()
    assert me["phone"] == "+27821234567" and me["hasGoogle"] is True and me["email"] == "thandi@example.com"
    # Google now signs into the same account
    assert google_sign_in(client, GOOGLE_TOKEN).json()["userId"] == phone_account["userId"]


def test_a_number_linked_to_a_different_google_account_is_refused(client, sms, settings, db, google):
    settings.otp_resend_cooldown_seconds = 0
    owner = sign_in(client, sms, phone="082 123 4567")
    db.execute(text("UPDATE users SET google_sub = 'someone-else' WHERE id = :id"), {"id": owner["userId"]})
    db.commit()
    _, google_headers = google_account(client)

    assert add_phone(client, sms, google_headers).status_code == 409


def test_a_wrong_code_does_not_add_the_number(client, sms, settings, google):
    settings.otp_resend_cooldown_seconds = 0
    _, headers = google_account(client)
    client.post("/auth/otp/send", json={"phone": "082 123 4567"}).raise_for_status()
    res = client.post("/auth/phone", json={"phone": "082 123 4567", "code": "000000"}, headers=headers)
    assert res.status_code == 400
    assert client.get("/me", headers=headers).json()["phone"] is None


def test_an_account_with_a_phone_cannot_add_another(client, sms, settings):
    settings.otp_resend_cooldown_seconds = 0
    first = sign_in(client, sms, phone="082 123 4567")
    headers = {"Authorization": f"Bearer {first['token']}"}
    assert add_phone(client, sms, headers, phone="083 555 0000").status_code == 409

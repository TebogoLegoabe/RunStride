from sqlalchemy import text

from tests.conftest import sign_in

PHONE = "082 123 4567"


def test_a_remembered_phone_signs_back_in_without_a_text(client, sms):
    first = sign_in(client, sms)
    assert first["deviceToken"]

    again = client.post("/auth/device", json={"phone": PHONE, "deviceToken": first["deviceToken"]})

    assert again.status_code == 200
    assert again.json()["userId"] == first["userId"]
    assert again.json()["deviceToken"] != first["deviceToken"]  # single use, replaced each time


def test_a_device_token_works_only_once(client, sms):
    first = sign_in(client, sms)
    body = {"phone": PHONE, "deviceToken": first["deviceToken"]}
    assert client.post("/auth/device", json=body).status_code == 200
    assert client.post("/auth/device", json=body).status_code == 401


def test_a_device_token_does_not_work_for_another_number(client, sms):
    first = sign_in(client, sms)
    other = client.post("/auth/device", json={"phone": "083 555 0000", "deviceToken": first["deviceToken"]})
    assert other.status_code == 401


def test_an_expired_device_token_is_refused(client, sms, db):
    first = sign_in(client, sms)
    db.execute(text("UPDATE trusted_devices SET expires_at = now() - interval '1 day'"))
    db.commit()
    res = client.post("/auth/device", json={"phone": PHONE, "deviceToken": first["deviceToken"]})
    assert res.status_code == 401

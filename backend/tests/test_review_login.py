import pytest

REVIEW_PHONE = "061 000 0001"


@pytest.fixture
def review(settings):
    settings.review_phone = REVIEW_PHONE
    settings.review_code = "246810"
    return settings


def test_review_number_signs_in_with_fixed_code_and_no_sms(client, sms, review):
    res = client.post("/auth/otp/send", json={"phone": REVIEW_PHONE})
    assert res.status_code == 200
    assert sms.messages == []

    res = client.post("/auth/otp/verify", json={"phone": REVIEW_PHONE, "code": "246810"})
    assert res.status_code == 200
    assert res.json()["token"]


def test_review_number_skips_send_limits(client, sms, review):
    for _ in range(review.otp_max_sends_per_hour + 2):
        assert client.post("/auth/otp/send", json={"phone": REVIEW_PHONE}).status_code == 200


def test_review_number_rejects_wrong_code(client, sms, review):
    client.post("/auth/otp/send", json={"phone": REVIEW_PHONE})
    res = client.post("/auth/otp/verify", json={"phone": REVIEW_PHONE, "code": "000000"})
    assert res.status_code != 200


def test_other_numbers_still_get_a_text(client, sms, review):
    client.post("/auth/otp/send", json={"phone": "082 123 4567"})
    assert len(sms.messages) == 1


def test_off_when_not_configured(client, sms):
    client.post("/auth/otp/send", json={"phone": REVIEW_PHONE})
    assert len(sms.messages) == 1

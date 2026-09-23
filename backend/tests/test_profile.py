from datetime import date
from io import BytesIO

import pytest
from PIL import Image

from app.config import get_settings
from app.main import app
from app.storage import LocalPhotoStorage, get_photo_storage
from tests.conftest import sign_in

PROFILE = {"displayName": "Thandi", "birthDate": "1996-04-12", "bio": "Parkrun every Saturday"}


def make_image(fmt="PNG", size=(40, 30), exif=None) -> bytes:
    out = BytesIO()
    kwargs = {"exif": exif} if exif is not None else {}
    Image.new("RGB", size, "teal").save(out, fmt, **kwargs)
    return out.getvalue()


def upload(client, headers, data=None, filename="photo.png"):
    return client.post(
        "/me/photos", headers=headers, files={"file": (filename, data or make_image(), "image/png")}
    )


@pytest.fixture
def profile_headers(client, auth_headers):
    client.put("/me/profile", json=PROFILE, headers=auth_headers).raise_for_status()
    return auth_headers


def test_profile_404_before_creation(client, auth_headers):
    assert client.get("/me/profile", headers=auth_headers).status_code == 404


def test_create_and_update_profile(client, auth_headers):
    res = client.put("/me/profile", json=PROFILE, headers=auth_headers)

    assert res.status_code == 200
    body = res.json()
    assert body["displayName"] == "Thandi"
    assert body["birthDate"] == "1996-04-12"
    assert body["age"] >= 30
    assert body["photos"] == []

    res = client.put(
        "/me/profile", json={**PROFILE, "displayName": "  Thandi M  ", "bio": "   "}, headers=auth_headers
    )
    assert res.json()["displayName"] == "Thandi M"
    assert res.json()["bio"] is None
    assert client.get("/me/profile", headers=auth_headers).json()["displayName"] == "Thandi M"


def test_under_18_rejected_with_readable_message(client, auth_headers):
    today = date.today()
    seventeen = today.replace(year=today.year - 17).isoformat()

    res = client.put("/me/profile", json={**PROFILE, "birthDate": seventeen}, headers=auth_headers)

    assert res.status_code == 422
    assert res.json()["detail"] == "You must be 18 or older to use RunStride."


def test_blank_name_rejected(client, auth_headers):
    res = client.put("/me/profile", json={**PROFILE, "displayName": "   "}, headers=auth_headers)

    assert res.status_code == 422
    assert res.json()["detail"] == "Please enter your name."


def test_profile_requires_auth(client):
    assert client.put("/me/profile", json=PROFILE).status_code == 401


def test_photo_requires_profile(client, auth_headers):
    assert upload(client, auth_headers).status_code == 409


def test_upload_converts_to_jpeg_and_strips_metadata(client, profile_headers, storage):
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # camera make; stands in for GPS and other metadata
    res = upload(client, profile_headers, data=make_image("JPEG", exif=exif), filename="p.jpg")

    assert res.status_code == 201
    body = res.json()
    assert body["position"] == 0
    assert body["url"].startswith("/media/photos/")

    stored = Image.open(storage.root / body["url"].removeprefix("/media/"))
    assert stored.format == "JPEG"
    assert len(stored.getexif()) == 0


def test_large_photo_is_downscaled(client, profile_headers, storage):
    res = upload(client, profile_headers, data=make_image(size=(4000, 3000)))

    stored = Image.open(storage.root / res.json()["url"].removeprefix("/media/"))
    assert max(stored.size) == 1600


def test_non_image_rejected(client, profile_headers):
    res = upload(client, profile_headers, data=b"definitely not an image", filename="x.png")

    assert res.status_code == 422
    assert "supported photo" in res.json()["detail"]


def test_oversized_upload_rejected(client, profile_headers, settings):
    settings.max_photo_bytes = 10

    assert upload(client, profile_headers).status_code == 413


def test_photo_limit(client, profile_headers, settings):
    settings.max_photos = 2
    upload(client, profile_headers).raise_for_status()
    upload(client, profile_headers).raise_for_status()

    res = upload(client, profile_headers)

    assert res.status_code == 409


def test_profile_complete_needs_a_photo(client, profile_headers):
    assert client.get("/me", headers=profile_headers).json()["profileComplete"] is False

    upload(client, profile_headers).raise_for_status()

    assert client.get("/me", headers=profile_headers).json()["profileComplete"] is True


def test_delete_photo_renumbers_and_removes_file(client, profile_headers, storage):
    ids = [upload(client, profile_headers).json()["id"] for _ in range(3)]
    first_file = storage.root / client.get("/me/profile", headers=profile_headers).json()["photos"][0][
        "url"
    ].removeprefix("/media/")

    res = client.delete(f"/me/photos/{ids[0]}", headers=profile_headers)

    assert res.status_code == 204
    photos = client.get("/me/profile", headers=profile_headers).json()["photos"]
    assert [p["id"] for p in photos] == ids[1:]
    assert [p["position"] for p in photos] == [0, 1]
    assert not first_file.exists()


def test_cannot_delete_someone_elses_photo(client, sms, settings, profile_headers):
    photo_id = upload(client, profile_headers).json()["id"]
    settings.otp_resend_cooldown_seconds = 0
    other = sign_in(client, sms, phone="083 555 0000")
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    client.put("/me/profile", json=PROFILE, headers=other_headers).raise_for_status()

    res = client.delete(f"/me/photos/{photo_id}", headers=other_headers)

    assert res.status_code == 404
    assert len(client.get("/me/profile", headers=profile_headers).json()["photos"]) == 1


def test_uploaded_photo_is_served(client, profile_headers):
    # The /media mount serves the real media dir, so upload through real storage here
    real_storage = LocalPhotoStorage(get_settings().media_dir)
    app.dependency_overrides[get_photo_storage] = lambda: real_storage
    url = upload(client, profile_headers).json()["url"]
    try:
        res = client.get(url)

        assert res.status_code == 200
        assert res.headers["content-type"] == "image/jpeg"
    finally:
        real_storage.delete(url)

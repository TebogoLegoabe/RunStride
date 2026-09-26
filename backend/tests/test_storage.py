from io import BytesIO

import boto3
import pytest
from moto import mock_aws
from PIL import Image

from app import storage as storage_module
from app.config import Settings
from app.main import app
from app.storage import IMMUTABLE_CACHE, LocalPhotoStorage, S3PhotoStorage, get_photo_storage

BUCKET = "runstride-photos"
PUBLIC = "https://photos.example.com"


@pytest.fixture
def s3():
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        yield client


@pytest.fixture
def s3_storage(s3) -> S3PhotoStorage:
    return S3PhotoStorage(s3, BUCKET, PUBLIC + "/")


def test_save_uploads_a_cacheable_jpeg(s3, s3_storage):
    url = s3_storage.save(b"jpeg bytes")

    assert url.startswith(f"{PUBLIC}/photos/") and url.endswith(".jpg")
    obj = s3.get_object(Bucket=BUCKET, Key=url.removeprefix(f"{PUBLIC}/"))
    assert obj["Body"].read() == b"jpeg bytes"
    assert obj["ContentType"] == "image/jpeg"
    assert obj["CacheControl"] == IMMUTABLE_CACHE


def test_each_photo_gets_its_own_unguessable_name(s3_storage):
    assert s3_storage.save(b"a") != s3_storage.save(b"a")


def test_delete_removes_the_object(s3, s3_storage):
    url = s3_storage.save(b"x")

    s3_storage.delete(url)

    assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0


def test_delete_ignores_urls_it_does_not_own(s3, s3_storage):
    s3_storage.save(b"x")

    s3_storage.delete("/media/photos/old-local-photo.jpg")
    s3_storage.delete("https://elsewhere.example.com/photos/x.jpg")

    assert s3.list_objects_v2(Bucket=BUCKET)["KeyCount"] == 1


def test_profile_photos_upload_to_s3(client, profile_headers_factory, s3, s3_storage):
    app.dependency_overrides[get_photo_storage] = lambda: s3_storage
    headers = profile_headers_factory()
    out = BytesIO()
    Image.new("RGB", (40, 30), "teal").save(out, "PNG")

    res = client.post("/me/photos", headers=headers, files={"file": ("p.png", out.getvalue(), "image/png")})

    assert res.status_code == 201
    url = res.json()["url"]
    assert url.startswith(f"{PUBLIC}/photos/")
    assert s3.list_objects_v2(Bucket=BUCKET)["KeyCount"] == 1

    client.delete(f"/me/photos/{res.json()['id']}", headers=headers).raise_for_status()
    assert s3.list_objects_v2(Bucket=BUCKET)["KeyCount"] == 0


@pytest.fixture
def profile_headers_factory(client, auth_headers):
    def make():
        client.put(
            "/me/profile", json={"displayName": "Thandi", "birthDate": "1996-04-12"}, headers=auth_headers
        ).raise_for_status()
        return auth_headers

    return make


# --- Choosing storage ---


def test_s3_selected_by_setting(monkeypatch):
    monkeypatch.setattr(
        storage_module,
        "get_settings",
        lambda: Settings(
            photo_storage="s3",
            s3_bucket=BUCKET,
            s3_public_base_url=PUBLIC,
            s3_endpoint_url="https://account.r2.cloudflarestorage.com",
            s3_access_key_id="key",
            s3_secret_access_key="secret",
        ),
    )

    storage = get_photo_storage()

    assert isinstance(storage, S3PhotoStorage)
    assert storage.client.meta.endpoint_url == "https://account.r2.cloudflarestorage.com"


def test_s3_without_bucket_refuses(monkeypatch):
    monkeypatch.setattr(storage_module, "get_settings", lambda: Settings(photo_storage="s3"))

    with pytest.raises(RuntimeError, match="S3_BUCKET"):
        get_photo_storage()


def test_local_storage_is_development_only(monkeypatch):
    monkeypatch.setattr(
        storage_module, "get_settings", lambda: Settings(environment="production", secret_key="x" * 40)
    )

    with pytest.raises(RuntimeError, match="development only"):
        get_photo_storage()


def test_local_storage_in_development(monkeypatch, tmp_path):
    monkeypatch.setattr(storage_module, "get_settings", lambda: Settings(media_dir=str(tmp_path)))

    assert isinstance(get_photo_storage(), LocalPhotoStorage)

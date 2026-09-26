import uuid
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import boto3
from botocore.config import Config

from app.config import get_settings

MEDIA_URL_PREFIX = "/media"
# Photo files never change once written (edits upload a new file), so browsers and CDNs can keep them
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


class PhotoStorage(Protocol):
    def save(self, data: bytes) -> str:
        """Store a JPEG and return the URL it can be fetched from."""
        ...

    def delete(self, url: str) -> None: ...


def _new_key() -> str:
    # Random, unguessable names: a photo's URL is the only way to find it
    return f"photos/{uuid.uuid4()}.jpg"


class LocalPhotoStorage:
    """Development storage: files on disk, served by the API under /media.

    Returns relative URLs (/media/photos/...) so the same record works whether the
    app reaches the API on localhost or the LAN IP.
    """

    def __init__(self, media_dir: str | Path) -> None:
        self.root = Path(media_dir)

    def save(self, data: bytes) -> str:
        name = _new_key()
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return f"{MEDIA_URL_PREFIX}/{name}"

    def delete(self, url: str) -> None:
        if not url.startswith(f"{MEDIA_URL_PREFIX}/"):
            return
        path = (self.root / url.removeprefix(f"{MEDIA_URL_PREFIX}/")).resolve()
        if path.is_relative_to(self.root.resolve()):
            path.unlink(missing_ok=True)


@lru_cache
def _s3_client(endpoint_url: str, region: str, access_key_id: str, secret_access_key: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url or None,
        region_name=region,
        aws_access_key_id=access_key_id or None,
        aws_secret_access_key=secret_access_key or None,
        config=Config(
            signature_version="s3v4",
            # Newer boto3 adds checksum headers by default, which some S3-compatible
            # services (R2, MinIO) have rejected. Only send them when an API requires it.
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


class S3PhotoStorage:
    """Any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO.

    The bucket must be publicly readable (e.g. an R2 custom domain or r2.dev URL);
    photo URLs are unguessable, and nothing else is stored there.
    """

    def __init__(self, client, bucket: str, public_base_url: str) -> None:
        self.client = client
        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/")

    def save(self, data: bytes) -> str:
        key = _new_key()
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType="image/jpeg",
            CacheControl=IMMUTABLE_CACHE,
        )
        return f"{self.public_base_url}/{key}"

    def delete(self, url: str) -> None:
        prefix = f"{self.public_base_url}/"
        if not url.startswith(prefix):
            return  # not ours (e.g. an old local /media URL)
        self.client.delete_object(Bucket=self.bucket, Key=url.removeprefix(prefix))


def get_photo_storage() -> PhotoStorage:
    settings = get_settings()
    if settings.photo_storage == "s3":
        if not (settings.s3_bucket and settings.s3_public_base_url):
            raise RuntimeError("PHOTO_STORAGE=s3 needs S3_BUCKET and S3_PUBLIC_BASE_URL")
        client = _s3_client(
            settings.s3_endpoint_url, settings.s3_region, settings.s3_access_key_id, settings.s3_secret_access_key
        )
        return S3PhotoStorage(client, settings.s3_bucket, settings.s3_public_base_url)
    if not settings.is_development:
        raise RuntimeError("Local photo storage is for development only: set PHOTO_STORAGE=s3")
    return LocalPhotoStorage(settings.media_dir)

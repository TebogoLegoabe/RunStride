import uuid
from pathlib import Path
from typing import Protocol

from app.config import get_settings

MEDIA_URL_PREFIX = "/media"


class PhotoStorage(Protocol):
    def save(self, data: bytes) -> str:
        """Store a JPEG and return the URL it can be fetched from."""
        ...

    def delete(self, url: str) -> None: ...


class LocalPhotoStorage:
    """Development storage: files on disk, served by the API under /media.

    Returns relative URLs (/media/photos/...) so the same record works whether the
    app reaches the API on localhost or the LAN IP.
    """

    def __init__(self, media_dir: str | Path) -> None:
        self.root = Path(media_dir)

    def save(self, data: bytes) -> str:
        name = f"photos/{uuid.uuid4()}.jpg"
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


def get_photo_storage() -> PhotoStorage:
    return LocalPhotoStorage(get_settings().media_dir)

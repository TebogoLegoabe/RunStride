import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status

from app.deps import AppSettings, CurrentUser, DbSession
from app.images import InvalidImage, process_photo
from app.models import Profile, ProfilePhoto
from app.schemas import PhotoResponse, ProfileResponse, ProfileUpsertRequest, age_on
from app.storage import PhotoStorage, get_photo_storage

router = APIRouter(prefix="/me", tags=["profile"])

Storage = Annotated[PhotoStorage, Depends(get_photo_storage)]


def _to_response(profile: Profile) -> ProfileResponse:
    return ProfileResponse(
        display_name=profile.display_name,
        birth_date=profile.birth_date,
        age=age_on(profile.birth_date, date.today()),
        bio=profile.bio,
        photos=[PhotoResponse(id=p.id, url=p.url, position=p.position) for p in profile.photos],
    )


@router.get("/profile", response_model=ProfileResponse)
def get_profile(user: CurrentUser) -> ProfileResponse:
    if user.profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile yet.")
    return _to_response(user.profile)


@router.put("/profile", response_model=ProfileResponse)
def upsert_profile(body: ProfileUpsertRequest, user: CurrentUser, db: DbSession) -> ProfileResponse:
    profile = user.profile
    if profile is None:
        profile = Profile(user_id=user.id)
        user.profile = profile
    profile.display_name = body.display_name
    profile.birth_date = body.birth_date
    profile.bio = body.bio
    db.commit()
    return _to_response(profile)


@router.post("/photos", response_model=PhotoResponse, status_code=status.HTTP_201_CREATED)
def upload_photo(
    file: UploadFile, user: CurrentUser, db: DbSession, settings: AppSettings, storage: Storage
) -> PhotoResponse:
    profile = user.profile
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Create your profile before adding photos."
        )
    if len(profile.photos) >= settings.max_photos:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You can have up to {settings.max_photos} photos.",
        )

    raw = file.file.read(settings.max_photo_bytes + 1)
    if len(raw) > settings.max_photo_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Photos must be under {settings.max_photo_bytes // (1024 * 1024)} MB.",
        )
    try:
        jpeg = process_photo(raw)
    except InvalidImage:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That file isn't a supported photo. Please use a JPEG, PNG or WebP image.",
        )

    url = storage.save(jpeg)
    photo = ProfilePhoto(url=url, position=max((p.position for p in profile.photos), default=-1) + 1)
    profile.photos.append(photo)
    try:
        db.commit()
    except Exception:
        storage.delete(url)
        raise
    return PhotoResponse(id=photo.id, url=photo.url, position=photo.position)


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: uuid.UUID, user: CurrentUser, db: DbSession, storage: Storage) -> Response:
    profile = user.profile
    photo = next((p for p in profile.photos if p.id == photo_id), None) if profile else None
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")

    profile.photos.remove(photo)
    db.flush()
    # Close the gap one row at a time, lowest first, so (user_id, position) stays unique at every step
    for index, remaining in enumerate(sorted(profile.photos, key=lambda p: p.position)):
        if remaining.position != index:
            remaining.position = index
            db.flush()
    db.commit()

    storage.delete(photo.url)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

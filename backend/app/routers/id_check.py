"""Optional ID check for the verified badge: ID number + ID photo + selfie, reviewed by an admin."""
import logging
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select

from app.deps import AdminUser, AppSettings, CurrentUser, DbSession
from app.images import InvalidImage, process_photo
from app.models import AccountStatus, IdSubmission, Profile, User, VerificationStatus
from app.sa_id import InvalidSaId, id_fingerprint, matches_birth_date, parse_sa_id
from app.schemas import IdCheckState, IdRejectBody, IdReview, age_on
from app.security import utcnow
from app.storage import IdStorage, get_id_storage

router = APIRouter(tags=["id-check"])
logger = logging.getLogger("runstride.id_check")

Storage = Annotated[IdStorage | None, Depends(get_id_storage)]


def _latest(db, user: User) -> IdSubmission | None:
    return db.scalar(
        select(IdSubmission).where(IdSubmission.user_id == user.id).order_by(IdSubmission.created_at.desc()).limit(1)
    )


def _attempts_left(db, user: User, settings) -> int:
    used = db.scalar(
        select(func.count()).select_from(IdSubmission).where(IdSubmission.user_id == user.id, IdSubmission.status == "rejected")
    )
    return max(settings.max_verification_attempts - used, 0)


@router.get("/me/id-check", response_model=IdCheckState)
def id_check_state(user: CurrentUser, db: DbSession, settings: AppSettings) -> IdCheckState:
    latest = _latest(db, user)
    if user.verification_status == VerificationStatus.verified:
        state = "approved"
    elif latest is None:
        state = "none"
    else:
        state = latest.status
    return IdCheckState(
        available=settings.id_check_enabled,
        status=state,
        reject_reason=latest.reject_reason if latest and latest.status == "rejected" else None,
        attempts_left=_attempts_left(db, user, settings),
    )


def _photo(storage: IdStorage, upload: UploadFile, kind: str, settings) -> str:
    raw = upload.file.read(settings.max_photo_bytes + 1)
    if len(raw) > settings.max_photo_bytes:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "That photo is too large.")
    try:
        jpeg = process_photo(raw)  # re-encoded: no location or camera details are kept
    except InvalidImage:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That file isn't a supported photo.") from None
    return storage.save(kind, jpeg)


@router.post("/me/id-check", response_model=IdCheckState, status_code=status.HTTP_201_CREATED)
def submit_id_check(
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    storage: Storage,
    id_number: Annotated[str, Form(max_length=40)],
    id_photo: UploadFile,
    selfie: UploadFile,
) -> IdCheckState:
    if storage is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "ID checks aren't available yet.")
    profile: Profile | None = user.profile
    if profile is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Finish your profile first.")
    if user.verification_status == VerificationStatus.verified:
        raise HTTPException(status.HTTP_409_CONFLICT, "You're already verified.")
    latest = _latest(db, user)
    if latest is not None and latest.status == "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "Your ID is already being checked.")
    if _attempts_left(db, user, settings) <= 0:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please contact support.")

    try:
        sa_id = parse_sa_id(id_number)
    except InvalidSaId as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    if not matches_birth_date(sa_id, profile.birth_date):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The birth date in that ID number doesn't match your profile."
        )
    if age_on(profile.birth_date, date.today()) < 18:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "You must be 18 or older.")

    fingerprint = id_fingerprint(sa_id.number)
    others = db.scalars(select(IdSubmission).where(IdSubmission.id_hash == fingerprint, IdSubmission.user_id != user.id)).all()
    for other in others:
        owner = db.get(User, other.user_id)
        if other.status == "approved":
            raise HTTPException(status.HTTP_409_CONFLICT, "This ID number is already linked to another account.")
        if owner is not None and owner.account_status == AccountStatus.banned:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "We can't verify this ID.")

    id_key = _photo(storage, id_photo, "ids", settings)
    try:
        selfie_key = _photo(storage, selfie, "selfies", settings)
    except Exception:
        storage.delete(id_key)
        raise
    db.add(
        IdSubmission(
            user_id=user.id,
            id_hash=fingerprint,
            id_number=sa_id.number,
            id_photo_key=id_key,
            selfie_key=selfie_key,
        )
    )
    user.verification_status = VerificationStatus.pending
    db.commit()
    return id_check_state(user, db, settings)


# --- Admin review ---


def _delete_files(storage: IdStorage | None, submission: IdSubmission) -> None:
    for key in (submission.id_photo_key, submission.selfie_key):
        if key and storage is not None:
            try:
                storage.delete(key)
            except Exception:
                logger.exception("Could not delete ID file %s", key)
    submission.id_photo_key = None
    submission.selfie_key = None
    submission.id_number = None


def purge_user_files(db, user: User, storage: IdStorage | None) -> None:
    """Account deletion: remove any ID files still waiting for review."""
    for submission in db.scalars(select(IdSubmission).where(IdSubmission.user_id == user.id)):
        _delete_files(storage, submission)


@router.get("/admin/id-checks", response_model=list[IdReview])
def pending_id_checks(admin: AdminUser, db: DbSession, storage: Storage) -> list[IdReview]:
    if storage is None:
        return []
    rows = db.scalars(
        select(IdSubmission).where(IdSubmission.status == "pending").order_by(IdSubmission.created_at).limit(50)
    ).all()
    out = []
    for sub in rows:
        profile = db.get(Profile, sub.user_id)
        if profile is None:
            continue
        sa_id = None
        try:
            sa_id = parse_sa_id(sub.id_number or "")
        except InvalidSaId:
            pass
        out.append(
            IdReview(
                id=sub.id,
                user_id=sub.user_id,
                display_name=profile.display_name,
                age=age_on(profile.birth_date, date.today()),
                birth_date=profile.birth_date,
                id_number=sub.id_number,
                born_matches=bool(sa_id and matches_birth_date(sa_id, profile.birth_date)),
                id_photo_url=storage.link(sub.id_photo_key) if sub.id_photo_key else None,
                selfie_url=storage.link(sub.selfie_key) if sub.selfie_key else None,
                profile_photos=[p.url for p in profile.photos],
                submitted_at=sub.created_at,
            )
        )
    return out


def _decide(db, storage: IdStorage | None, submission_id, approve: bool, reason: str | None) -> None:
    sub = db.get(IdSubmission, submission_id, with_for_update=True)
    if sub is None or sub.status != "pending":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That check was already decided.")
    user = db.get(User, sub.user_id)
    sub.status = "approved" if approve else "rejected"
    sub.reject_reason = None if approve else reason
    sub.reviewed_at = utcnow()
    _delete_files(storage, sub)
    if user is not None:
        user.verification_status = VerificationStatus.verified if approve else VerificationStatus.rejected
    db.commit()


@router.post("/admin/id-checks/{submission_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
def approve_id_check(submission_id: str, admin: AdminUser, db: DbSession, storage: Storage) -> Response:
    _decide(db, storage, submission_id, True, None)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/id-checks/{submission_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_id_check(
    submission_id: str, body: IdRejectBody, admin: AdminUser, db: DbSession, storage: Storage
) -> Response:
    _decide(db, storage, submission_id, False, body.reason)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.deps import AppSettings, CurrentUser, DbSession
from app.google_auth import GoogleVerifier, get_google_verifier
from app.models import User
from app.routers.auth import verified_google_identity
from app.schemas import GoogleAuthBody, MeResponse

router = APIRouter(tags=["users"])


@router.get("/me", response_model=MeResponse)
def get_me(user: CurrentUser, settings: AppSettings) -> MeResponse:
    return _me(user, settings)


def _me(user: User, settings) -> MeResponse:
    return MeResponse(
        id=user.id,
        phone=user.phone,
        email=user.email,
        has_google=user.google_sub is not None,
        verification_status=user.verification_status,
        verification_required=settings.require_id_verification,
        id_check_available=settings.id_check_enabled,
        verification_available=bool(settings.persona_api_key and settings.persona_inquiry_template_id),
        profile_complete=user.profile_complete,
        has_running_profile=user.running_profile is not None,
        has_dating_preferences=user.dating_preferences is not None,
        has_location=user.location is not None,
        is_admin=user.is_admin,
    )


@router.post("/me/google", response_model=MeResponse)
def connect_google(
    body: GoogleAuthBody,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    verifier: Annotated[GoogleVerifier, Depends(get_google_verifier)],
) -> MeResponse:
    """Connect a Google account, so you can sign in with either your number or Google."""
    identity = verified_google_identity(body, settings, verifier)
    owner = db.scalar(select(User).where(User.google_sub == identity.sub))
    if owner is not None and owner.id != user.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="That Google account is already used by another RunStride account."
        )
    user.google_sub = identity.sub
    user.email = identity.email
    db.commit()
    return _me(user, settings)


@router.delete("/me/google", response_model=MeResponse)
def disconnect_google(user: CurrentUser, db: DbSession, settings: AppSettings) -> MeResponse:
    if user.phone is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Google is how you sign in, so it can't be disconnected."
        )
    user.google_sub = None
    user.email = None
    db.commit()
    return _me(user, settings)


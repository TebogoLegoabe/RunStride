from fastapi import APIRouter

from app.deps import AppSettings, CurrentUser
from app.schemas import MeResponse

router = APIRouter(tags=["users"])


@router.get("/me", response_model=MeResponse)
def get_me(user: CurrentUser, settings: AppSettings) -> MeResponse:
    return MeResponse(
        id=user.id,
        phone=user.phone,
        verification_status=user.verification_status,
        verification_required=settings.require_id_verification,
        profile_complete=user.profile_complete,
    )

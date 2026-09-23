from fastapi import APIRouter

from app.deps import CurrentUser
from app.schemas import MeResponse

router = APIRouter(tags=["users"])


@router.get("/me", response_model=MeResponse)
def get_me(user: CurrentUser) -> MeResponse:
    return MeResponse(
        id=user.id,
        phone=user.phone,
        verification_status=user.verification_status,
        profile_complete=user.profile_complete,
    )

from fastapi import APIRouter, HTTPException, status

from app.deps import CurrentUser, DbSession
from app.models import DatingPreferences, RunningProfile
from app.schemas import DatingPreferencesBody, RunningProfileBody

router = APIRouter(prefix="/me", tags=["preferences"])


@router.get("/running-profile", response_model=RunningProfileBody)
def get_running_profile(user: CurrentUser) -> RunningProfileBody:
    if user.running_profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No running profile yet.")
    return RunningProfileBody.model_validate(user.running_profile, from_attributes=True)


@router.put("/running-profile", response_model=RunningProfileBody)
def upsert_running_profile(body: RunningProfileBody, user: CurrentUser, db: DbSession) -> RunningProfileBody:
    if user.running_profile is None:
        user.running_profile = RunningProfile(user_id=user.id)
    for field, value in body.model_dump().items():
        setattr(user.running_profile, field, value)
    db.commit()
    return body


@router.get("/dating-preferences", response_model=DatingPreferencesBody)
def get_dating_preferences(user: CurrentUser) -> DatingPreferencesBody:
    if user.dating_preferences is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No dating preferences yet.")
    return DatingPreferencesBody.model_validate(user.dating_preferences, from_attributes=True)


@router.put("/dating-preferences", response_model=DatingPreferencesBody)
def upsert_dating_preferences(
    body: DatingPreferencesBody, user: CurrentUser, db: DbSession
) -> DatingPreferencesBody:
    if user.dating_preferences is None:
        user.dating_preferences = DatingPreferences(user_id=user.id)
    for field, value in body.model_dump().items():
        setattr(user.dating_preferences, field, value)
    db.commit()
    return body

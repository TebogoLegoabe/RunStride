from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.clubs import SEED_CLUBS, club_key
from app.deps import CurrentUser, DbSession
from app.models import DatingPreferences, RunningProfile
from app.schemas import DatingPreferencesBody, RunningProfileBody, SearchDistanceBody

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


@router.get("/clubs/suggest", response_model=list[str])
def suggest_clubs(
    user: CurrentUser, db: DbSession, q: Annotated[str, Query(max_length=60)] = ""
) -> list[str]:
    """Club names to pick from while typing: the clubs other runners here have added, most popular first,
    then a few well-known groups."""
    club = func.unnest(RunningProfile.clubs).label("club")
    names = select(club).subquery()
    stmt = select(func.min(names.c.club), func.count()).group_by(func.lower(names.c.club)).order_by(func.count().desc())
    if q.strip():
        stmt = stmt.where(names.c.club.ilike(f"%{q.strip()}%"))
    found = [name for name, _ in db.execute(stmt.limit(8)).all()]
    keys = {club_key(n) for n in found}
    extra = [s for s in SEED_CLUBS if club_key(s) not in keys and (not q.strip() or q.strip().lower() in s.lower())]
    return (found + extra)[:8]


@router.get("/dating-preferences", response_model=DatingPreferencesBody)
def get_dating_preferences(user: CurrentUser) -> DatingPreferencesBody:
    if user.dating_preferences is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No dating preferences yet.")
    return DatingPreferencesBody.model_validate(user.dating_preferences, from_attributes=True)


@router.put("/search-distance", response_model=DatingPreferencesBody)
def set_search_distance(body: SearchDistanceBody, user: CurrentUser, db: DbSession) -> DatingPreferencesBody:
    """Change only how far away you look for people (the quick control on Discover)."""
    if user.dating_preferences is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Finish your dating preferences first.")
    user.dating_preferences.max_distance_km = body.max_distance_km
    db.commit()
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

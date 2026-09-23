import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from geoalchemy2 import WKTElement
from sqlalchemy import exists, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, aliased, selectinload

from app.config import Settings
from app.deps import AppSettings, CurrentUser, DbSession
from app.matching import RunnerTraits, compatibility
from app.models import (
    DatingPreferences,
    Match,
    Profile,
    ProfilePhoto,
    RunningProfile,
    Swipe,
    User,
    VerificationStatus,
)
from app.schemas import DiscoverCard, LocationBody, MatchSummary, SwipeResponse, age_on
from app.security import utcnow

router = APIRouter(tags=["discover"])

# 2 decimal places is roughly 1.1 km: enough for "5 km away", too coarse to find someone's home
LOCATION_DECIMALS = 2
# Nearest eligible runners considered per feed request, before ranking by compatibility
CANDIDATE_POOL = 200


def _traits(running: RunningProfile) -> RunnerTraits:
    return RunnerTraits(
        pace_seconds_per_km=running.pace_seconds_per_km,
        weekly_km=running.weekly_km,
        terrains=running.terrains,
        goals=running.goals,
        run_times=running.run_times,
    )


def _require_ready(user: User) -> None:
    if not (user.profile_complete and user.running_profile and user.dating_preferences):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Finish setting up your profile first.")
    if user.location is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Share your location to see runners near you.")


def _candidates(
    db: Session,
    me: User,
    settings: Settings,
    *,
    only: uuid.UUID | None = None,
    exclude_swiped: bool = True,
) -> list[tuple[User, float]]:
    """Users who fit my preferences AND whose preferences I fit, nearest first, with distance in metres."""
    prefs = me.dating_preferences
    my_age = age_on(me.profile.birth_date, date.today())
    me_row = aliased(User)
    my_location = select(me_row.location).where(me_row.id == me.id).scalar_subquery()
    their_age = func.extract("year", func.age(func.current_date(), Profile.birth_date))
    distance = func.ST_Distance(User.location, my_location)

    stmt = (
        select(User, distance.label("distance_m"))
        .join(Profile, Profile.user_id == User.id)
        .join(RunningProfile, RunningProfile.user_id == User.id)
        .join(DatingPreferences, DatingPreferences.user_id == User.id)
        .where(
            User.id != me.id,
            User.location.is_not(None),
            exists().where(ProfilePhoto.user_id == User.id),
            # Gender, both ways
            DatingPreferences.gender.in_(prefs.interested_in),
            DatingPreferences.interested_in.any(prefs.gender),
            # Age, both ways
            their_age.between(prefs.age_min, prefs.age_max),
            DatingPreferences.age_min <= my_age,
            DatingPreferences.age_max >= my_age,
            # Within both people's maximum distance
            func.ST_DWithin(
                User.location,
                my_location,
                func.least(DatingPreferences.max_distance_km, prefs.max_distance_km) * 1000,
            ),
            # Don't show people who already passed on me
            ~exists().where(Swipe.swiper_id == User.id, Swipe.target_id == me.id, Swipe.liked.is_(False)),
        )
        .options(selectinload(User.profile).selectinload(Profile.photos), selectinload(User.running_profile))
        .order_by(distance)
        .limit(CANDIDATE_POOL)
    )
    if settings.require_id_verification:
        stmt = stmt.where(User.verification_status == VerificationStatus.verified)
    if exclude_swiped:
        stmt = stmt.where(~exists().where(Swipe.swiper_id == me.id, Swipe.target_id == User.id))
    if only is not None:
        stmt = stmt.where(User.id == only)
    return [(row[0], row[1]) for row in db.execute(stmt).all()]


def _card(user: User, distance_m: float, my_traits: RunnerTraits) -> DiscoverCard:
    running = user.running_profile
    return DiscoverCard(
        user_id=user.id,
        display_name=user.profile.display_name,
        age=age_on(user.profile.birth_date, date.today()),
        bio=user.profile.bio,
        photos=[p.url for p in user.profile.photos],
        distance_km=max(1, round(distance_m / 1000)),
        verified=user.verification_status == VerificationStatus.verified,
        compatibility=compatibility(my_traits, _traits(running)),
        pace_seconds_per_km=running.pace_seconds_per_km,
        weekly_km=running.weekly_km,
        terrains=running.terrains,
        goals=running.goals,
        run_times=running.run_times,
    )


def _match_summary(db: Session, match: Match, me: User) -> MatchSummary:
    other = db.get(User, match.user_b_id if match.user_a_id == me.id else match.user_a_id)
    photos = other.profile.photos if other.profile else []
    return MatchSummary(
        id=match.id,
        user_id=other.id,
        display_name=other.profile.display_name if other.profile else "RunStride runner",
        photo=photos[0].url if photos else None,
        matched_at=match.created_at,
    )


@router.put("/me/location", status_code=status.HTTP_204_NO_CONTENT)
def set_location(body: LocationBody, user: CurrentUser, db: DbSession) -> Response:
    lat = round(body.latitude, LOCATION_DECIMALS)
    lng = round(body.longitude, LOCATION_DECIMALS)
    user.location = WKTElement(f"POINT({lng} {lat})", srid=4326)
    user.location_updated_at = utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/discover", response_model=list[DiscoverCard])
def discover(
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[DiscoverCard]:
    _require_ready(user)
    my_traits = _traits(user.running_profile)
    cards = [_card(u, d, my_traits) for u, d in _candidates(db, user, settings)]
    cards.sort(key=lambda c: (-c.compatibility, c.distance_km))
    return cards[:limit]


def _swipe(db: Session, me: User, settings: Settings, target_id: uuid.UUID, liked: bool) -> SwipeResponse:
    _require_ready(me)
    # You can only like/pass people you're allowed to see
    if not _candidates(db, me, settings, only=target_id, exclude_swiped=False):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This runner is no longer available.")

    a, b = sorted([me.id, target_id])
    # Serialise swipes between this pair, so two simultaneous likes can't both miss the match
    db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"{a}:{b}"))))
    db.execute(
        pg_insert(Swipe).values(swiper_id=me.id, target_id=target_id, liked=liked).on_conflict_do_nothing()
    )

    match = None
    if liked:
        reverse = db.get(Swipe, (target_id, me.id))
        if reverse is not None and reverse.liked:
            db.execute(pg_insert(Match).values(id=uuid.uuid4(), user_a_id=a, user_b_id=b).on_conflict_do_nothing())
            match = db.scalar(select(Match).where(Match.user_a_id == a, Match.user_b_id == b))
    db.commit()

    if match is None:
        return SwipeResponse(matched=False)
    return SwipeResponse(matched=True, match=_match_summary(db, match, me))


@router.post("/discover/{target_id}/like", response_model=SwipeResponse)
def like(target_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings) -> SwipeResponse:
    return _swipe(db, user, settings, target_id, liked=True)


@router.post("/discover/{target_id}/pass", response_model=SwipeResponse)
def pass_(target_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings) -> SwipeResponse:
    return _swipe(db, user, settings, target_id, liked=False)


@router.get("/matches", response_model=list[MatchSummary])
def list_matches(user: CurrentUser, db: DbSession) -> list[MatchSummary]:
    matches = db.scalars(
        select(Match)
        .where(or_(Match.user_a_id == user.id, Match.user_b_id == user.id))
        .order_by(Match.created_at.desc())
    ).all()
    return [_match_summary(db, m, user) for m in matches]

import uuid
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import func, select

from app.deps import AdminUser, DbSession
from app.models import AccountStatus, Race, RaceAttendance, RaceEvent, RaceMessage, Report, User
from app.moderation import end_all_matches, resolve_other_open_reports
from app.realtime import hub
from app.routers.races import race_detail
from app.schemas import RaceBody, RaceDetail, ReportDetail, ReportedPerson, ReportPerson, ReportSummary, ResolveBody
from app.security import utcnow

router = APIRouter(prefix="/admin", tags=["admin"])


def _person(db: DbSession, user_id: uuid.UUID | None) -> ReportPerson:
    user = db.get(User, user_id) if user_id else None
    return ReportPerson(
        id=user_id,
        display_name=user.profile.display_name if user and user.profile else None,
    )


def _reported(db: DbSession, user_id: uuid.UUID | None) -> ReportedPerson:
    user = db.get(User, user_id) if user_id else None

    def count(*conditions) -> int:
        if user_id is None:
            return 0
        return db.scalar(select(func.count()).select_from(Report).where(Report.reported_id == user_id, *conditions))

    return ReportedPerson(
        id=user_id,
        display_name=user.profile.display_name if user and user.profile else None,
        account_status=user.account_status if user else None,
        open_report_count=count(Report.status == "open"),
        total_report_count=count(),
    )


def _summary(db: DbSession, report: Report) -> dict:
    return dict(
        id=report.id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        created_at=report.created_at,
        reporter=_person(db, report.reporter_id),
        reported=_reported(db, report.reported_id),
        resolution=report.resolution,
        resolution_note=report.resolution_note,
        resolved_at=report.resolved_at,
    )


@router.get("/reports", response_model=list[ReportSummary])
def list_reports(
    admin: AdminUser,
    db: DbSession,
    status_filter: Annotated[Literal["open", "resolved"], Query(alias="status")] = "open",
) -> list[ReportSummary]:
    # Open reports oldest-first (first come, first served); resolved newest-first
    order = Report.created_at.asc() if status_filter == "open" else Report.resolved_at.desc()
    reports = db.scalars(select(Report).where(Report.status == status_filter).order_by(order).limit(200)).all()
    return [ReportSummary(**_summary(db, r)) for r in reports]


@router.get("/reports/{report_id}", response_model=ReportDetail)
def get_report(report_id: uuid.UUID, admin: AdminUser, db: DbSession) -> ReportDetail:
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return ReportDetail(**_summary(db, report), evidence=report.evidence)


@router.post("/reports/{report_id}/resolve", response_model=ReportDetail)
def resolve_report(report_id: uuid.UUID, body: ResolveBody, admin: AdminUser, db: DbSession) -> ReportDetail:
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Report not found.")
    if report.status != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This report has already been resolved.")

    reported = db.get(User, report.reported_id) if report.reported_id else None
    if body.action in ("suspend", "ban") and reported is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="The reported account no longer exists.")
    if reported is not None and reported.is_admin and body.action in ("suspend", "ban"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Admins can't be suspended or banned here.")

    now = utcnow()
    if body.action == "suspend":
        reported.account_status = AccountStatus.suspended
        reported.suspended_until = now + timedelta(days=body.suspend_days)
    elif body.action == "ban":
        reported.account_status = AccountStatus.banned
        reported.suspended_until = None
        end_all_matches(db, reported, admin.id)
        # One ban settles every open report about this person
        resolve_other_open_reports(db, reported.id, admin, "ban", f"Banned while reviewing report {report.id}.")

    report.status = "resolved"
    report.resolution = body.action
    report.resolution_note = body.note
    report.resolved_at = now
    report.resolved_by_id = admin.id
    db.commit()
    return ReportDetail(**_summary(db, report), evidence=report.evidence)


# --- Races ---


@router.get("/races", response_model=list[RaceDetail])
def admin_list_races(
    admin: AdminUser,
    db: DbSession,
    status_filter: Annotated[Literal["pending", "published", "rejected"], Query(alias="status")] = "pending",
) -> list[RaceDetail]:
    """Suggestions waiting for review (default), or the published/rejected lists."""
    races = db.scalars(
        select(Race).where(Race.status == status_filter).order_by(Race.starts_on).limit(500)
    ).all()
    return [race_detail(db, r, admin) for r in races]


def _apply_race(db: DbSession, race: Race, body: RaceBody) -> None:
    race.name = body.name.strip()
    race.starts_on = body.starts_on
    race.ends_on = body.ends_on
    race.venue = body.venue.strip()
    race.city = body.city.strip()
    race.province = body.province
    race.official_url = body.official_url
    race.substitution_opens_on = body.substitution_opens_on
    race.substitution_closes_on = body.substitution_closes_on
    race.substitution_url = body.substitution_url

    # Update distances in place where possible, so runners who chose one keep their choice
    existing = {e.id: e for e in race.events}
    keep = []
    for item in body.events:
        event = existing.get(item.id) if item.id else None
        if event is None:
            event = RaceEvent()  # linked to the race through race.events below
        event.label = item.label.strip()
        event.distance_km = item.distance_km
        event.starts_at = item.starts_at
        keep.append(event)
    race.events = keep


@router.post("/races", response_model=RaceDetail, status_code=status.HTTP_201_CREATED)
def admin_create_race(body: RaceBody, admin: AdminUser, db: DbSession) -> RaceDetail:
    race = Race(status="published")
    _apply_race(db, race, body)
    db.add(race)
    db.commit()
    return race_detail(db, race, admin)


@router.put("/races/{race_id}", response_model=RaceDetail)
def admin_update_race(race_id: uuid.UUID, body: RaceBody, admin: AdminUser, db: DbSession) -> RaceDetail:
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Race not found.")
    _apply_race(db, race, body)
    db.commit()
    return race_detail(db, race, admin)


@router.post("/races/{race_id}/approve", response_model=RaceDetail)
def admin_approve_race(race_id: uuid.UUID, admin: AdminUser, db: DbSession) -> RaceDetail:
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Race not found.")
    race.status = "published"
    db.commit()
    return race_detail(db, race, admin)


@router.post("/races/{race_id}/reject", response_model=RaceDetail)
def admin_reject_race(race_id: uuid.UUID, admin: AdminUser, db: DbSession) -> RaceDetail:
    race = db.get(Race, race_id)
    if race is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Race not found.")
    race.status = "rejected"
    db.commit()
    return race_detail(db, race, admin)


@router.delete("/race-messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_remove_race_message(message_id: uuid.UUID, admin: AdminUser, db: DbSession) -> Response:
    """Hide a race chat message from everyone. It's kept, marked removed, for the record."""
    message = db.get(RaceMessage, message_id)
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Message not found.")
    if message.removed_at is None:
        message.removed_at = utcnow()
        message.removed_by_id = admin.id
        db.commit()
        attendees = db.scalars(select(RaceAttendance.user_id).where(RaceAttendance.race_id == message.race_id)).all()
        hub.publish_from_thread(
            attendees,
            {"type": "race_message_removed", "raceId": str(message.race_id), "messageId": str(message.id)},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

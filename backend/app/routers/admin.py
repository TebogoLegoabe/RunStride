import uuid
from datetime import timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, or_, select

from app.config import get_settings
from app.deps import AdminUser, DbSession
from app.membership import end_plus, grant_plus, plus_status
from app.phone import InvalidPhoneNumber, normalize_phone
from app.models import AccountStatus, Entitlement, IdSubmission, Match, Message, OtpCode, Profile, Race, RaceAttendance, RaceEvent, RaceMessage, Report, User
from app.moderation import end_all_matches, resolve_other_open_reports
from app.realtime import hub
from app.routers.races import race_detail
from app.races import SA_TZ
from app.race_import import import_csv
from app.races import set_position
from app.schemas import RaceImportResult, AdminPlusBody, AdminStats, AdminUserRow, DayCount, UserStatusBody, GrantPlusBody, PlusOut, SmsStatus, RaceBody, RaceDetail, ReportDetail, ReportedPerson, ReportPerson, ReportSummary, ResolveBody
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
    response: Response,
    status_filter: Annotated[Literal["open", "resolved"], Query(alias="status")] = "open",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[ReportSummary]:
    # Open reports oldest-first (first come, first served); resolved newest-first
    order = Report.created_at.asc() if status_filter == "open" else Report.resolved_at.desc()
    response.headers["X-Total-Count"] = str(
        db.scalar(select(func.count()).select_from(Report).where(Report.status == status_filter))
    )
    reports = db.scalars(
        select(Report).where(Report.status == status_filter).order_by(order, Report.id).offset(offset).limit(limit)
    ).all()
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
    response: Response,
    status_filter: Annotated[Literal["pending", "published", "rejected"], Query(alias="status")] = "pending",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[RaceDetail]:
    """Suggestions waiting for review (default), or the published/rejected lists."""
    response.headers["X-Total-Count"] = str(
        db.scalar(select(func.count()).select_from(Race).where(Race.status == status_filter))
    )
    races = db.scalars(
        select(Race).where(Race.status == status_filter).order_by(Race.starts_on, Race.id).offset(offset).limit(limit)
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
    set_position(race, body)
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


@router.post("/races/import", response_model=RaceImportResult)
def import_races(file: UploadFile, admin: AdminUser, db: DbSession) -> RaceImportResult:
    """Add or update many races from a CSV file (the same columns as backend/data/races.csv).
    All or nothing: if any row is wrong, nothing is saved and the problems are listed."""
    raw = file.file.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="That file is too large (2 MB at most).")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Save the file as CSV (UTF-8) and try again.")
    counts, errors = import_csv(db, text)
    if errors:
        db.rollback()
        return RaceImportResult(imported=False, errors=errors[:30])
    db.commit()
    return RaceImportResult(imported=True, added=counts["added"], updated=counts["updated"])


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


# --- Plus for beta testers and support ---


def _user_by_phone(db: DbSession, phone: str) -> User:
    try:
        normalized = normalize_phone(phone, get_settings().default_phone_region)
    except InvalidPhoneNumber:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That isn't a valid phone number.")
    user = db.scalar(select(User).where(User.phone == normalized))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No account with that phone number.")
    return user


@router.post("/plus", response_model=PlusOut)
def give_plus(body: GrantPlusBody, admin: AdminUser, db: DbSession) -> PlusOut:
    user = _user_by_phone(db, body.phone)
    grant_plus(db, user, source="admin", duration=timedelta(days=body.days) if body.days else None)
    db.commit()
    active, until, source = plus_status(db, user)
    return PlusOut(active=active, expires_at=until, source=source)


@router.delete("/plus/{phone}", response_model=PlusOut)
def take_plus(phone: str, admin: AdminUser, db: DbSession) -> PlusOut:
    """Ends Plus given by admins. Plus someone bought in a store is left alone."""
    user = _user_by_phone(db, phone)
    end_plus(db, user, source="admin")
    db.commit()
    active, until, source = plus_status(db, user)
    return PlusOut(active=active, expires_at=until, source=source)


# --- SMS budget ---

LOW_CREDITS = 200


@router.get("/sms", response_model=SmsStatus)
def sms_status(admin: AdminUser, db: DbSession) -> SmsStatus:
    """Sign-in codes sent in the last day and the BulkSMS credits left, so a runaway bill or an
    empty balance (nobody could sign in) is noticed before users hit it."""
    from app.sms import BulkSmsSender

    settings = get_settings()
    sent_today = db.scalar(select(func.count()).select_from(OtpCode).where(OtpCode.created_at > utcnow() - timedelta(days=1)))
    credits = None
    if settings.sms_provider == "bulksms":
        credits = BulkSmsSender(
            settings.bulksms_token_id, settings.bulksms_token_secret, settings.bulksms_base_url
        ).credits()
    # Low: under a fixed floor, or under a week at today's pace (each text is 1 to 2.5 credits)
    low = credits is not None and (credits < LOW_CREDITS or credits < sent_today * 7)
    return SmsStatus(
        provider=settings.sms_provider,
        credits_left=credits,
        sent_today=sent_today,
        daily_cap=settings.otp_max_sends_per_day,
        low=low,
    )



# --- Overview and people ---


@router.get("/stats", response_model=AdminStats)
def stats(admin: AdminUser, db: DbSession) -> AdminStats:
    now = utcnow()

    def users_where(*conditions) -> int:
        return db.scalar(select(func.count()).select_from(User).where(*conditions)) or 0

    def seen_since(delta: timedelta) -> int:
        return users_where(User.last_seen_at > now - delta)

    plus_active = db.scalar(
        select(func.count(func.distinct(Entitlement.user_id))).where(
            Entitlement.kind == "plus", or_(Entitlement.expires_at.is_(None), Entitlement.expires_at > now)
        )
    )
    signup_day = func.date(func.timezone("Africa/Johannesburg", User.created_at))
    day_rows = db.execute(
        select(signup_day, func.count()).where(User.created_at > now - timedelta(days=14)).group_by(signup_day)
    ).all()
    by_day = {d: n for d, n in day_rows}
    today = now.astimezone(SA_TZ).date()
    signups = [DayCount(day=today - timedelta(days=i), count=by_day.get(today - timedelta(days=i), 0)) for i in range(13, -1, -1)]
    return AdminStats(
        users_total=users_where(),
        profiles_complete=db.scalar(select(func.count()).select_from(Profile)) or 0,
        new_today=users_where(User.created_at > now - timedelta(days=1)),
        new_week=users_where(User.created_at > now - timedelta(days=7)),
        active_now=seen_since(timedelta(minutes=5)),
        active_day=seen_since(timedelta(hours=24)),
        active_week=seen_since(timedelta(days=7)),
        active_month=seen_since(timedelta(days=30)),
        plus_active=plus_active or 0,
        verified=users_where(User.verification_status == "verified"),
        with_google=users_where(User.google_sub.is_not(None)),
        suspended_or_banned=users_where(User.account_status.in_(["suspended", "banned"])),
        matches_total=db.scalar(select(func.count()).select_from(Match).where(Match.ended_at.is_(None))) or 0,
        messages_day=(db.scalar(select(func.count()).select_from(Message).where(Message.created_at > now - timedelta(hours=24))) or 0)
        + (db.scalar(select(func.count()).select_from(RaceMessage).where(RaceMessage.created_at > now - timedelta(hours=24))) or 0),
        races_published=db.scalar(select(func.count()).select_from(Race).where(Race.status == "published")) or 0,
        pending_races=db.scalar(select(func.count()).select_from(Race).where(Race.status == "pending")) or 0,
        open_reports=db.scalar(select(func.count()).select_from(Report).where(Report.status == "open")) or 0,
        pending_id_checks=db.scalar(select(func.count()).select_from(IdSubmission).where(IdSubmission.status == "pending")) or 0,
        signups_by_day=signups,
    )


def _user_row(db: DbSession, user: User) -> AdminUserRow:
    active, until, source = plus_status(db, user)
    return AdminUserRow(
        id=user.id,
        display_name=user.profile.display_name if user.profile else None,
        phone=user.phone,
        email=user.email,
        created_at=user.created_at,
        last_seen_at=user.last_seen_at,
        account_status=user.account_status,
        verification_status=getattr(user.verification_status, "value", user.verification_status),
        plus_active=active,
        plus_source=source,
        plus_until=until,
        has_google=user.google_sub is not None,
        profile_complete=user.profile_complete,
        is_admin=user.is_admin,
    )


@router.get("/users", response_model=list[AdminUserRow])
def list_users(
    admin: AdminUser,
    db: DbSession,
    response: Response,
    q: Annotated[str | None, Query(max_length=80)] = None,
    sort: Annotated[Literal["newest", "active"], Query()] = "newest",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[AdminUserRow]:
    """People, newest first (or most recently active). `q` matches name, email or phone digits."""
    stmt = select(User).outerjoin(Profile, Profile.user_id == User.id)
    if q:
        like = f"%{q.strip()}%"
        digits = "".join(ch for ch in q if ch.isdigit())
        conditions = [Profile.display_name.ilike(like), User.email.ilike(like)]
        if len(digits) >= 3:
            conditions.append(User.phone.ilike(f"%{digits.lstrip('0')}%"))
        stmt = stmt.where(or_(*conditions))
    response.headers["X-Total-Count"] = str(db.scalar(select(func.count()).select_from(stmt.subquery())))
    order = User.last_seen_at.desc().nulls_last() if sort == "active" else User.created_at.desc()
    users = db.scalars(stmt.order_by(order, User.id).offset(offset).limit(limit)).all()
    return [_user_row(db, u) for u in users]


def _target(db: DbSession, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such account.")
    return user


@router.post("/users/{user_id}/status", response_model=AdminUserRow)
def set_user_status(user_id: uuid.UUID, body: UserStatusBody, admin: AdminUser, db: DbSession) -> AdminUserRow:
    user = _target(db, user_id)
    if user.is_admin and body.action != "reinstate":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Admins can't be suspended or banned here.")
    if body.action == "suspend":
        user.account_status = AccountStatus.suspended
        user.suspended_until = utcnow() + timedelta(days=body.days)
    elif body.action == "ban":
        user.account_status = AccountStatus.banned
        user.suspended_until = None
        end_all_matches(db, user, admin.id)
    else:
        user.account_status = AccountStatus.active
        user.suspended_until = None
    db.commit()
    return _user_row(db, user)


@router.post("/users/{user_id}/plus", response_model=AdminUserRow)
def give_user_plus(user_id: uuid.UUID, body: AdminPlusBody, admin: AdminUser, db: DbSession) -> AdminUserRow:
    user = _target(db, user_id)
    grant_plus(db, user, source="admin", duration=timedelta(days=body.days) if body.days else None)
    db.commit()
    return _user_row(db, user)


@router.delete("/users/{user_id}/plus", response_model=AdminUserRow)
def take_user_plus(user_id: uuid.UUID, admin: AdminUser, db: DbSession) -> AdminUserRow:
    """Ends Plus given by admins or switched on during the beta. Store purchases are left alone."""
    user = _target(db, user_id)
    end_plus(db, user, source="admin")
    end_plus(db, user, source="beta")
    db.commit()
    return _user_row(db, user)

import uuid

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select

from app import push

from app.deps import CurrentUser, DbSession
from app.models import Profile, Race, Report, User
from app.moderation import block, capture_evidence, match_between
from app.schemas import ReportBody, ReportCreated
from app.security import utcnow

router = APIRouter(tags=["safety"])


def _other_user(db: DbSession, me: User, user_id: uuid.UUID) -> User:
    other = db.get(User, user_id)
    if other is None or other.id == me.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found.")
    return other


@router.post("/users/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def block_user(user_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    _other_user(db, user, user_id)
    block(db, user, user_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reports", response_model=ReportCreated, status_code=status.HTTP_201_CREATED)
def create_report(body: ReportBody, user: CurrentUser, db: DbSession) -> ReportCreated:
    reported = _other_user(db, user, body.reported_user_id)

    if body.race_id is not None and db.get(Race, body.race_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Race not found.")

    match = match_between(db, user.id, reported.id)
    if body.match_id is not None and (match is None or match.id != body.match_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Match not found.")

    # Reporting the same person twice while the first report is open adds nothing new
    existing = db.scalar(
        select(Report).where(
            Report.reporter_id == user.id, Report.reported_id == reported.id, Report.status == "open"
        )
    )
    if existing is not None:
        return ReportCreated(id=existing.id)

    report = Report(
        reporter_id=user.id,
        reported_id=reported.id,
        match_id=match.id if match else None,
        race_id=body.race_id,
        reason=body.reason,
        details=body.details,
        # Captured before blocking, while the conversation is exactly as the reporter saw it
        evidence=capture_evidence(db, reported, match, body.race_id),
        created_at=utcnow(),
    )
    db.add(report)
    # Reporting someone always blocks them too
    block(db, user, reported.id)
    db.commit()

    name = db.scalar(select(Profile.display_name).where(Profile.user_id == reported.id)) or "Someone"
    if body.reason == "underage":
        # Possible child on the app: review straight away (Play's child safety standards)
        push.notify_admins(db, "Urgent: possible under-18", f"{name} was reported as under 18. Review now.", "/moderation?view=open")
    else:
        push.notify_admins(db, "New report", f"{name} was reported: {body.reason.replace('_', ' ')}", "/moderation?view=open")
    return ReportCreated(id=report.id)

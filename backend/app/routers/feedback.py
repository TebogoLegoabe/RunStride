"""Feedback from users to the team, and error reports from the app itself."""
import logging
from datetime import timedelta
from typing import Annotated, Literal

import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select

from app import push
from app.deps import AdminUser, CurrentUser, DbSession
from app.models import Feedback, Profile, User
from app.schemas import ClientErrorBody, FeedbackBody, FeedbackOut
from app.security import utcnow

router = APIRouter(tags=["feedback"])
log = logging.getLogger("runstride.client")

MAX_FEEDBACK_PER_DAY = 10


@router.post("/feedback", status_code=status.HTTP_204_NO_CONTENT)
def send_feedback(body: FeedbackBody, user: CurrentUser, db: DbSession) -> Response:
    recent = db.scalar(
        select(func.count())
        .select_from(Feedback)
        .where(Feedback.user_id == user.id, Feedback.created_at > utcnow() - timedelta(days=1))
    )
    if recent >= MAX_FEEDBACK_PER_DAY:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail="Thanks! That's plenty for today.")
    db.add(Feedback(user_id=user.id, body=body.body.strip(), platform=body.platform, screen=body.screen))
    db.commit()
    name = user.profile.display_name if user.profile else "Someone"
    push.notify_admins(db, "New feedback", f"{name}: {body.body.strip()[:80]}", "/moderation?view=feedback", exclude=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/feedback", response_model=list[FeedbackOut])
def list_feedback(
    admin: AdminUser,
    db: DbSession,
    response: Response,
    status_filter: Annotated[Literal["open", "done"], Query(alias="status")] = "open",
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[FeedbackOut]:
    where = Feedback.status == status_filter
    response.headers["X-Total-Count"] = str(db.scalar(select(func.count()).select_from(Feedback).where(where)))
    rows = db.execute(
        select(Feedback, Profile.display_name, User.phone)
        .outerjoin(User, User.id == Feedback.user_id)
        .outerjoin(Profile, Profile.user_id == Feedback.user_id)
        .where(where)
        .order_by(Feedback.created_at.desc(), Feedback.id)
        .offset(offset)
        .limit(limit)
    ).all()
    return [
        FeedbackOut(
            id=f.id, body=f.body, platform=f.platform, screen=f.screen, status=f.status, created_at=f.created_at,
            user_id=f.user_id, display_name=name, phone=phone,
        )
        for f, name, phone in rows
    ]


@router.post("/admin/feedback/{feedback_id}/done", status_code=status.HTTP_204_NO_CONTENT)
def mark_feedback_done(feedback_id: str, admin: AdminUser, db: DbSession) -> Response:
    item = db.get(Feedback, feedback_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    item.status = "done"
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Error reports need no sign-in, so cap how many one address can send (per server process)
_ERRORS_PER_MINUTE = 20
_recent_errors: dict[str, deque] = defaultdict(deque)


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
def client_error(body: ClientErrorBody, request: Request) -> Response:
    """A crash or error in the app. Logged (and sent to Sentry when it's set up). No sign-in needed:
    the app may be broken before it knows who you are. Nothing personal is sent."""
    now = time.monotonic()
    seen = _recent_errors[request.client.host if request.client else "?"]
    while seen and now - seen[0] > 60:
        seen.popleft()
    if len(seen) >= _ERRORS_PER_MINUTE:
        return Response(status_code=status.HTTP_204_NO_CONTENT)  # quietly drop the flood
    seen.append(now)
    log.error(
        "App error (%s%s) on %s at %s: %s\n%s",
        body.platform or "?",
        ", fatal" if body.fatal else "",
        body.platform,
        body.screen,
        body.message,
        body.stack or "",
    )
    try:
        import sentry_sdk

        with sentry_sdk.new_scope() as scope:
            scope.set_tag("source", "app")
            scope.set_tag("platform", body.platform or "unknown")
            scope.set_extra("screen", body.screen)
            scope.set_extra("stack", body.stack)
            sentry_sdk.capture_message(f"App: {body.message}", level="fatal" if body.fatal else "error")
    except Exception:  # Sentry not installed or not set up: the log line is enough
        pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)

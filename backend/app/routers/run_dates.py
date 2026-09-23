import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app import run_dates
from app.deps import AppSettings, CurrentUser, DbSession
from app.dev_seed import dev_auto_accept_run
from app.models import Match, RunDate
from app.routers.matches import active_match, check_rate_limits
from app.schemas import MessageOut, RunDateBody, RunDateOut

router = APIRouter(tags=["run dates"])


@router.post("/matches/{match_id}/run-dates", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def suggest_run(
    match_id: uuid.UUID,
    body: RunDateBody,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    background: BackgroundTasks,
):
    """Suggest a run. It appears in the chat as a card the other person can accept or decline."""
    match = active_match(db, user, match_id)
    check_rate_limits(db, user, settings)
    card = run_dates.propose(db, match, user, body)
    if settings.is_development:
        background.add_task(dev_auto_accept_run, card.run_date_id, user.id)
    return card


@router.post("/run-dates/{run_date_id}/{action}", response_model=RunDateOut)
def answer_run(
    run_date_id: uuid.UUID, action: run_dates.RunDateAction, user: CurrentUser, db: DbSession
) -> RunDate:
    run = db.get(RunDate, run_date_id)
    match = db.get(Match, run.match_id) if run else None
    if match is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Run not found.")
    active_match(db, user, match.id)  # participants only, and the match must still be on
    return run_dates.respond(db, run, match, user, action)

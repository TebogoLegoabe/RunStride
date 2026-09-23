"""Suggesting a run to a match, and answering or cancelling it."""

from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Match, Message, RunDate, User
from app.realtime import hub, publish_message
from app.schemas import RunDateBody, RunDateOut
from app.security import utcnow

RunDateAction = Literal["accept", "decline", "cancel"]

# What each change looks like in the conversation
SYSTEM_NOTES = {
    "accept": "Accepted the run 🎉",
    "decline": "Can't make this run",
    "cancel": "Cancelled the run",
}
NEW_STATUS = {"accept": "accepted", "decline": "declined", "cancel": "cancelled"}


def propose(db: Session, match: Match, proposer: User, body: RunDateBody) -> Message:
    waiting = db.scalar(
        select(RunDate).where(RunDate.match_id == match.id, RunDate.status == "proposed").limit(1)
    )
    if waiting is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="There's already a run waiting for a reply.")

    now = utcnow()
    run = RunDate(
        match_id=match.id,
        proposed_by_id=proposer.id,
        starts_at=body.starts_at,
        place=body.place,
        distance_km=body.distance_km,
        note=body.note,
        created_at=now,
    )
    db.add(run)
    db.flush()
    card = Message(
        match_id=match.id,
        sender_id=proposer.id,
        kind="run_date",
        run_date_id=run.id,
        body=f"Suggested a run at {body.place}",
        created_at=now,
    )
    db.add(card)
    db.commit()
    publish_message(card, [match.user_a_id, match.user_b_id])
    return card


def respond(db: Session, run: RunDate, match: Match, user: User, action: RunDateAction) -> RunDate:
    now = utcnow()
    if action in ("accept", "decline"):
        if run.status != "proposed":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="This run has already been answered.")
        if run.proposed_by_id == user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="You can't answer your own suggestion.")
        if action == "accept" and run.starts_at <= now:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="This run's start time has already passed.")
        run.responded_at = now
    else:  # cancel
        if run.status not in ("proposed", "accepted"):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="This run is no longer planned.")
        if run.status == "proposed" and run.proposed_by_id != user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Decline the suggestion instead.")
        run.cancelled_by_id = user.id

    run.status = NEW_STATUS[action]
    note = Message(
        match_id=match.id,
        sender_id=user.id,
        kind="system",
        run_date_id=run.id,
        body=SYSTEM_NOTES[action],
        created_at=now,
    )
    db.add(note)
    db.commit()

    participants = [match.user_a_id, match.user_b_id]
    publish_message(note, participants)
    out = RunDateOut.model_validate(run, from_attributes=True)
    hub.publish_from_thread(participants, {"type": "run_date", "runDate": out.model_dump(mode="json", by_alias=True)})
    return run

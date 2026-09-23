"""Run-day safety: trusted contacts, live location sharing, the panic button and check-ins."""

import logging
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import Settings
from app.deps import AppSettings, CurrentUser, DbSession
from app.models import Match, RunCheckIn, RunDate, RunShare, TrustedContact, User
from app.phone import InvalidPhoneNumber, normalize_phone
from app.schemas import (
    MAX_TRUSTED_CONTACTS,
    CheckInBody,
    LocationUpdate,
    RunDateOut,
    RunSafetyOut,
    ShareOut,
    TrustedContactBody,
    TrustedContactOut,
)
from app.security import utcnow
from app.sms import SmsSender, get_optional_sms_sender

router = APIRouter(tags=["run safety"])
logger = logging.getLogger("runstride.safety")

SHARE_OPENS_BEFORE = timedelta(hours=2)
SHARE_LASTS_AFTER = timedelta(hours=4)


def share_status(share: RunShare, now: datetime) -> str:
    """active / alert / ended, or expired once past its end time (even if never stopped)."""
    if share.status in ("active", "alert") and now >= share.expires_at:
        return "expired"
    return share.status


def share_url(settings: Settings, request: Request, token: str) -> str:
    base = settings.public_base_url.rstrip("/") or str(request.base_url).rstrip("/")
    return f"{base}/s/{token}"


def _share_out(share: RunShare, url: str) -> ShareOut:
    return ShareOut(
        id=share.id,
        status=share_status(share, utcnow()),
        url=url,
        started_at=share.started_at,
        expires_at=share.expires_at,
        alert_at=share.alert_at,
        location_at=share.location_at,
    )


def display_name(db: Session, user_id: uuid.UUID) -> str:
    user = db.get(User, user_id)
    return user.profile.display_name if user and user.profile else "a RunStride runner"


def _my_run(db: Session, user: User, run_date_id: uuid.UUID) -> tuple[RunDate, Match]:
    run = db.get(RunDate, run_date_id)
    match = db.get(Match, run.match_id) if run else None
    # Deliberately not requiring the match to still be active: if someone unmatches
    # right before a run, safety features must keep working for the other person.
    if match is None or user.id not in (match.user_a_id, match.user_b_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Run not found.")
    return run, match


def _latest_share(db: Session, user: User, run: RunDate) -> RunShare | None:
    return db.scalar(
        select(RunShare)
        .where(RunShare.user_id == user.id, RunShare.run_date_id == run.id)
        .order_by(RunShare.started_at.desc())
        .limit(1)
    )


def _my_live_share(db: Session, user: User, share_id: uuid.UUID) -> RunShare:
    share = db.get(RunShare, share_id)
    if share is None or share.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Share not found.")
    if share_status(share, utcnow()) not in ("active", "alert"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Location sharing has ended.")
    return share


def _contacts(db: Session, user: User) -> list[TrustedContact]:
    return list(
        db.scalars(select(TrustedContact).where(TrustedContact.user_id == user.id).order_by(TrustedContact.created_at))
    )


# --- Trusted contacts ---


@router.get("/me/trusted-contacts", response_model=list[TrustedContactOut])
def list_contacts(user: CurrentUser, db: DbSession) -> list[TrustedContact]:
    return _contacts(db, user)


@router.post("/me/trusted-contacts", response_model=TrustedContactOut, status_code=status.HTTP_201_CREATED)
def add_contact(body: TrustedContactBody, user: CurrentUser, db: DbSession, settings: AppSettings) -> TrustedContact:
    try:
        phone = normalize_phone(body.phone, settings.default_phone_region)
    except InvalidPhoneNumber:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="That doesn't look like a valid phone number.")
    if phone == user.phone:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Add someone other than yourself.")
    existing = _contacts(db, user)
    if any(c.phone == phone for c in existing):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="That number is already one of your trusted contacts.")
    if len(existing) >= MAX_TRUSTED_CONTACTS:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=f"You can have up to {MAX_TRUSTED_CONTACTS} trusted contacts."
        )
    contact = TrustedContact(user_id=user.id, name=body.name, phone=phone)
    db.add(contact)
    db.commit()
    return contact


@router.delete("/me/trusted-contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_contact(contact_id: uuid.UUID, user: CurrentUser, db: DbSession) -> Response:
    contact = db.get(TrustedContact, contact_id)
    if contact is None or contact.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Contact not found.")
    db.delete(contact)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- One run's safety screen ---


@router.get("/run-dates/{run_date_id}/safety", response_model=RunSafetyOut)
def run_safety(
    run_date_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession, settings: AppSettings
) -> RunSafetyOut:
    run, match = _my_run(db, user, run_date_id)
    share = _latest_share(db, user, run)
    check_in = db.get(RunCheckIn, (run.id, user.id))
    return RunSafetyOut(
        run=RunDateOut.model_validate(run, from_attributes=True),
        other_user_id=match.other_user_id(user.id),
        other_name=display_name(db, match.other_user_id(user.id)),
        share_opens_at=run.starts_at - SHARE_OPENS_BEFORE,
        share_closes_at=run.starts_at + SHARE_LASTS_AFTER,
        share=_share_out(share, share_url(settings, request, share.token)) if share else None,
        trusted_contacts=[TrustedContactOut.model_validate(c, from_attributes=True) for c in _contacts(db, user)],
        check_in=check_in.outcome if check_in else None,
    )


@router.post("/run-dates/{run_date_id}/share", response_model=ShareOut, status_code=status.HTTP_201_CREATED)
def start_sharing(
    run_date_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession, settings: AppSettings
) -> ShareOut:
    run, _ = _my_run(db, user, run_date_id)
    if run.status != "accepted":
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You can share your location once the run is accepted.")
    now = utcnow()
    if now < run.starts_at - SHARE_OPENS_BEFORE:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Sharing opens 2 hours before the run.")
    if now >= run.starts_at + SHARE_LASTS_AFTER:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="This run is over.")

    existing = _latest_share(db, user, run)
    if existing is not None and share_status(existing, now) in ("active", "alert"):
        return _share_out(existing, share_url(settings, request, existing.token))

    share = RunShare(
        user_id=user.id,
        run_date_id=run.id,
        token=secrets.token_urlsafe(24),
        started_at=now,
        expires_at=run.starts_at + SHARE_LASTS_AFTER,
    )
    db.add(share)
    db.commit()
    return _share_out(share, share_url(settings, request, share.token))


@router.put("/shares/{share_id}/location", status_code=status.HTTP_204_NO_CONTENT)
def update_location(share_id: uuid.UUID, body: LocationUpdate, user: CurrentUser, db: DbSession) -> Response:
    share = _my_live_share(db, user, share_id)
    share.latitude = body.latitude
    share.longitude = body.longitude
    share.accuracy_m = body.accuracy_m
    share.location_at = utcnow()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/shares/{share_id}/alert", response_model=ShareOut)
def raise_alert(
    share_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    sms: Annotated[SmsSender | None, Depends(get_optional_sms_sender)],
) -> ShareOut:
    """The panic button: the tracking page turns red and trusted contacts are texted."""
    share = _my_live_share(db, user, share_id)
    url = share_url(settings, request, share.token)
    if share.status != "alert":
        share.status = "alert"
        share.alert_at = utcnow()
        db.commit()
        run = db.get(RunDate, share.run_date_id)
        runner = display_name(db, user.id)
        message = (
            f"RunStride safety alert: {runner} pressed their emergency button during a run at {run.place}. "
            f"Their location: {url} . If you can't reach them, call 10111 or 112."
        )
        if sms is None:
            logger.error("Panic alert raised but no SMS provider is configured (share %s)", share.id)
        else:
            for contact in _contacts(db, user):
                try:
                    sms.send(contact.phone, message)
                except Exception:
                    # The alert is recorded and shown on the page; a failed text mustn't undo that
                    logger.exception("Could not text trusted contact %s", contact.id)
    return _share_out(share, url)


@router.post("/shares/{share_id}/end", response_model=ShareOut)
def stop_sharing(
    share_id: uuid.UUID, request: Request, user: CurrentUser, db: DbSession, settings: AppSettings
) -> ShareOut:
    """"I'm safe": stop sharing and forget the exact location."""
    share = _my_live_share(db, user, share_id)
    share.status = "ended"
    share.ended_at = utcnow()
    share.latitude = share.longitude = share.accuracy_m = None
    db.commit()
    return _share_out(share, share_url(settings, request, share.token))


@router.post("/run-dates/{run_date_id}/check-in", status_code=status.HTTP_204_NO_CONTENT)
def check_in(run_date_id: uuid.UUID, body: CheckInBody, user: CurrentUser, db: DbSession) -> Response:
    run, _ = _my_run(db, user, run_date_id)
    if run.status != "accepted" or utcnow() < run.starts_at:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You can check in once the run has started.")
    db.execute(
        pg_insert(RunCheckIn)
        .values(run_date_id=run.id, user_id=user.id, outcome=body.outcome, created_at=func.now())
        .on_conflict_do_update(index_elements=["run_date_id", "user_id"], set_={"outcome": body.outcome})
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

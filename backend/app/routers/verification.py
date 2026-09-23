import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.deps import AppSettings, CurrentUser, DbSession
from app.models import User, VerificationInquiry, VerificationStatus
from app.persona import PersonaClient, get_persona_client, verify_webhook_signature
from app.schemas import VerificationStartResponse, VerificationStateResponse

router = APIRouter(tags=["verification"])

Persona = Annotated[PersonaClient, Depends(get_persona_client)]

PROVIDER = "persona"
# Persona inquiry statuses, grouped by what they mean for us
IN_PROGRESS = {"created", "pending"}  # user hasn't finished the flow; can resume
UNDER_REVIEW = {"completed", "needs_review"}  # submitted, waiting for a decision
FAILED = {"declined", "failed"}


def user_status_for(provider_status: str) -> VerificationStatus:
    if provider_status == "approved":
        return VerificationStatus.verified
    if provider_status in UNDER_REVIEW:
        return VerificationStatus.pending
    if provider_status in FAILED:
        return VerificationStatus.rejected
    return VerificationStatus.unverified  # created, pending, expired


def _latest_inquiry(db: Session, user: User) -> VerificationInquiry | None:
    return db.scalar(
        select(VerificationInquiry)
        .where(VerificationInquiry.user_id == user.id)
        .order_by(VerificationInquiry.created_at.desc())
        .limit(1)
    )


def _attempts_remaining(db: Session, user: User, settings: Settings) -> int:
    failed = db.scalar(
        select(func.count())
        .select_from(VerificationInquiry)
        .where(VerificationInquiry.user_id == user.id, VerificationInquiry.provider_status.in_(FAILED))
    )
    return max(settings.max_verification_attempts - failed, 0)


def _state(db: Session, user: User, settings: Settings) -> VerificationStateResponse:
    remaining = _attempts_remaining(db, user, settings)
    latest = _latest_inquiry(db, user)
    can_start = user.verification_status in (VerificationStatus.unverified, VerificationStatus.rejected) and (
        remaining > 0 or (latest is not None and latest.provider_status in IN_PROGRESS)
    )
    return VerificationStateResponse(
        status=user.verification_status, attempts_remaining=remaining, can_start=can_start
    )


def _sync(db: Session, inquiry: VerificationInquiry, persona: PersonaClient) -> None:
    """Pull the inquiry's current status from Persona (the source of truth) and apply it."""
    inquiry.provider_status = persona.get_inquiry(inquiry.provider_inquiry_id).status
    user = db.get(User, inquiry.user_id)
    latest = _latest_inquiry(db, user)
    # An update to an older, superseded inquiry mustn't overwrite the current attempt
    if latest is None or latest.id == inquiry.id:
        user.verification_status = user_status_for(inquiry.provider_status)


@router.get("/verification", response_model=VerificationStateResponse)
def get_verification(user: CurrentUser, db: DbSession, settings: AppSettings) -> VerificationStateResponse:
    return _state(db, user, settings)


@router.post("/verification/start", response_model=VerificationStartResponse)
def start_verification(
    user: CurrentUser, db: DbSession, settings: AppSettings, persona: Persona
) -> VerificationStartResponse:
    if user.profile is None:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Create your profile before verifying your ID.")
    if user.verification_status == VerificationStatus.verified:
        raise HTTPException(status.HTTP_409_CONFLICT, detail="You're already verified.")

    latest = _latest_inquiry(db, user)
    if latest is not None and latest.provider_status in UNDER_REVIEW:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="Your verification is being reviewed. We'll update you soon."
        )

    if latest is not None and latest.provider_status in IN_PROGRESS:
        # Resume the unfinished attempt rather than paying for a new one
        inquiry_id = latest.provider_inquiry_id
    else:
        if _attempts_remaining(db, user, settings) == 0:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail="We couldn't verify your ID after several attempts. Please contact support.",
            )
        inquiry = persona.create_inquiry()
        db.add(
            VerificationInquiry(
                user_id=user.id,
                provider=PROVIDER,
                provider_inquiry_id=inquiry.id,
                provider_status=inquiry.status,
            )
        )
        user.verification_status = VerificationStatus.unverified
        db.commit()
        inquiry_id = inquiry.id

    return VerificationStartResponse(verification_url=persona.one_time_link(inquiry_id))


@router.post("/verification/refresh", response_model=VerificationStateResponse)
def refresh_verification(
    user: CurrentUser, db: DbSession, settings: AppSettings, persona: Persona
) -> VerificationStateResponse:
    """Ask Persona for the latest status. Webhooks normally do this; the app calls it
    when the user returns from the verification flow so they don't wait on a webhook."""
    latest = _latest_inquiry(db, user)
    if latest is not None:
        _sync(db, latest, persona)
        db.commit()
    return _state(db, user, settings)


@router.post("/webhooks/persona", include_in_schema=False)
async def persona_webhook(request: Request, db: DbSession, settings: AppSettings, persona: Persona) -> dict:
    body = await request.body()
    if not verify_webhook_signature(
        request.headers.get("Persona-Signature"), body, settings.persona_webhook_secret
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid signature.")

    try:
        event = json.loads(body)["data"]["attributes"]
        name = event["name"]
        inquiry_id = event["payload"]["data"]["id"]
    except (ValueError, KeyError, TypeError):
        return {"ok": True}  # not an event shape we handle
    if not name.startswith("inquiry."):
        return {"ok": True}

    def apply() -> None:
        inquiry = db.scalar(
            select(VerificationInquiry).where(VerificationInquiry.provider_inquiry_id == inquiry_id)
        )
        if inquiry is None:
            return  # e.g. an inquiry created by hand in the Persona dashboard
        _sync(db, inquiry, persona)
        db.commit()

    await run_in_threadpool(apply)
    return {"ok": True}

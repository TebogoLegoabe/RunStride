import logging
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update

from app.config import Settings
from app.deps import AppSettings, DbSession
from app.models import OtpCode, User
from app.moderation import lockout_message
from app.phone import InvalidPhoneNumber, normalize_phone, region_of
from app.schemas import OtpSendRequest, OtpSendResponse, OtpVerifyRequest, OtpVerifyResponse
from app.security import create_access_token, generate_otp, hash_otp, otp_matches, utcnow
from app.sms import SmsError, SmsSender, get_sms_sender

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("runstride.auth")


def _normalize(raw: str, settings: Settings) -> str:
    try:
        return normalize_phone(raw, settings.default_phone_region)
    except InvalidPhoneNumber:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That doesn't look like a valid phone number.",
        )


def _client_ip(request: Request) -> str | None:
    # Behind a reverse proxy, run uvicorn with --proxy-headers so this is the real client address
    return request.client.host if request.client else None


def _too_many(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)


def _count_since(db, since, *conditions) -> int:
    return db.scalar(select(func.count()).select_from(OtpCode).where(OtpCode.created_at > since, *conditions))


@router.post("/otp/send", response_model=OtpSendResponse)
def send_otp(
    body: OtpSendRequest,
    request: Request,
    db: DbSession,
    settings: AppSettings,
    sms: Annotated[SmsSender, Depends(get_sms_sender)],
) -> OtpSendResponse:
    phone = _normalize(body.phone, settings)
    if region_of(phone) not in settings.sms_allowed_regions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="RunStride is only available in South Africa for now. Please use a South African number.",
        )
    now = utcnow()
    ip = _client_ip(request)

    # Per number: a short cooldown between codes, and an hourly cap
    recent_sends = db.scalars(
        select(OtpCode.created_at)
        .where(OtpCode.phone == phone, OtpCode.created_at > now - timedelta(hours=1))
        .order_by(OtpCode.created_at.desc())
    ).all()
    if recent_sends and now - recent_sends[0] < timedelta(seconds=settings.otp_resend_cooldown_seconds):
        raise _too_many("Please wait a few seconds before requesting another code.")
    if len(recent_sends) >= settings.otp_max_sends_per_hour:
        raise _too_many("Too many codes requested. Please try again later.")
    # Per address and overall: stop one attacker (or a runaway bill) cycling through many numbers
    if ip and _count_since(db, now - timedelta(hours=1), OtpCode.request_ip == ip) >= settings.otp_max_sends_per_ip_per_hour:
        raise _too_many("Too many codes requested from this network. Please try again later.")
    if _count_since(db, now - timedelta(days=1)) >= settings.otp_max_sends_per_day:
        logger.error("Daily OTP cap of %s reached: sign-ups paused", settings.otp_max_sends_per_day)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Sign-ups are very busy right now. Please try again in a little while.",
        )

    # Only the newest code is ever valid
    db.execute(
        update(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.consumed_at.is_(None))
        .values(consumed_at=now)
    )
    code = generate_otp()
    otp = OtpCode(
        phone=phone,
        code_hash=hash_otp(phone, code),
        request_ip=ip,
        created_at=now,
        expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
    )
    db.add(otp)
    db.commit()

    try:
        sms.send(
            phone,
            f"Your RunStride code is {code}. It expires in {settings.otp_ttl_minutes} minutes. "
            "Never share it with anyone.",
        )
    except SmsError:
        logger.exception("Could not send sign-in code")
        otp.consumed_at = utcnow()  # never delivered, so it must never work
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We couldn't send your code just now. Please try again in a minute.",
        )
    return OtpSendResponse(sent=True, phone=phone)


@router.post("/otp/verify", response_model=OtpVerifyResponse)
def verify_otp(body: OtpVerifyRequest, db: DbSession, settings: AppSettings) -> OtpVerifyResponse:
    phone = _normalize(body.phone, settings)
    now = utcnow()

    otp = db.scalars(
        select(OtpCode)
        .where(OtpCode.phone == phone, OtpCode.consumed_at.is_(None))
        .order_by(OtpCode.created_at.desc())
        .limit(1)
        .with_for_update()
    ).first()

    if otp is None or otp.expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This code has expired. Please request a new one.",
        )
    if otp.attempts >= settings.otp_max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Please request a new code.",
        )
    if not otp_matches(phone, body.code, otp.code_hash):
        otp.attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That code is incorrect.")

    otp.consumed_at = now
    user = db.scalar(select(User).where(User.phone == phone))
    locked = lockout_message(user) if user else None
    if locked:
        db.commit()  # still use up the code
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=locked)
    if user is None:
        user = User(phone=phone)
        db.add(user)
    user.last_login_at = now
    db.commit()

    return OtpVerifyResponse(
        token=create_access_token(user.id),
        user_id=user.id,
        profile_complete=user.profile_complete,
    )

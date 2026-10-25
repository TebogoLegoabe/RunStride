import logging
import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, func, select, update

from app.config import Settings
from app.deps import AppSettings, CurrentUser, DbSession
from app.models import OtpCode, TrustedDevice, User
from app.moderation import end_all_matches, lockout_message
from app.phone import InvalidPhoneNumber, normalize_phone, region_of
from app.google_auth import GoogleIdentity, GoogleVerifier, InvalidGoogleToken, get_google_verifier
from app.schemas import (
    DeviceSignInBody,
    GoogleAuthBody,
    GoogleAuthResponse,
    OtpSendRequest,
    OtpSendResponse,
    OtpVerifyRequest,
    OtpVerifyResponse,
)
from app.security import create_access_token, generate_otp, hash_device_token, hash_otp, otp_matches, utcnow
from app.sms import SmsError, SmsSender, get_sms_sender
from app.storage import PhotoStorage, get_photo_storage

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
    if _is_review_phone(phone, settings):
        return _issue_review_code(db, phone, ip, settings, now)

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
    if (
        _count_since(db, now - timedelta(days=1), OtpCode.phone == phone)
        >= settings.otp_max_sends_per_number_per_day
    ):
        raise _too_many("Too many codes requested today. Please try again tomorrow, or sign in with Google.")
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
            # Wording matters: BulkSMS's route rejected "Your RunStride code is 123456" (FAILED.NOT_SENT,
            # no charge) but delivered this form. Tested live 11 Oct 2026. Keep it ASCII and under 160
            # characters so it stays one text (one credit).
            f"RunStride: use {code} to sign in. It expires in {settings.otp_ttl_minutes} minutes. "
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


def _is_review_phone(phone: str, settings: Settings) -> bool:
    if not settings.review_phone:
        return False
    try:
        return normalize_phone(settings.review_phone, settings.default_phone_region) == phone
    except InvalidPhoneNumber:
        return False


def _issue_review_code(db, phone: str, ip: str | None, settings: Settings, now) -> OtpSendResponse:
    """Google Play's reviewers: the fixed code works, nothing is texted, and the send limits don't
    apply (reviewers retry a lot). Wrong guesses still lock the code after a few attempts."""
    db.execute(update(OtpCode).where(OtpCode.phone == phone, OtpCode.consumed_at.is_(None)).values(consumed_at=now))
    db.add(
        OtpCode(
            phone=phone,
            code_hash=hash_otp(phone, settings.review_code),
            request_ip=ip,
            created_at=now,
            expires_at=now + timedelta(minutes=settings.otp_ttl_minutes),
        )
    )
    db.commit()
    return OtpSendResponse(sent=True, phone=phone)


def _consume_code(db, phone: str, code: str, settings: Settings, now) -> None:
    """Check a sign-in code for this number and use it up. Raises the right HTTP error if it's wrong."""
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
    if not otp_matches(phone, code, otp.code_hash):
        otp.attempts += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That code is incorrect.")

    otp.consumed_at = now


@router.post("/otp/verify", response_model=OtpVerifyResponse)
def verify_otp(body: OtpVerifyRequest, db: DbSession, settings: AppSettings) -> OtpVerifyResponse:
    phone = _normalize(body.phone, settings)
    now = utcnow()
    _consume_code(db, phone, body.code, settings, now)
    user = db.scalar(select(User).where(User.phone == phone))
    locked = lockout_message(user) if user else None
    if locked:
        db.commit()  # still use up the code
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=locked)
    if user is None:
        user = User(phone=phone)
        db.add(user)
    user.last_login_at = now
    device_token = _remember_device(db, user, settings, now)
    db.commit()

    return OtpVerifyResponse(
        token=create_access_token(user.id),
        user_id=user.id,
        profile_complete=user.profile_complete,
        device_token=device_token,
    )


def _remember_device(db, user: User, settings: Settings, now) -> str:
    """A new device token for this phone. This person's expired ones are cleaned up on the way."""
    db.execute(delete(TrustedDevice).where(TrustedDevice.user_id == user.id, TrustedDevice.expires_at <= now))
    token = secrets.token_urlsafe(32)
    db.add(
        TrustedDevice(
            user_id=user.id,
            token_hash=hash_device_token(token),
            expires_at=now + timedelta(days=settings.trusted_device_days),
        )
    )
    return token


@router.post("/device", response_model=OtpVerifyResponse)
def sign_in_with_device(body: DeviceSignInBody, db: DbSession, settings: AppSettings) -> OtpVerifyResponse:
    """Sign back in on a phone that signed in with a code in the last 30 days, with no new text.
    The device token is single-use: each sign-in returns a fresh one."""
    phone = _normalize(body.phone, settings)
    now = utcnow()
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in with a new code.")
    device = db.scalar(
        select(TrustedDevice).where(TrustedDevice.token_hash == hash_device_token(body.device_token)).with_for_update()
    )
    if device is None or device.expires_at <= now:
        raise invalid
    user = db.get(User, device.user_id)
    if user is None or user.phone != phone:
        raise invalid
    locked = lockout_message(user)
    if locked:
        raise HTTPException(status.HTTP_403_FORBIDDEN, locked)
    db.delete(device)
    user.last_login_at = now
    device_token = _remember_device(db, user, settings, now)
    db.commit()
    return OtpVerifyResponse(
        token=create_access_token(user.id),
        user_id=user.id,
        profile_complete=user.profile_complete,
        device_token=device_token,
    )


# --- Google ---


def verified_google_identity(body: GoogleAuthBody, settings: Settings, verifier: GoogleVerifier) -> GoogleIdentity:
    if not settings.google_client_ids:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google sign-in isn't available yet.")
    try:
        identity = verifier.verify(body.id_token, settings.google_client_ids)
    except InvalidGoogleToken:
        logger.info("Rejected a Google ID token", exc_info=True)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Google sign-in didn't work. Please try again.")
    if not identity.email_verified:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="Please verify your Google account's email address first."
        )
    return identity


@router.post("/google", response_model=GoogleAuthResponse)
def google_sign_in(
    body: GoogleAuthBody,
    db: DbSession,
    settings: AppSettings,
    verifier: Annotated[GoogleVerifier, Depends(get_google_verifier)],
) -> GoogleAuthResponse:
    """Sign in (or sign up) with Google. Accounts made this way have no phone number."""
    identity = verified_google_identity(body, settings, verifier)
    user = db.scalar(select(User).where(User.google_sub == identity.sub))
    locked = lockout_message(user) if user else None
    if locked:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=locked)
    if user is None:
        user = User(google_sub=identity.sub)
        db.add(user)
    user.email = identity.email
    user.last_login_at = utcnow()
    db.commit()
    return GoogleAuthResponse(
        token=create_access_token(user.id),
        user_id=user.id,
        profile_complete=user.profile_complete,
        suggested_name=identity.given_name if user.profile is None else None,
    )



@router.post("/phone", response_model=OtpVerifyResponse)
def add_phone(
    body: OtpVerifyRequest,
    user: CurrentUser,
    db: DbSession,
    settings: AppSettings,
    photos: Annotated[PhotoStorage, Depends(get_photo_storage)],
) -> OtpVerifyResponse:
    """A Google-only account adds (and proves) a phone number, so everyone has both.

    If that number already belongs to a phone account, the two are joined: the phone account keeps
    going and now also signs in with this Google account, and the brand-new Google-only account is
    removed. The response carries the token for whichever account is left."""
    if user.phone is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This account already has a phone number.")
    phone = _normalize(body.phone, settings)
    now = utcnow()
    _consume_code(db, phone, body.code, settings, now)

    existing = db.scalar(select(User).where(User.phone == phone))
    if existing is None:
        user.phone = phone
        db.commit()
        return OtpVerifyResponse(
            token=create_access_token(user.id), user_id=user.id, profile_complete=user.profile_complete
        )

    locked = lockout_message(existing)
    if locked:
        db.commit()  # the code is used up either way
        raise HTTPException(status.HTTP_403_FORBIDDEN, locked)
    if existing.google_sub is not None and existing.google_sub != user.google_sub:
        db.commit()
        raise HTTPException(status.HTTP_409_CONFLICT, "That number is already linked to a different Google account.")

    google_sub, email = user.google_sub, user.email
    photo_urls = [p.url for p in user.profile.photos] if user.profile else []
    end_all_matches(db, user, user.id)
    db.delete(user)  # frees the Google account for the phone account (the ID is unique)
    db.flush()
    existing.google_sub = google_sub
    existing.email = email
    existing.last_login_at = now
    db.commit()
    for url in photo_urls:
        try:
            photos.delete(url)
        except Exception:
            logger.exception("Could not delete photo %s", url)
    return OtpVerifyResponse(
        token=create_access_token(existing.id), user_id=existing.id, profile_complete=existing.profile_complete
    )

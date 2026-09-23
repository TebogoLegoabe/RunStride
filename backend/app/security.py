import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings

JWT_ALGORITHM = "HS256"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def generate_otp() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def hash_otp(phone: str, code: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def otp_matches(phone: str, code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(phone, code), code_hash)


def create_access_token(user_id: uuid.UUID) -> str:
    settings = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(days=settings.access_token_ttl_days),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID:
    """Raises jwt.PyJWTError or ValueError if the token is invalid or expired."""
    payload = jwt.decode(token, get_settings().secret_key, algorithms=[JWT_ALGORITHM])
    return uuid.UUID(payload["sub"])

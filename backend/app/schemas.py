import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models import VerificationStatus


class CamelModel(BaseModel):
    """JSON uses camelCase to match the TypeScript client; Python stays snake_case."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class OtpSendRequest(CamelModel):
    phone: str = Field(min_length=1, max_length=32)


class OtpSendResponse(CamelModel):
    sent: bool
    # Normalized E.164 number; the client should send this back to /otp/verify
    phone: str


class OtpVerifyRequest(CamelModel):
    phone: str = Field(min_length=1, max_length=32)
    code: str = Field(pattern=r"^\d{6}$")


class OtpVerifyResponse(CamelModel):
    token: str
    user_id: uuid.UUID
    profile_complete: bool


class MeResponse(CamelModel):
    id: uuid.UUID
    phone: str
    verification_status: VerificationStatus
    # False only in development while ID verification is switched off
    verification_required: bool
    profile_complete: bool


MIN_AGE = 18


def age_on(birth_date: date, today: date) -> int:
    had_birthday = (today.month, today.day) >= (birth_date.month, birth_date.day)
    return today.year - birth_date.year - (0 if had_birthday else 1)


class ProfileUpsertRequest(CamelModel):
    display_name: str = Field(max_length=50)
    birth_date: date
    bio: str | None = Field(default=None, max_length=500)

    @field_validator("display_name")
    @classmethod
    def display_name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Please enter your name.")
        return v

    @field_validator("birth_date")
    @classmethod
    def adults_only(cls, v: date) -> date:
        today = date.today()
        if v.year < 1900 or v > today:
            raise ValueError("Please enter a valid date of birth.")
        if age_on(v, today) < MIN_AGE:
            raise ValueError("You must be 18 or older to use RunStride.")
        return v

    @field_validator("bio")
    @classmethod
    def blank_bio_is_none(cls, v: str | None) -> str | None:
        return (v or "").strip() or None


class PhotoResponse(CamelModel):
    id: uuid.UUID
    url: str
    position: int


class ProfileResponse(CamelModel):
    display_name: str
    birth_date: date
    age: int
    bio: str | None
    photos: list[PhotoResponse]


class VerificationStateResponse(CamelModel):
    status: VerificationStatus
    attempts_remaining: int
    # True when the user can open the verification flow (new attempt or resume)
    can_start: bool


class VerificationStartResponse(CamelModel):
    verification_url: str

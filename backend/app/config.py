from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "dev-only-insecure-secret-change-me-before-deploying"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://runstride:runstride@localhost:5433/runstride"
    secret_key: str = DEV_SECRET_KEY
    access_token_ttl_days: int = 30

    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 30
    otp_max_sends_per_hour: int = 5

    # Numbers typed without a country code ("082 123 4567") are read as South African.
    default_phone_region: str = "ZA"

    # Local photo storage for development; swap for S3/Cloudinary before launch
    media_dir: str = "media"
    max_photos: int = 6
    max_photo_bytes: int = 10 * 1024 * 1024

    # Persona ID verification. Sandbox and production use the same API; the key decides which.
    persona_api_key: str = ""
    persona_inquiry_template_id: str = ""
    persona_webhook_secret: str = ""
    persona_api_base_url: str = "https://api.withpersona.com/api/v1"
    persona_api_version: str = "2023-01-05"
    # Development only: let users into the app without ID verification (while Persona
    # isn't set up yet). Can't be turned off outside development.
    require_id_verification: bool = True
    # Declined/failed inquiries allowed before the user has to contact support
    max_verification_attempts: int = 3

    # Chat rate limits. New accounts get a tighter hourly cap (a common spam/scam pattern).
    messages_per_minute: int = 20
    new_account_hours: int = 24
    new_account_messages_per_hour: int = 30

    # Hide someone from Discover once this many different people have open reports against them
    report_auto_hide_threshold: int = 3

    # Expo web dev server origins
    cors_origins: list[str] = ["http://localhost:8081", "http://localhost:19006"]

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    def model_post_init(self, __context) -> None:
        if not self.is_development and self.secret_key == DEV_SECRET_KEY:
            raise ValueError("SECRET_KEY must be set outside development")
        if not self.is_development and not self.require_id_verification:
            raise ValueError("REQUIRE_ID_VERIFICATION can only be turned off in development")


@lru_cache
def get_settings() -> Settings:
    return Settings()

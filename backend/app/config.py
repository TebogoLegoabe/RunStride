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

    # Expo web dev server origins
    cors_origins: list[str] = ["http://localhost:8081", "http://localhost:19006"]

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    def model_post_init(self, __context) -> None:
        if not self.is_development and self.secret_key == DEV_SECRET_KEY:
            raise ValueError("SECRET_KEY must be set outside development")


@lru_cache
def get_settings() -> Settings:
    return Settings()

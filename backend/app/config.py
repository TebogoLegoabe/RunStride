from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "dev-only-insecure-secret-change-me-before-deploying"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = "postgresql+psycopg://runstride:runstride@localhost:5433/runstride"
    secret_key: str = DEV_SECRET_KEY
    access_token_ttl_days: int = 30
    # A phone that signed in with a code can sign back in without a new text for this long
    trusted_device_days: int = 30
    # Error tracking (sentry.io). Empty: errors only go to the logs.
    sentry_dsn: str = ""
    # Free RunStride Plus anyone can switch on once, during the beta (90 days). 0 turns the offer off.
    beta_plus_days: int = 90

    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    otp_resend_cooldown_seconds: int = 60
    otp_max_sends_per_hour: int = 3
    # Per number, per day: one person can't drain the SMS credits by asking again and again
    otp_max_sends_per_number_per_day: int = 6

    # Guards against SMS pumping (bots requesting codes to run up the SMS bill)
    otp_max_sends_per_ip_per_hour: int = 10
    # Across everyone: a hard ceiling on a bad day. Keep it well under your SMS credit balance
    # (a 2,000 credit bundle is about 2,000 texts), and raise it as real usage grows.
    otp_max_sends_per_day: int = 300
    # Countries (ISO codes) people can sign up from
    sms_allowed_regions: list[str] = ["ZA"]

    # SMS delivery: "console" (development: printed to the logs) or "bulksms"
    sms_provider: str = "console"
    bulksms_token_id: str = ""
    bulksms_token_secret: str = ""
    bulksms_base_url: str = "https://api.bulksms.com/v1"

    # Numbers typed without a country code ("082 123 4567") are read as South African.
    default_phone_region: str = "ZA"

    # Photo storage: "local" (files in media_dir, served by the API; development only)
    # or "s3" (any S3-compatible service: Cloudflare R2, AWS S3, MinIO)
    photo_storage: str = "local"
    media_dir: str = "media"
    s3_endpoint_url: str = ""  # R2: https://<account id>.r2.cloudflarestorage.com. Empty for AWS.
    s3_region: str = "auto"  # "auto" for R2; e.g. "af-south-1" for AWS Cape Town
    s3_bucket: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    # Where browsers fetch photos from, e.g. https://photos.runstride.app or an r2.dev URL
    s3_public_base_url: str = ""
    # Manual ID checks: ID photos and selfies go in a separate, PRIVATE bucket (no public access, no
    # custom domain). Same endpoint and region as the photo bucket, its own bucket and keys.
    id_bucket: str = ""
    id_access_key_id: str = ""
    id_secret_access_key: str = ""
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
    # ID verification is optional by default: people who verify get a badge. Turn this on to make it
    # a gate (unverified people can't match or see others).
    require_id_verification: bool = False
    # Declined/failed inquiries allowed before the user has to contact support
    max_verification_attempts: int = 3

    # Chat rate limits. New accounts get a tighter hourly cap (a common spam/scam pattern).
    messages_per_minute: int = 20
    new_account_hours: int = 24
    new_account_messages_per_hour: int = 30

    # Hide someone from Discover once this many different people have open reports against them
    report_auto_hide_threshold: int = 3

    # Base URL for links people outside the app open (run tracking pages). Empty: use the
    # address the request came in on. Set to the public HTTPS domain in production.
    public_base_url: str = ""

    # Payments. Store purchases arrive from RevenueCat's webhook, which sends this exact value
    # as its Authorization header (set the same value in RevenueCat's dashboard).
    revenuecat_webhook_auth: str = ""
    # Development only: buy Plus and race passes in the app without a store or a charge
    test_purchases: bool = True

    # Push notifications: "console" (development: printed to the logs) or "expo" (Expo's push
    # service, which delivers to Apple and Google). EXPO_ACCESS_TOKEN is optional (only needed
    # if "enhanced push security" is turned on in the Expo account).
    push_provider: str = "console"
    expo_access_token: str = ""
    # Browser notifications (Web Push). Make a key pair once with scripts/make_vapid_keys.py.
    # Empty: the web app doesn't offer notifications.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:support@runstride.co.za"

    # Google sign-in: the OAuth client IDs (web, iOS, Android) that ID tokens may be issued to.
    # Empty: Google sign-in is switched off.
    google_client_ids: list[str] = []

    # Expo web dev server origins
    cors_origins: list[str] = ["http://localhost:8081", "http://localhost:19006"]

    @field_validator("database_url")
    @classmethod
    def use_psycopg3(cls, url: str) -> str:
        """Hosts like Railway give "postgresql://..." or "postgres://...": we use the psycopg 3 driver."""
        for plain in ("postgres://", "postgresql://"):
            if url.startswith(plain):
                return "postgresql+psycopg://" + url[len(plain):]
        return url

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    @property
    def id_check_enabled(self) -> bool:
        return bool(self.id_bucket and self.id_access_key_id and self.id_secret_access_key)

    def model_post_init(self, __context) -> None:
        if not self.is_development and self.secret_key == DEV_SECRET_KEY:
            raise ValueError("SECRET_KEY must be set outside development")
        if not self.is_development and self.photo_storage == "local":
            # Hosted servers lose local files on every deploy
            raise ValueError("PHOTO_STORAGE must be s3 outside development")
        if not self.is_development and self.sms_provider != "bulksms":
            raise ValueError("SMS_PROVIDER must be bulksms outside development")
        if not self.is_development and not (
            self.s3_bucket and self.s3_public_base_url and self.s3_access_key_id and self.s3_secret_access_key
        ):
            # Better to refuse to start than to fail on every photo upload
            raise ValueError(
                "S3_BUCKET, S3_PUBLIC_BASE_URL, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set outside development"
            )
        if not self.is_development and self.test_purchases:
            # Free Plus for anyone who asks: never outside development
            self.test_purchases = False


@lru_cache
def get_settings() -> Settings:
    return Settings()

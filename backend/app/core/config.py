"""Settings, read from the environment only.

Production refuses to start with insecure values, so a missing or placeholder secret fails loudly
at boot instead of quietly running in an unsafe state.
"""

from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

Environment = Literal["development", "test", "production"]

# Values from .env.example. Production must never run with them.
PLACEHOLDER_MARKER = "local-dev-only"
MIN_SECRET_KEY_LENGTH = 32

# Cloudflare's published Turnstile test secret: always passes. Fine locally, refused in production.
# https://developers.cloudflare.com/turnstile/troubleshooting/testing/
TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA"  # noqa: S105 - public test key
TURNSTILE_TEST_SECRET_PREFIXES = ("1x0000", "2x0000", "3x0000")


def _split_csv(value: object) -> object:
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    environment: Environment = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    database_url: SecretStr = SecretStr(
        "postgresql+asyncpg://dearlly:local-dev-only-not-a-secret@localhost:5432/dearlly"
    )
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")
    secret_key: SecretStr = SecretStr("local-dev-only-not-a-secret-change-on-server")

    allowed_hosts: Annotated[list[str], NoDecode] = ["localhost", "127.0.0.1", "testserver"]
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3100"]
    public_web_url: str = "http://localhost:3100"

    # "log" writes emails to the log (local only); "resend" sends them for real.
    email_delivery: Literal["log", "resend"] = "log"
    resend_api_key: SecretStr | None = None
    email_from: str = "Dearlly <hello@dearlly.localhost>"
    # Where reports about letters go, for the founder to review.
    reports_to: str = "hello@dearlly.app"

    turnstile_secret_key: SecretStr = SecretStr(TURNSTILE_TEST_SECRET)

    # Header carrying the visitor's real IP when behind a proxy (Cloudflare: CF-Connecting-IP).
    # Empty means "use the direct connection address".
    client_ip_header: str = ""

    # Where browsers reach the API (Google sends people back here after they sign in).
    public_api_url: str = "http://localhost:8100"
    # "Continue with Google": off until both are set (Google Cloud console, Stage 3).
    google_client_id: str = ""
    google_client_secret: SecretStr | None = None

    # Photos. "local" keeps them in a folder (development and tests only); "r2" uses the private
    # Cloudflare R2 bucket. In production photos stay off until the R2 settings are all set.
    photo_storage: Literal["local", "r2"] = "local"
    photo_dir: str = "/data/photos"
    r2_endpoint: str = ""
    r2_photos_bucket: str = ""
    r2_photos_access_key_id: str = ""
    r2_photos_secret_access_key: SecretStr | None = None
    nsfw_model_path: str = "/app/models/marqo-nsfw-384.onnx"

    # Error alerts (Sentry, EU). Off when unset. APP_VERSION is the deployed commit.
    sentry_dsn: SecretStr | None = None
    app_version: str = ""

    _split_hosts = field_validator("allowed_hosts", "cors_origins", mode="before")(_split_csv)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def google_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def r2_configured(self) -> bool:
        return bool(
            self.r2_endpoint
            and self.r2_photos_bucket
            and self.r2_photos_access_key_id
            and self.r2_photos_secret_access_key
        )

    @property
    def photos_enabled(self) -> bool:
        if self.photo_storage == "r2":
            return self.r2_configured
        # A folder on the server is never used for real people's photos.
        return not self.is_production

    @property
    def cookie_secure(self) -> bool:
        # Local development runs on plain http://localhost.
        return self.is_production

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> "Settings":
        if not self.is_production:
            return self
        problems = insecure_production_settings(self)
        if problems:
            raise ValueError("Refusing to start in production: " + "; ".join(problems))
        return self


def insecure_production_settings(settings: Settings) -> list[str]:
    problems: list[str] = []
    secret = settings.secret_key.get_secret_value()
    if PLACEHOLDER_MARKER in secret or len(secret) < MIN_SECRET_KEY_LENGTH:
        problems.append(f"SECRET_KEY must be a real random value of {MIN_SECRET_KEY_LENGTH}+ chars")
    if PLACEHOLDER_MARKER in settings.database_url.get_secret_value():
        problems.append("DATABASE_URL still uses the local placeholder password")
    if not settings.allowed_hosts or any("*" in host for host in settings.allowed_hosts):
        problems.append("ALLOWED_HOSTS must list exact host names (no wildcards)")
    if not settings.cors_origins:
        problems.append("CORS_ORIGINS must list the web app origin")
    for origin in settings.cors_origins:
        if "*" in origin or urlparse(origin).scheme != "https":
            problems.append(f"CORS origin {origin!r} must be an exact https:// origin")
    if urlparse(settings.public_web_url).scheme != "https":
        problems.append("PUBLIC_WEB_URL must use https://")
    if urlparse(settings.public_api_url).scheme != "https":
        problems.append("PUBLIC_API_URL must use https://")
    if settings.turnstile_secret_key.get_secret_value().startswith(TURNSTILE_TEST_SECRET_PREFIXES):
        problems.append("TURNSTILE_SECRET_KEY is Cloudflare's test key")
    if settings.email_delivery != "resend" or settings.resend_api_key is None:
        problems.append("EMAIL_DELIVERY must be resend, with RESEND_API_KEY set")
    if "localhost" in settings.email_from:
        problems.append("EMAIL_FROM must be a real sender address")
    return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()

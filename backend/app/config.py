"""Application settings, loaded from environment variables / `.env`."""

from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BASE_DIR / "data"

# Schemes that name Postgres without a driver. Supabase (and most hosted
# providers) hand these out; we default them to psycopg 3, which ships with the
# app. An explicit suffix such as ``postgresql+psycopg2`` is left untouched.
_POSTGRES_BARE_SCHEMES = ("postgres://", "postgresql://")


def normalise_database_url(value: str) -> str:
    """Point a bare Postgres URL at the bundled psycopg (v3) driver."""
    lowered = value.lower()
    for scheme in _POSTGRES_BARE_SCHEMES:
        if lowered.startswith(scheme):
            return "postgresql+psycopg://" + value[len(scheme) :]
    return value


class Settings(BaseSettings):
    """Runtime configuration.

    Every value can be overridden with an ``EE_``-prefixed environment
    variable, e.g. ``EE_DATABASE_URL``. See ``.env.example``.
    """

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_prefix="EE_",
        extra="ignore",
    )

    database_url: str = f"sqlite:///{DEFAULT_DATA_DIR / 'engineering_efficiency.db'}"
    frontend_dist: Path = BASE_DIR.parent / "frontend" / "dist"
    linear_api_url: str = "https://api.linear.app/graphql"
    cors_origins: list[str] = ["http://localhost:5173"]
    # Signs the session cookie. When empty, a key is generated and persisted
    # next to the SQLite file so logins survive process restarts.
    secret_key: str = ""
    # Set true when the app is served over HTTPS so the session cookie is
    # marked Secure.
    session_secure: bool = False

    @field_validator("database_url", mode="before")
    @classmethod
    def _default_postgres_driver(cls, value: object) -> object:
        if isinstance(value, str):
            return normalise_database_url(value)
        return value


settings = Settings()

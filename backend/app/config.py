"""Application settings, loaded from environment variables / `.env`."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = BASE_DIR / "data"


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


settings = Settings()

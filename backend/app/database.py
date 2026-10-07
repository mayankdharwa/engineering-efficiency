"""SQLite / SQLAlchemy engine and session management."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import DEFAULT_DATA_DIR, settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _ensure_sqlite_dir(database_url: str) -> None:
    """Make sure the directory for a file-based SQLite DB exists."""
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return
    db_path = Path(database_url[len(prefix) :])
    if db_path.is_absolute():
        db_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_dir(settings.database_url)

_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(settings.database_url, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create any missing tables and columns. Called on application startup."""
    from . import models  # noqa: F401  (import registers the tables)

    Base.metadata.create_all(bind=engine)
    _add_missing_sqlite_columns()


def _add_missing_sqlite_columns() -> None:
    """Add columns introduced after a table was first created.

    SQLite has limited ``ALTER TABLE`` support, and SQLAlchemy's ``create_all``
    never alters existing tables. This adds any nullable columns declared on the
    models that are missing from an existing database.
    """
    if engine.dialect.name != "sqlite":
        return

    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    with engine.begin() as connection:
        # `counts_toward_capacity` is NOT NULL, so it cannot use the generic
        # nullable-column path below. Add it with a default and backfill from the
        # member's assignability/active state.
        member_columns = {col["name"] for col in inspector.get_columns("team_members")}
        if "counts_toward_capacity" not in member_columns:
            connection.execute(
                text(
                    'ALTER TABLE "team_members" ADD COLUMN "counts_toward_capacity" '
                    "BOOLEAN NOT NULL DEFAULT 1"
                )
            )
            connection.execute(
                text(
                    'UPDATE "team_members" SET "counts_toward_capacity" = '
                    'CASE WHEN "active" = 1 AND "is_assignable" = 1 THEN 1 ELSE 0 END'
                )
            )

        for table in Base.metadata.sorted_tables:
            existing = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                # Only nullable columns can be added safely without a default.
                if not column.nullable:
                    continue
                column_type = column.type.compile(engine.dialect)
                connection.execute(
                    text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {column_type}')
                )

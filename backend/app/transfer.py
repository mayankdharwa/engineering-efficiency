"""Shareable database snapshot: export and import everything except secrets.

The Linear API key (and the rest of ``linear_config``) stays on the machine that
owns it. Nested JSON payloads are scrubbed of common secret field names so a
token that landed in ``issues.raw`` is not copied into the file.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, delete, inspect, select, text
from sqlalchemy.orm import Session
from sqlalchemy.types import TypeDecorator

from .datetime_util import parse_iso_datetime
from .models import (
    CURRENT_SCHEMA_VERSION,
    AppSettings,
    Cycle,
    CycleMembership,
    Issue,
    MemberGroup,
    SyncRun,
    Team,
    TeamCost,
    TeamMember,
)

EXPORT_FORMAT = "engineering-efficiency-export"
EXPORT_VERSION = 1

# Tables that must never appear in a snapshot (secrets or local bookkeeping).
SECRET_TABLES = frozenset({"linear_config", "schema_version"})
SECRET_COLUMNS = frozenset({"api_key"})
SECRET_JSON_KEYS = frozenset(
    {
        "api_key",
        "apiKey",
        "access_token",
        "accessToken",
        "refresh_token",
        "refreshToken",
        "token",
        "secret",
        "password",
        "authorization",
    }
)

# Insert order is FK-safe. Delete uses the reverse.
EXPORT_MODELS = (
    AppSettings,
    Team,
    Cycle,
    TeamMember,
    MemberGroup,
    TeamCost,
    Issue,
    CycleMembership,
    SyncRun,
)
TABLE_NAMES = tuple(model.__tablename__ for model in EXPORT_MODELS)


class TransferError(ValueError):
    """The snapshot file is missing, incompatible, or not JSON we can apply."""


@dataclass(frozen=True)
class ImportResult:
    teams: int
    cycles: int
    issues: int
    members: int


def export_snapshot(db: Session) -> dict[str, Any]:
    """Build a JSON-ready snapshot of every shareable table."""
    tables: dict[str, list[dict[str, Any]]] = {}
    for model in EXPORT_MODELS:
        rows = db.scalars(select(model).order_by(model.id)).all()
        tables[model.__tablename__] = [_row_to_dict(row) for row in rows]
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "schema_version": CURRENT_SCHEMA_VERSION,
        "exported_at": datetime.now(UTC).isoformat(),
        "tables": tables,
    }


def import_snapshot(db: Session, payload: object) -> ImportResult:
    """Replace shareable tables with ``payload``. Leaves ``linear_config`` alone."""
    tables = _parse_export(payload)
    try:
        _replace_shareable(db, tables)
        _reset_sqlite_sequences(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return ImportResult(
        teams=len(tables["teams"]),
        cycles=len(tables["cycles"]),
        issues=len(tables["issues"]),
        members=len(tables["team_members"]),
    )


def _parse_export(payload: object) -> dict[str, list[dict[str, Any]]]:
    if not isinstance(payload, dict):
        raise TransferError("Import file must be a JSON object.")
    if payload.get("format") != EXPORT_FORMAT:
        raise TransferError("This file is not an Engineering Efficiency export.")
    if payload.get("version") != EXPORT_VERSION:
        raise TransferError(
            f"Unsupported export format version {payload.get('version')!r}."
        )
    schema_version = payload.get("schema_version")
    if schema_version != CURRENT_SCHEMA_VERSION:
        raise TransferError(
            f"This file was exported from schema version {schema_version}; "
            f"this app is on version {CURRENT_SCHEMA_VERSION}."
        )
    raw_tables = payload.get("tables")
    if not isinstance(raw_tables, dict):
        raise TransferError("Export is missing a tables object.")

    tables: dict[str, list[dict[str, Any]]] = {}
    missing = [name for name in TABLE_NAMES if name not in raw_tables]
    if missing:
        raise TransferError(f"Export is missing tables: {', '.join(missing)}.")
    for name in TABLE_NAMES:
        rows = raw_tables[name]
        if not isinstance(rows, list):
            raise TransferError(f"Table {name} must be a list of rows.")
        parsed: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise TransferError(f"Table {name} row {index} is not an object.")
            parsed.append(row)
        tables[name] = parsed
    return tables


def _replace_shareable(db: Session, tables: dict[str, list[dict[str, Any]]]) -> None:
    for model in reversed(EXPORT_MODELS):
        db.execute(delete(model))
    db.flush()

    for model in EXPORT_MODELS:
        for row in tables[model.__tablename__]:
            db.add(model(**_coerce_row(model, row)))
        db.flush()


def _row_to_dict(row: object) -> dict[str, Any]:
    mapper = inspect(row).mapper
    payload: dict[str, Any] = {}
    for column in mapper.columns:
        if column.name in SECRET_COLUMNS:
            continue
        value = getattr(row, column.name)
        if isinstance(value, datetime):
            payload[column.name] = value.isoformat()
        else:
            payload[column.name] = _scrub(value)
    return payload


def _coerce_row(model: type, data: dict[str, Any]) -> dict[str, Any]:
    mapper = inspect(model)
    coerced: dict[str, Any] = {}
    for column in mapper.columns:
        if column.name in SECRET_COLUMNS or column.name not in data:
            continue
        value = _scrub(data[column.name])
        if value is not None and _is_datetime_column(column):
            coerced[column.name] = _parse_dt(value)
        else:
            coerced[column.name] = value
    return coerced


def _is_datetime_column(column: object) -> bool:
    typ = column.type
    if isinstance(typ, TypeDecorator):
        typ = typ.impl
    return isinstance(typ, DateTime)


def _parse_dt(value: object) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
    if isinstance(value, str):
        parsed = parse_iso_datetime(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    raise TransferError(f"Invalid datetime value: {value!r}")


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _scrub(item)
            for key, item in value.items()
            if key not in SECRET_JSON_KEYS
        }
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _reset_sqlite_sequences(db: Session) -> None:
    bind = db.get_bind()
    if bind.dialect.name != "sqlite":
        return
    exists = db.scalar(
        text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'")
    )
    if not exists:
        return
    for model in EXPORT_MODELS:
        table = model.__tablename__
        max_id = db.scalar(text(f"SELECT MAX(id) FROM {table}")) or 0
        db.execute(text("DELETE FROM sqlite_sequence WHERE name = :name"), {"name": table})
        if max_id:
            db.execute(
                text("INSERT INTO sqlite_sequence (name, seq) VALUES (:name, :seq)"),
                {"name": table, "seq": max_id},
            )

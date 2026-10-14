"""SQLite / SQLAlchemy engine and session management."""

from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import DateTime, Engine, Integer, create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from .config import DEFAULT_DATA_DIR, settings


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


class IntegerPK(TypeDecorator):
    """Integer primary-key values that survive SQLite TEXT column affinity.

    Older databases stored ``teams.current_cycle_id`` as a Linear string, then
    migrated the *value* to an integer without rebuilding the column. SQLite
    keeps TEXT affinity, so a later read can come back as ``\"1\"``. Comparing
    that to ``cycles.id`` (a real integer) is false in Python and makes the
    current cycle look historical.
    """

    impl = Integer
    cache_ok = True

    def process_bind_param(self, value: int | str | None, dialect: object) -> int | None:
        if value is None or value == "":
            return None
        return int(value)

    def process_result_value(self, value: int | str | None, dialect: object) -> int | None:
        if value is None or value == "":
            return None
        return int(value)


class UTCDateTime(TypeDecorator):
    """A ``DateTime`` that always stores and returns timezone-aware UTC values.

    SQLite has no native timezone support and drops ``tzinfo``, so SQLAlchemy
    hands back naive datetimes. Browsers parse a timezone-less string as *local*
    time, which shifts calendar dates by a day in non-UTC timezones. This
    decorator normalises values to UTC on the way in and re-attaches UTC on the
    way out, so the API never emits naive timestamps.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: object) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: object) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


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


def _enable_sqlite_foreign_keys(dbapi_connection: object, _connection_record: object) -> None:
    """Enforce FOREIGN KEY clauses on every SQLite connection."""
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


if settings.database_url.startswith("sqlite"):
    event.listen(engine, "connect", _enable_sqlite_foreign_keys)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a scoped database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create any missing tables and run one-shot schema migrations."""
    from . import models  # noqa: F401  (import registers the tables)
    from .models import CURRENT_SCHEMA_VERSION

    Base.metadata.create_all(bind=engine)
    _migrate_to_cycle_hub()
    _add_missing_sqlite_columns()
    _add_member_group_color_column()
    _add_project_excluded_column()
    _add_user_role_column()
    _migrate_member_roles_to_groups()
    _migrate_to_cycle_memberships()
    _set_schema_version(engine, CURRENT_SCHEMA_VERSION)


def _schema_version(target_engine: Engine) -> int:
    inspector = inspect(target_engine)
    if "schema_version" not in inspector.get_table_names():
        return 0
    with target_engine.connect() as connection:
        value = connection.execute(
            text("SELECT version FROM schema_version WHERE id = 1")
        ).scalar()
    return int(value or 0)


def _set_schema_version(target_engine: Engine, version: int) -> None:
    with target_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO schema_version (id, version) VALUES (1, :version) "
                "ON CONFLICT(id) DO UPDATE SET version = :version"
            ),
            {"version": version},
        )


def _needs_cycle_hub_migration(target_engine: Engine) -> bool:
    """True when this database still has the pre-hub cycle schema."""
    from .models import CURRENT_SCHEMA_VERSION

    if _schema_version(target_engine) >= CURRENT_SCHEMA_VERSION:
        return False
    inspector = inspect(target_engine)
    names = set(inspector.get_table_names())
    if "cycle_settings" in names:
        return True
    if "issues" in names:
        columns = {column["name"] for column in inspector.get_columns("issues")}
        if "cycle_name" in columns:
            return True
    return False


def _migrate_to_cycle_hub(target_engine: Engine | None = None) -> None:
    """Promote ``cycle_settings`` + string ``cycle_id`` columns into ``cycles``.

    SQLite cannot change unique constraints or column types in place, so issues
    and member_unavailability are rebuilt. Safe to call on a fresh database
    (no-op when the old tables/columns are already gone).
    """
    migration_engine = target_engine or engine
    if migration_engine.dialect.name != "sqlite":
        return
    if not _needs_cycle_hub_migration(migration_engine):
        return

    inspector = inspect(migration_engine)
    names = set(inspector.get_table_names())

    # SQLite auto-commits DDL (CREATE/DROP/ALTER), so this cannot live in a
    # single SQLAlchemy transaction. Each step commits on its own.
    with migration_engine.connect() as connection:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.commit()

        if "cycles" not in names:
            connection.execute(
                text(
                    "CREATE TABLE cycles ("
                    "id INTEGER NOT NULL PRIMARY KEY, "
                    "team_id INTEGER NOT NULL, "
                    "linear_id VARCHAR(64) NOT NULL, "
                    "name VARCHAR(255), "
                    "number INTEGER, "
                    "starts_at DATETIME, "
                    "ends_at DATETIME, "
                    "working_days FLOAT, "
                    "dates_overridden BOOLEAN NOT NULL DEFAULT 0, "
                    "archived_at DATETIME, "
                    "created_at DATETIME, "
                    "updated_at DATETIME, "
                    "FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE CASCADE, "
                    "UNIQUE (team_id, linear_id)"
                    ")"
                )
            )

        if "cycle_settings" in names:
            existing = connection.execute(text("SELECT COUNT(*) FROM cycles")).scalar()
            if not existing:
                connection.execute(
                    text(
                        "INSERT INTO cycles ("
                        "id, team_id, linear_id, name, number, starts_at, ends_at, "
                        "working_days, dates_overridden, archived_at, created_at, updated_at"
                        ") SELECT id, team_id, cycle_id, cycle_name, "
                        "CAST(cycle_number AS INTEGER), starts_at, ends_at, "
                        "working_days, dates_overridden, archived_at, created_at, updated_at "
                        "FROM cycle_settings"
                    )
                )
                connection.commit()

        # Stub cycles for leftover string cycle_ids that have no settings row.
        if "issues" in names:
            orphans = connection.execute(
                text(
                    "SELECT DISTINCT i.team_id, i.cycle_id FROM issues i "
                    "LEFT JOIN cycles c ON c.team_id = i.team_id "
                    "AND c.linear_id = i.cycle_id "
                    "WHERE i.cycle_id IS NOT NULL AND i.cycle_id != '' AND c.id IS NULL"
                )
            ).fetchall()
            for team_id, linear_id in orphans:
                connection.execute(
                    text(
                        "INSERT INTO cycles "
                        "(team_id, linear_id, dates_overridden, created_at, updated_at) "
                        "VALUES (:team_id, :linear_id, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ),
                    {"team_id": team_id, "linear_id": linear_id},
                )
            connection.commit()

        if "member_unavailability" in names:
            orphans = connection.execute(
                text(
                    "SELECT DISTINCT u.team_id, u.cycle_id FROM member_unavailability u "
                    "LEFT JOIN cycles c ON c.team_id = u.team_id "
                    "AND c.linear_id = u.cycle_id "
                    "WHERE u.cycle_id IS NOT NULL AND u.cycle_id != '' AND c.id IS NULL"
                )
            ).fetchall()
            for team_id, linear_id in orphans:
                connection.execute(
                    text(
                        "INSERT INTO cycles "
                        "(team_id, linear_id, dates_overridden, created_at, updated_at) "
                        "VALUES (:team_id, :linear_id, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ),
                    {"team_id": team_id, "linear_id": linear_id},
                )
            connection.commit()

        if "teams" in names:
            sample = connection.execute(
                text(
                    "SELECT typeof(current_cycle_id) FROM teams "
                    "WHERE current_cycle_id IS NOT NULL LIMIT 1"
                )
            ).scalar()
            if sample == "text":
                connection.execute(
                    text(
                        "UPDATE teams SET current_cycle_id = ("
                        "SELECT c.id FROM cycles c "
                        "WHERE c.team_id = teams.id AND c.linear_id = teams.current_cycle_id"
                        ")"
                    )
                )
                connection.commit()

        if "issues" in names:
            issue_columns = {column["name"] for column in inspector.get_columns("issues")}
            if "cycle_name" in issue_columns or _column_type_is_text(
                inspector, "issues", "cycle_id"
            ):
                _rebuild_issues_table(connection)

        if "member_unavailability" in names:
            unavail_columns = {
                column["name"] for column in inspector.get_columns("member_unavailability")
            }
            if "member_id" not in unavail_columns or _column_type_is_text(
                inspector, "member_unavailability", "cycle_id"
            ):
                _rebuild_unavailability_table(connection)

        if "cycle_settings" in names:
            connection.execute(text("DROP TABLE cycle_settings"))

        connection.execute(text("PRAGMA foreign_keys=ON"))
        connection.commit()


def _column_type_is_text(inspector: object, table: str, column: str) -> bool:
    columns = inspector.get_columns(table)  # type: ignore[attr-defined]
    for item in columns:
        if item["name"] == column:
            type_name = str(item["type"]).upper()
            return "CHAR" in type_name or "TEXT" in type_name or "VARCHAR" in type_name
    return False


def _commit(connection: object) -> None:
    commit = getattr(connection, "commit", None)
    if commit is not None:
        commit()


def _rebuild_issues_table(connection: object) -> None:
    connection.execute(  # type: ignore[attr-defined]
        text(
            "CREATE TABLE issues_new ("
            "id INTEGER NOT NULL PRIMARY KEY, "
            "linear_id VARCHAR(64) NOT NULL, "
            "team_id INTEGER NOT NULL, "
            "cycle_id INTEGER, "
            "identifier VARCHAR(64) NOT NULL, "
            "title TEXT NOT NULL, "
            "description TEXT, "
            "state_name VARCHAR(128), "
            "state_type VARCHAR(64), "
            "priority FLOAT, "
            "estimate FLOAT, "
            "assignee_linear_id VARCHAR(64), "
            "assignee_name VARCHAR(255), "
            "creator_name VARCHAR(255), "
            "project_name VARCHAR(255), "
            "labels JSON, "
            "added_to_cycle_at DATETIME, "
            "created_at DATETIME, "
            "updated_at DATETIME, "
            "started_at DATETIME, "
            "completed_at DATETIME, "
            "canceled_at DATETIME, "
            "archived_at DATETIME, "
            "raw JSON, "
            "FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE CASCADE, "
            "FOREIGN KEY(cycle_id) REFERENCES cycles (id) ON DELETE CASCADE, "
            "UNIQUE (cycle_id, linear_id)"
            ")"
        )
    )
    _commit(connection)
    connection.execute(  # type: ignore[attr-defined]
        text(
            "INSERT INTO issues_new ("
            "id, linear_id, team_id, cycle_id, identifier, title, description, "
            "state_name, state_type, priority, estimate, assignee_linear_id, "
            "assignee_name, creator_name, project_name, labels, added_to_cycle_at, "
            "created_at, updated_at, started_at, completed_at, canceled_at, "
            "archived_at, raw"
            ") SELECT i.id, i.linear_id, i.team_id, c.id, i.identifier, i.title, "
            "i.description, i.state_name, i.state_type, i.priority, i.estimate, "
            "i.assignee_linear_id, i.assignee_name, i.creator_name, i.project_name, "
            "i.labels, i.added_to_cycle_at, i.created_at, i.updated_at, i.started_at, "
            "i.completed_at, i.canceled_at, i.archived_at, i.raw "
            "FROM issues i "
            "LEFT JOIN cycles c ON c.team_id = i.team_id AND c.linear_id = i.cycle_id"
        )
    )
    _commit(connection)
    connection.execute(text("DROP TABLE issues"))  # type: ignore[attr-defined]
    connection.execute(text("ALTER TABLE issues_new RENAME TO issues"))  # type: ignore[attr-defined]
    _commit(connection)
    for statement in (
        "CREATE INDEX ix_issues_linear_id ON issues (linear_id)",
        "CREATE INDEX ix_issues_team_id ON issues (team_id)",
        "CREATE INDEX ix_issues_state_type ON issues (state_type)",
        "CREATE INDEX ix_issues_assignee_linear_id ON issues (assignee_linear_id)",
        "CREATE INDEX ix_issues_project_name ON issues (project_name)",
        "CREATE INDEX ix_issues_cycle_id ON issues (cycle_id)",
        "CREATE INDEX ix_issues_team_id_cycle_id ON issues (team_id, cycle_id)",
    ):
        connection.execute(text(statement))  # type: ignore[attr-defined]
        _commit(connection)


def _rebuild_unavailability_table(connection: object) -> None:
    connection.execute(  # type: ignore[attr-defined]
        text(
            "CREATE TABLE member_unavailability_new ("
            "id INTEGER NOT NULL PRIMARY KEY, "
            "team_id INTEGER NOT NULL, "
            "cycle_id INTEGER NOT NULL, "
            "member_id INTEGER, "
            "member_linear_id VARCHAR(64) NOT NULL, "
            "unavailable_days FLOAT NOT NULL DEFAULT 0, "
            "created_at DATETIME, "
            "updated_at DATETIME, "
            "FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE CASCADE, "
            "FOREIGN KEY(cycle_id) REFERENCES cycles (id) ON DELETE CASCADE, "
            "FOREIGN KEY(member_id) REFERENCES team_members (id) ON DELETE SET NULL, "
            "UNIQUE (cycle_id, member_linear_id)"
            ")"
        )
    )
    _commit(connection)
    connection.execute(  # type: ignore[attr-defined]
        text(
            "INSERT INTO member_unavailability_new ("
            "id, team_id, cycle_id, member_id, member_linear_id, "
            "unavailable_days, created_at, updated_at"
            ") SELECT u.id, u.team_id, c.id, m.id, u.member_linear_id, "
            "u.unavailable_days, u.created_at, u.updated_at "
            "FROM member_unavailability u "
            "JOIN cycles c ON c.team_id = u.team_id AND c.linear_id = u.cycle_id "
            "LEFT JOIN team_members m ON m.team_id = u.team_id "
            "AND m.linear_id = u.member_linear_id"
        )
    )
    _commit(connection)
    connection.execute(text("DROP TABLE member_unavailability"))  # type: ignore[attr-defined]
    connection.execute(  # type: ignore[attr-defined]
        text("ALTER TABLE member_unavailability_new RENAME TO member_unavailability")
    )
    _commit(connection)
    for statement in (
        "CREATE INDEX ix_member_unavailability_team_id ON member_unavailability (team_id)",
        "CREATE INDEX ix_member_unavailability_cycle_id ON member_unavailability (cycle_id)",
        "CREATE INDEX ix_member_unavailability_member_id ON member_unavailability (member_id)",
        "CREATE INDEX ix_member_unavailability_member_linear_id "
        "ON member_unavailability (member_linear_id)",
    ):
        connection.execute(text(statement))  # type: ignore[attr-defined]
        _commit(connection)


def _migrate_member_roles_to_groups(target_engine: Engine | None = None) -> None:
    """Turn legacy per-member DEV/QA role tags into per-team groups.

    Earlier versions stored a free-text ``role`` directly on ``team_members``.
    Groups are now rows in ``member_groups`` with a ``group_id`` reference, so
    on an existing SQLite database we create a group per distinct role and
    reassign members. Clearing ``role`` afterwards keeps this idempotent.
    """
    migration_engine = target_engine or engine
    if migration_engine.dialect.name != "sqlite":
        return

    inspector = inspect(migration_engine)
    if "team_members" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("team_members")}
    if "role" not in columns or "group_id" not in columns:
        return

    with migration_engine.begin() as connection:
        rows = connection.execute(
            text("SELECT id, team_id, role FROM team_members WHERE role IS NOT NULL")
        ).fetchall()
        if not rows:
            return

        for member_id, team_id, role in rows:
            connection.execute(
                text(
                    "INSERT OR IGNORE INTO member_groups "
                    "(team_id, name, created_at, updated_at) "
                    "VALUES (:team_id, :name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {"team_id": team_id, "name": role},
            )
            group_id = connection.execute(
                text(
                    "SELECT id FROM member_groups "
                    "WHERE team_id = :team_id AND name = :name"
                ),
                {"team_id": team_id, "name": role},
            ).scalar()
            connection.execute(
                text("UPDATE team_members SET group_id = :group_id WHERE id = :id"),
                {"group_id": group_id, "id": member_id},
            )

        connection.execute(
            text("UPDATE team_members SET role = NULL WHERE role IS NOT NULL")
        )


def _migrate_to_cycle_memberships(target_engine: Engine | None = None) -> None:
    """Move group, capacity and leave onto per-cycle snapshot rows."""
    from .models import CURRENT_SCHEMA_VERSION

    migration_engine = target_engine or engine
    if migration_engine.dialect.name != "sqlite":
        return
    if _schema_version(migration_engine) >= CURRENT_SCHEMA_VERSION:
        return

    inspector = inspect(migration_engine)
    names = set(inspector.get_table_names())
    member_columns = (
        {column["name"] for column in inspector.get_columns("team_members")}
        if "team_members" in names
        else set()
    )
    if "member_unavailability" not in names and "group_id" not in member_columns:
        return

    with migration_engine.connect() as connection:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        connection.commit()
        if "cycle_memberships" not in names:
            connection.execute(
                text(
                    "CREATE TABLE cycle_memberships ("
                    "id INTEGER NOT NULL PRIMARY KEY, "
                    "team_id INTEGER NOT NULL, "
                    "cycle_id INTEGER NOT NULL, "
                    "member_id INTEGER, "
                    "member_linear_id VARCHAR(64) NOT NULL, "
                    "group_id INTEGER, "
                    "counts_toward_capacity BOOLEAN NOT NULL DEFAULT 1, "
                    "unavailable_days FLOAT NOT NULL DEFAULT 0, "
                    "created_at DATETIME, "
                    "updated_at DATETIME, "
                    "FOREIGN KEY(team_id) REFERENCES teams (id) ON DELETE CASCADE, "
                    "FOREIGN KEY(cycle_id) REFERENCES cycles (id) ON DELETE CASCADE, "
                    "FOREIGN KEY(member_id) REFERENCES team_members (id) ON DELETE SET NULL, "
                    "FOREIGN KEY(group_id) REFERENCES member_groups (id) ON DELETE SET NULL, "
                    "UNIQUE (cycle_id, member_linear_id)"
                    ")"
                )
            )
            connection.commit()

        existing = connection.execute(text("SELECT COUNT(*) FROM cycle_memberships")).scalar()
        if not existing and "cycles" in names and "team_members" in names:
            has_counts = "counts_toward_capacity" in member_columns
            has_group = "group_id" in member_columns
            counts_expr = (
                "COALESCE(t.counts_toward_capacity, 1)" if has_counts else "1"
            )
            group_expr = "t.group_id" if has_group else "NULL"
            leave_join = (
                "LEFT JOIN member_unavailability u ON u.team_id = t.team_id "
                "AND u.cycle_id = c.id AND u.member_linear_id = t.linear_id"
                if "member_unavailability" in names
                else ""
            )
            leave_expr = (
                "COALESCE(u.unavailable_days, 0)"
                if "member_unavailability" in names
                else "0"
            )
            connection.execute(
                text(
                    "INSERT INTO cycle_memberships ("
                    "team_id, cycle_id, member_id, member_linear_id, group_id, "
                    "counts_toward_capacity, unavailable_days, created_at, updated_at"
                    f") SELECT t.team_id, c.id, t.id, t.linear_id, {group_expr}, "
                    f"{counts_expr}, {leave_expr}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP "
                    "FROM team_members t "
                    "JOIN cycles c ON c.team_id = t.team_id "
                    f"{leave_join}"
                )
            )
            connection.commit()

        if "member_unavailability" in names:
            connection.execute(text("DROP TABLE member_unavailability"))
            connection.commit()

        for column in ("group_id", "counts_toward_capacity"):
            if column in member_columns:
                try:
                    connection.execute(
                        text(f'ALTER TABLE team_members DROP COLUMN "{column}"')
                    )
                    connection.commit()
                except Exception:
                    connection.rollback()

        connection.execute(text("PRAGMA foreign_keys=ON"))
        connection.commit()


def _add_member_group_color_column() -> None:
    """Add ``member_groups.color`` to databases created before group colours."""
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "member_groups" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("member_groups")}
    if "color" in columns:
        return
    with engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE member_groups "
                "ADD COLUMN color VARCHAR(7) NOT NULL DEFAULT '#d97706'"
            )
        )


def _add_user_role_column() -> None:
    """Add ``users.role`` to databases created before ADMIN / READER roles."""
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("users")}
    if "role" in columns:
        return
    with engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE users "
                "ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'admin'"
            )
        )


def _add_project_excluded_column() -> None:
    """Add ``projects.excluded`` to databases created before local exclude/include."""
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    if "projects" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("projects")}
    if "excluded" in columns:
        return
    with engine.begin() as connection:
        if "hidden" in columns:
            connection.execute(text("ALTER TABLE projects RENAME COLUMN hidden TO excluded"))
            return
        connection.execute(
            text(
                "ALTER TABLE projects "
                "ADD COLUMN excluded BOOLEAN NOT NULL DEFAULT 0"
            )
        )


def _add_missing_sqlite_columns() -> None:
    """Add columns introduced after a table was first created.

    SQLite has limited ``ALTER TABLE`` support, and SQLAlchemy's ``create_all``
    never alters existing tables. This adds any nullable columns declared on the
    models that are missing from an existing database.
    """
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if table.name not in inspector.get_table_names():
                continue
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

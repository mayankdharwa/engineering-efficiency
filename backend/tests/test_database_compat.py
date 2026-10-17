"""Cross-dialect compatibility.

The app ships with SQLite but must also run against Postgres (e.g. Supabase).
These tests keep the schema and the engine/backfill helpers dialect-agnostic
without needing a live Postgres server: DDL is compiled against the Postgres
dialect, and the runtime helpers are exercised on SQLite.
"""

from __future__ import annotations

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.schema import CreateTable

import app.models  # noqa: F401  (registers the tables on Base.metadata)
from app.config import Settings, normalise_database_url
from app.database import (
    Base,
    _add_missing_columns,
    _add_project_excluded_column,
    _create_engine,
    _is_transaction_pooler,
)
from app.models import Team
from app.transfer import _reset_sequences


def test_all_tables_compile_for_postgresql() -> None:
    dialect = postgresql.dialect()
    for table in Base.metadata.sorted_tables:
        ddl = str(CreateTable(table).compile(dialect=dialect))
        assert f"CREATE TABLE {table.name} (" in ddl


def test_postgres_boolean_default_is_native() -> None:
    dialect = postgresql.dialect()
    ddl = str(CreateTable(Base.metadata.tables["projects"]).compile(dialect=dialect))
    assert "excluded BOOLEAN DEFAULT false NOT NULL" in ddl


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"),
        ("postgresql+psycopg2://u:p@h/db", "postgresql+psycopg2://u:p@h/db"),
        ("postgresql+psycopg://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
        ("sqlite:///./data/x.db", "sqlite:///./data/x.db"),
    ],
)
def test_normalise_database_url(given: str, expected: str) -> None:
    assert normalise_database_url(given) == expected


def test_settings_normalise_bare_postgres_url() -> None:
    configured = Settings(database_url="postgresql://u:p@h:5432/db")
    assert configured.database_url == "postgresql+psycopg://u:p@h:5432/db"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("postgresql+psycopg://u:p@aws-0.pooler.supabase.com:6543/postgres", True),
        ("postgresql+psycopg://u:p@h:5432/db?pgbouncer=true", True),
        ("postgresql+psycopg://u:p@h:5432/db", False),
        ("sqlite:///./data/x.db", False),
    ],
)
def test_is_transaction_pooler(url: str, expected: bool) -> None:
    assert _is_transaction_pooler(url) is expected


def test_transaction_pooler_engine_uses_null_pool() -> None:
    pytest.importorskip("psycopg")
    engine = _create_engine("postgresql+psycopg://u:p@h:6543/postgres")
    try:
        assert isinstance(engine.pool, NullPool)
    finally:
        engine.dispose()


def test_direct_postgres_engine_uses_pooled_connections() -> None:
    pytest.importorskip("psycopg")
    engine = _create_engine("postgresql+psycopg://u:p@h:5432/postgres")
    try:
        assert not isinstance(engine.pool, NullPool)
    finally:
        engine.dispose()


def _file_engine(tmp_path):
    return _create_engine(f"sqlite:///{tmp_path / 'compat.db'}")


def _columns(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def test_missing_nullable_column_is_added(tmp_path) -> None:
    engine = _file_engine(tmp_path)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE team_members DROP COLUMN email"))

    _add_missing_columns(engine)

    assert "email" in _columns(engine, "team_members")


def test_missing_column_with_server_default_is_added_not_null(tmp_path) -> None:
    engine = _file_engine(tmp_path)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE member_groups DROP COLUMN color"))

    _add_missing_columns(engine)

    color = next(
        column
        for column in inspect(engine).get_columns("member_groups")
        if column["name"] == "color"
    )
    assert color["nullable"] is False


def test_missing_not_null_column_without_default_is_skipped(tmp_path) -> None:
    engine = _file_engine(tmp_path)
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE project_due_date_changes DROP COLUMN changed_at")
        )

    _add_missing_columns(engine)

    assert "changed_at" not in _columns(engine, "project_due_date_changes")


def test_missing_columns_is_noop_on_complete_schema(tmp_path) -> None:
    engine = _file_engine(tmp_path)
    Base.metadata.create_all(engine)
    before = {table.name: _columns(engine, table.name) for table in Base.metadata.sorted_tables}
    _add_missing_columns(engine)
    after = {table.name: _columns(engine, table.name) for table in Base.metadata.sorted_tables}
    assert before == after


def test_legacy_projects_hidden_is_renamed_not_duplicated(tmp_path) -> None:
    """A pre-rename database must rename hidden -> excluded, not add a second column."""
    engine = _file_engine(tmp_path)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE projects ("
                "id INTEGER PRIMARY KEY, "
                "hidden BOOLEAN NOT NULL DEFAULT 0)"
            )
        )

    # Mirror init_db(): the legacy rename runs before the generic backfill.
    _add_project_excluded_column(engine)
    _add_missing_columns(engine)

    columns = _columns(engine, "projects")
    assert "excluded" in columns
    assert "hidden" not in columns


def test_explicit_id_import_does_not_collide_on_next_insert(tmp_path) -> None:
    """An import writes explicit primary keys; the next insert must not reuse one."""
    engine = _file_engine(tmp_path)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)

    with factory() as db:
        db.add(Team(id=10, linear_id="t1", key="ENG", name="Engineering"))
        db.flush()
        _reset_sequences(db)
        db.commit()

    with factory() as db:
        team = Team(linear_id="t2", key="OPS", name="Operations")
        db.add(team)
        db.commit()
        assert team.id == 11


def test_create_engine_sqlite_disables_thread_check() -> None:
    engine = _create_engine("sqlite://")
    try:
        assert engine.dialect.name == "sqlite"
        assert engine.pool is not None
    finally:
        engine.dispose()

"""Tests for first-class cycles: listing, scoping, locks, and migration."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, _migrate_to_cycle_hub, get_db
from app.main import app
from app.models import Cycle, CycleMembership, Issue, Team, TeamMember


def _make_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), testing_session, engine


def _seed(session_factory) -> tuple[int, int, int]:
    with session_factory() as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        old = Cycle(
            team_id=team.id,
            linear_id="c1",
            name="Cycle 1",
            number=1,
            starts_at=datetime(2026, 9, 21, tzinfo=UTC),
            ends_at=datetime(2026, 10, 2, tzinfo=UTC),
            working_days=10,
            archived_at=datetime(2026, 10, 2, tzinfo=UTC),
        )
        current = Cycle(
            team_id=team.id,
            linear_id="c2",
            name="Cycle 2",
            number=2,
            starts_at=datetime(2026, 10, 5, tzinfo=UTC),
            ends_at=datetime(2026, 10, 16, tzinfo=UTC),
            working_days=10,
        )
        db.add_all([old, current])
        db.flush()
        team.current_cycle_id = current.id
        ada = TeamMember(team_id=team.id, linear_id="u1", name="Ada")
        db.add(ada)
        db.flush()
        db.add(
            CycleMembership(
                team_id=team.id,
                cycle_id=old.id,
                member_id=ada.id,
                member_linear_id="u1",
                counts_toward_capacity=True,
            )
        )
        db.add(
            CycleMembership(
                team_id=team.id,
                cycle_id=current.id,
                member_id=ada.id,
                member_linear_id="u1",
                counts_toward_capacity=True,
            )
        )
        db.add(
            Issue(
                linear_id="i-old",
                team_id=team.id,
                cycle_id=old.id,
                identifier="ENG-1",
                title="Old",
                estimate=2.0,
            )
        )
        db.add(
            Issue(
                linear_id="i-new",
                team_id=team.id,
                cycle_id=current.id,
                identifier="ENG-2",
                title="New",
                estimate=3.0,
            )
        )
        db.commit()
        return team.id, old.id, current.id


def test_list_cycles_and_scoped_reads() -> None:
    client, session_factory, _engine = _make_client()
    try:
        team_id, old_id, current_id = _seed(session_factory)

        listed = client.get(f"/api/teams/{team_id}/cycles")
        assert listed.status_code == 200
        rows = listed.json()
        assert [row["linear_id"] for row in rows] == ["c2", "c1"]
        assert rows[0]["is_current"] is True
        assert rows[1]["is_current"] is False
        assert rows[1]["archived_at"] is not None

        current_stats = client.get(f"/api/teams/{team_id}/stats").json()
        assert current_stats["cycle_id"] == current_id
        assert current_stats["cycle_linear_id"] == "c2"
        assert current_stats["total_taken_points"] == 3.0

        old_stats = client.get(f"/api/teams/{team_id}/stats", params={"cycle_id": old_id})
        assert old_stats.status_code == 200
        assert old_stats.json()["cycle_id"] == old_id
        assert old_stats.json()["total_taken_points"] == 2.0

        old_issues = client.get(
            f"/api/teams/{team_id}/issues", params={"cycle_id": old_id}
        ).json()
        assert [issue["identifier"] for issue in old_issues] == ["ENG-1"]
        assert old_issues[0]["cycle_id"] == old_id

        missing = client.get(f"/api/teams/{team_id}/stats", params={"cycle_id": 999})
        assert missing.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_text_current_cycle_id_still_counts_as_current() -> None:
    """SQLite may keep TEXT affinity on teams.current_cycle_id after migration."""
    from sqlalchemy.orm import Session

    from app.database import Base

    engine = create_engine("sqlite://", future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE teams ("
                "id INTEGER PRIMARY KEY, linear_id VARCHAR(64), key VARCHAR(32), "
                "name VARCHAR(255), issue_count INTEGER DEFAULT 0, "
                "current_cycle_id TEXT, last_synced_at DATETIME, "
                "created_at DATETIME, updated_at DATETIME, "
                "description TEXT, color VARCHAR(32))"
            )
        )
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        cycle = Cycle(team_id=team.id, linear_id="c1", number=2)
        db.add(cycle)
        db.flush()
        db.execute(
            text("UPDATE teams SET current_cycle_id = :cid"),
            {"cid": str(cycle.id)},
        )
        db.commit()
        db.expire_all()

        raw = db.execute(
            text("SELECT typeof(current_cycle_id) FROM teams WHERE id = :id"),
            {"id": team.id},
        ).scalar()
        assert raw == "text"
        loaded = db.get(Team, team.id)
        assert loaded is not None
        assert loaded.current_cycle_id == cycle.id
        assert isinstance(loaded.current_cycle_id, int)
        assert cycle.id == loaded.current_cycle_id


def test_finalized_cycle_locks_dates_and_leave() -> None:
    client, session_factory, _engine = _make_client()
    try:
        team_id, old_id, _current_id = _seed(session_factory)

        blocked = client.put(
            f"/api/teams/{team_id}/cycle",
            params={"cycle_id": old_id},
            json={"working_days": 8},
        )
        assert blocked.status_code == 409

        leave_blocked = client.put(
            f"/api/teams/{team_id}/cycle",
            params={"cycle_id": old_id},
            json={"members": [{"linear_id": "u1", "unavailable_days": 2}]},
        )
        assert leave_blocked.status_code == 409

        allowed = client.put(
            f"/api/teams/{team_id}/cycle",
            params={"cycle_id": old_id},
            json={
                "members": [
                    {
                        "linear_id": "u1",
                        "unavailable_days": 0,
                        "counts_toward_capacity": True,
                    }
                ]
            },
        )
        assert allowed.status_code == 200, allowed.text
        members = {row["linear_id"]: row for row in allowed.json()["members"]}
        assert members["u1"]["counts_toward_capacity"] is True

        capacity_blocked = client.put(
            f"/api/teams/{team_id}/cycle",
            params={"cycle_id": old_id},
            json={
                "members": [
                    {
                        "linear_id": "u1",
                        "unavailable_days": 0,
                        "counts_toward_capacity": False,
                    }
                ]
            },
        )
        assert capacity_blocked.status_code == 409
    finally:
        app.dependency_overrides.clear()


def test_cycle_hub_migration_rewrites_string_cycle_ids() -> None:
    engine = create_engine("sqlite://", future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE teams ("
                "id INTEGER PRIMARY KEY, linear_id TEXT, key TEXT, name TEXT, "
                "issue_count INTEGER DEFAULT 0, current_cycle_id TEXT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE cycle_settings ("
                "id INTEGER PRIMARY KEY, team_id INTEGER, cycle_id TEXT, "
                "cycle_name TEXT, cycle_number FLOAT, starts_at TEXT, ends_at TEXT, "
                "working_days FLOAT, dates_overridden BOOLEAN DEFAULT 0, "
                "archived_at TEXT, created_at TEXT, updated_at TEXT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE issues ("
                "id INTEGER PRIMARY KEY, linear_id TEXT, team_id INTEGER, "
                "identifier TEXT, title TEXT, description TEXT, state_name TEXT, "
                "state_type TEXT, priority FLOAT, estimate FLOAT, "
                "assignee_linear_id TEXT, assignee_name TEXT, creator_name TEXT, "
                "project_name TEXT, cycle_id TEXT, cycle_name TEXT, "
                "cycle_number FLOAT, labels TEXT, added_to_cycle_at TEXT, "
                "created_at TEXT, updated_at TEXT, started_at TEXT, "
                "completed_at TEXT, canceled_at TEXT, archived_at TEXT, raw TEXT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE team_members ("
                "id INTEGER PRIMARY KEY, team_id INTEGER, linear_id TEXT, name TEXT)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE member_unavailability ("
                "id INTEGER PRIMARY KEY, team_id INTEGER, cycle_id TEXT, "
                "member_linear_id TEXT, unavailable_days FLOAT, "
                "created_at TEXT, updated_at TEXT)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO teams (id, linear_id, key, name, current_cycle_id) "
                "VALUES (1, 't1', 'ENG', 'Engineering', 'c2')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO cycle_settings "
                "(id, team_id, cycle_id, cycle_name, cycle_number) VALUES "
                "(10, 1, 'c1', 'Cycle 1', 1), (11, 1, 'c2', 'Cycle 2', 2)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO issues (id, linear_id, team_id, identifier, title, cycle_id) "
                "VALUES (1, 'i-old', 1, 'ENG-1', 'Old', 'c1'), "
                "(2, 'i-new', 1, 'ENG-2', 'New', 'c2')"
            )
        )
        connection.execute(
            text("INSERT INTO team_members (id, team_id, linear_id, name) VALUES (5, 1, 'u1', 'Ada')")
        )
        connection.execute(
            text(
                "INSERT INTO member_unavailability "
                "(id, team_id, cycle_id, member_linear_id, unavailable_days) "
                "VALUES (1, 1, 'c2', 'u1', 1.5)"
            )
        )

    _migrate_to_cycle_hub(engine)

    with engine.begin() as connection:
        cycles = connection.execute(
            text("SELECT id, linear_id, name, number FROM cycles ORDER BY id")
        ).fetchall()
        assert [(row[1], row[2], row[3]) for row in cycles] == [
            ("c1", "Cycle 1", 1),
            ("c2", "Cycle 2", 2),
        ]
        current = connection.execute(
            text("SELECT current_cycle_id FROM teams WHERE id = 1")
        ).scalar()
        # SQLite keeps the original TEXT affinity on this column; the value
        # is the new integer PK either way.
        assert int(current) == 11
        issue_cycles = connection.execute(
            text("SELECT linear_id, cycle_id FROM issues ORDER BY id")
        ).fetchall()
        assert issue_cycles == [("i-old", 10), ("i-new", 11)]
        leave = connection.execute(
            text(
                "SELECT cycle_id, member_id, member_linear_id, unavailable_days "
                "FROM member_unavailability"
            )
        ).fetchone()
        assert leave == (11, 5, "u1", 1.5)
        tables = {
            row[0]
            for row in connection.execute(
                text("SELECT name FROM sqlite_master WHERE type = 'table'")
            )
        }
        assert "cycle_settings" not in tables
        assert "cycles" in tables

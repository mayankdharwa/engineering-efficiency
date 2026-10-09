"""Tests for fluid per-team member groups and the legacy role migration."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, _migrate_member_roles_to_groups, get_db
from app.main import app
from app.models import CycleSettings, Team, TeamMember


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


def _seed_team(session_factory) -> int:
    with session_factory() as db:
        team = Team(
            linear_id="t1", key="ENG", name="Engineering", current_cycle_id="c1"
        )
        db.add(team)
        db.commit()
        db.add(TeamMember(team_id=team.id, linear_id="u1", name="Ada"))
        db.add(TeamMember(team_id=team.id, linear_id="u2", name="Grace"))
        db.add(
            CycleSettings(
                team_id=team.id,
                cycle_id="c1",
                starts_at=datetime(2026, 10, 5, tzinfo=UTC),
                ends_at=datetime(2026, 10, 16, tzinfo=UTC),
                working_days=10,
            )
        )
        db.commit()
        return team.id


def test_group_crud_and_member_assignment() -> None:
    client, session_factory, _engine = _make_client()
    try:
        team_id = _seed_team(session_factory)

        backend = client.post(
            f"/api/teams/{team_id}/groups", json={"name": "Backend"}
        )
        assert backend.status_code == 201, backend.text
        backend_id = backend.json()["id"]
        frontend_id = client.post(
            f"/api/teams/{team_id}/groups", json={"name": "Frontend"}
        ).json()["id"]

        # Duplicate and blank names are rejected.
        assert (
            client.post(
                f"/api/teams/{team_id}/groups", json={"name": "Backend"}
            ).status_code
            == 400
        )
        assert (
            client.post(
                f"/api/teams/{team_id}/groups", json={"name": "   "}
            ).status_code
            == 400
        )

        listed = client.get(f"/api/teams/{team_id}/cycle").json()
        assert [group["name"] for group in listed["groups"]] == [
            "Backend",
            "Frontend",
        ]

        # Assign each member to one group.
        response = client.put(
            f"/api/teams/{team_id}/cycle",
            json={
                "members": [
                    {"linear_id": "u1", "unavailable_days": 0, "group_id": backend_id},
                    {"linear_id": "u2", "unavailable_days": 0, "group_id": frontend_id},
                ]
            },
        )
        assert response.status_code == 200, response.text
        members = {m["linear_id"]: m for m in response.json()["members"]}
        assert members["u1"]["group_id"] == backend_id
        assert members["u1"]["group_name"] == "Backend"

        # A group from another team is rejected.
        assert (
            client.put(
                f"/api/teams/{team_id}/cycle",
                json={
                    "members": [
                        {"linear_id": "u1", "unavailable_days": 0, "group_id": 9999}
                    ]
                },
            ).status_code
            == 400
        )

        # Stats expose one row per group plus an Unassigned bucket.
        stats = client.get(f"/api/teams/{team_id}/stats").json()
        assert {row["label"] for row in stats["groups"]} == {
            "Backend",
            "Frontend",
        }

        # Rename and delete.
        renamed = client.put(
            f"/api/teams/{team_id}/groups/{backend_id}", json={"name": "Platform"}
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Platform"
        assert (
            client.delete(f"/api/teams/{team_id}/groups/{frontend_id}").status_code
            == 204
        )

        after = client.get(f"/api/teams/{team_id}/cycle").json()
        members = {m["linear_id"]: m for m in after["members"]}
        assert members["u2"]["group_id"] is None

        stats = client.get(f"/api/teams/{team_id}/stats").json()
        labels = {row["label"]: row for row in stats["groups"]}
        assert "Platform" in labels
        assert labels["Unassigned"]["members"] == 1
    finally:
        app.dependency_overrides.clear()


def test_migration_converts_roles_to_groups() -> None:
    engine = create_engine("sqlite://", future=True)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE team_members ("
                "id INTEGER PRIMARY KEY, team_id INTEGER, role TEXT, group_id INTEGER)"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE member_groups ("
                "id INTEGER PRIMARY KEY, team_id INTEGER, name TEXT, "
                "created_at TEXT, updated_at TEXT, "
                "UNIQUE (team_id, name))"
            )
        )
        connection.execute(
            text(
                "INSERT INTO team_members (id, team_id, role) VALUES "
                "(1, 10, 'DEV'), (2, 10, 'QA'), (3, 10, 'DEV'), (4, 10, NULL)"
            )
        )

    _migrate_member_roles_to_groups(engine)

    with engine.begin() as connection:
        groups = connection.execute(
            text("SELECT id, name FROM member_groups ORDER BY id")
        ).fetchall()
        assert [name for _id, name in groups] == ["DEV", "QA"]
        dev_id, qa_id = groups[0][0], groups[1][0]
        rows = connection.execute(
            text("SELECT id, group_id, role FROM team_members ORDER BY id")
        ).fetchall()
        assert rows == [
            (1, dev_id, None),
            (2, qa_id, None),
            (3, dev_id, None),
            (4, None, None),
        ]

    # Running again is a no-op.
    _migrate_member_roles_to_groups(engine)
    with engine.begin() as connection:
        assert (
            connection.execute(text("SELECT COUNT(*) FROM member_groups")).scalar() == 2
        )

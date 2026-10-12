"""Tests for shareable database export / import."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import (
    AppSettings,
    Cycle,
    CycleMembership,
    Issue,
    LinearConfig,
    MemberGroup,
    Project,
    ProjectIssue,
    Team,
    TeamCost,
    TeamMember,
)

SECRET_KEY = "lin_api_do_not_export_this_secret"


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
    return TestClient(app), testing_session


def _seed(session_factory) -> None:
    with session_factory() as db:
        db.add(
            LinearConfig(
                id=1,
                api_key=SECRET_KEY,
                viewer_name="Ada",
                viewer_email="ada@example.com",
                organization_name="Acme",
            )
        )
        db.add(AppSettings(id=1, timezone="Asia/Kolkata", day_cutoff_hour=19))
        team = Team(id=1, linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        cycle = Cycle(
            id=1,
            team_id=team.id,
            linear_id="c1",
            name="Cycle 2",
            number=2,
            starts_at=datetime(2026, 10, 4, tzinfo=UTC),
            ends_at=datetime(2026, 10, 15, tzinfo=UTC),
            working_days=10,
        )
        db.add(cycle)
        db.flush()
        team.current_cycle_id = cycle.id
        group = MemberGroup(id=1, team_id=team.id, name="Backend")
        member = TeamMember(
            id=1,
            team_id=team.id,
            linear_id="u1",
            name="Ada Lovelace",
            email="ada@example.com",
        )
        db.add_all([group, member])
        db.flush()
        db.add(
            CycleMembership(
                id=1,
                team_id=team.id,
                cycle_id=cycle.id,
                member_id=member.id,
                member_linear_id="u1",
                group_id=group.id,
                counts_toward_capacity=True,
                unavailable_days=1,
            )
        )
        db.add(TeamCost(id=1, team_id=team.id, currency="₹", man_day_cost=20000))
        db.add(
            Issue(
                id=1,
                linear_id="i1",
                team_id=team.id,
                cycle_id=cycle.id,
                identifier="ENG-1",
                title="Ship export",
                labels=["tooling"],
                raw={"id": "i1", "title": "Ship export", "apiKey": SECRET_KEY},
            )
        )
        project = Project(id=1, team_id=team.id, linear_id="p1", name="Platform")
        db.add(project)
        db.flush()
        db.add(
            ProjectIssue(
                id=1,
                team_id=team.id,
                project_id=project.id,
                linear_id="i1",
                identifier="ENG-1",
                title="Ship export",
                estimate=4.0,
            )
        )
        db.commit()


def test_export_omits_linear_key_and_nested_secrets() -> None:
    client, sessions = _make_client()
    _seed(sessions)

    response = client.get("/api/config/export")
    assert response.status_code == 200
    body = response.text
    assert SECRET_KEY not in body
    assert "api_key" not in body
    assert "linear_config" not in body

    payload = response.json()
    assert payload["format"] == "engineering-efficiency-export"
    assert "linear_config" not in payload["tables"]
    assert payload["tables"]["teams"][0]["name"] == "Engineering"
    raw = payload["tables"]["issues"][0]["raw"]
    assert "apiKey" not in raw
    assert raw["title"] == "Ship export"
    assert "filename=" in response.headers.get("content-disposition", "")


def test_import_replaces_shareable_data_and_keeps_local_key() -> None:
    client, sessions = _make_client()
    _seed(sessions)

    exported = client.get("/api/config/export").json()

    with sessions() as db:
        team = db.get(Team, 1)
        assert team is not None
        team.name = "Mutated"
        config = db.get(LinearConfig, 1)
        assert config is not None
        config.api_key = "lin_api_importer_own_key"
        config.viewer_name = "Importer"
        config.organization_name = "Other Org"
        db.commit()

    imported = client.post("/api/config/import", json=exported)
    assert imported.status_code == 200, imported.text
    assert imported.json() == {
        "ok": True,
        "teams": 1,
        "cycles": 1,
        "issues": 1,
        "members": 1,
        "projects": 1,
    }

    with sessions() as db:
        config = db.get(LinearConfig, 1)
        assert config is not None
        assert config.api_key == "lin_api_importer_own_key"
        assert config.viewer_name == "Importer"
        team = db.get(Team, 1)
        assert team is not None
        assert team.name == "Engineering"
        assert team.current_cycle_id == 1
        issue = db.get(Issue, 1)
        assert issue is not None
        assert issue.title == "Ship export"
        assert "apiKey" not in (issue.raw or {})
        cost = db.scalar(select(TeamCost))
        assert cost is not None
        assert cost.currency == "₹"
        membership = db.scalar(select(CycleMembership))
        assert membership is not None
        assert membership.unavailable_days == 1
        settings = db.get(AppSettings, 1)
        assert settings is not None
        assert settings.timezone == "Asia/Kolkata"
        project = db.get(Project, 1)
        assert project is not None
        assert project.name == "Platform"
        project_issue = db.get(ProjectIssue, 1)
        assert project_issue is not None
        assert project_issue.estimate == 4.0


def test_import_round_trip_preserves_shareable_tables() -> None:
    client, sessions = _make_client()
    _seed(sessions)

    first = client.get("/api/config/export").json()
    assert client.post("/api/config/import", json=first).status_code == 200
    second = client.get("/api/config/export").json()
    first.pop("exported_at")
    second.pop("exported_at")
    assert first == second


def test_import_rejects_unknown_format_and_schema() -> None:
    client, _sessions = _make_client()

    bad_format = client.post("/api/config/import", json={"hello": "world"})
    assert bad_format.status_code == 400
    assert "not an Engineering Efficiency export" in bad_format.json()["detail"]

    empty = {
        "format": "engineering-efficiency-export",
        "version": 1,
        "schema_version": 1,
        "tables": {name: [] for name in (
            "app_settings",
            "teams",
            "cycles",
            "team_members",
            "member_groups",
            "team_costs",
            "issues",
            "cycle_memberships",
            "sync_runs",
        )},
    }
    mismatch = client.post("/api/config/import", json=empty)
    assert mismatch.status_code == 400
    assert "schema version 1" in mismatch.json()["detail"]


def test_import_ignores_linear_config_smuggled_in_file() -> None:
    client, sessions = _make_client()
    _seed(sessions)
    exported = client.get("/api/config/export").json()
    exported["tables"]["linear_config"] = [
        {"id": 1, "api_key": "lin_api_smuggled_key", "viewer_name": "Eve"}
    ]

    with sessions() as db:
        config = db.get(LinearConfig, 1)
        assert config is not None
        config.api_key = "lin_api_importer_own_key"
        db.commit()

    assert client.post("/api/config/import", json=exported).status_code == 200
    with sessions() as db:
        config = db.get(LinearConfig, 1)
        assert config is not None
        assert config.api_key == "lin_api_importer_own_key"
    later = json.dumps(client.get("/api/config/export").json())
    assert "lin_api_smuggled_key" not in later
    assert "lin_api_importer_own_key" not in later

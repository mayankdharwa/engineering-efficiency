"""Tests for project sync and point-based project cost."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Cycle, Issue, Project, ProjectIssue, Team, TeamCost
from app.projects import compute_team_project_costs
from app.sync import sync_team_projects


class _FakeProjectClient:
    def __init__(self, projects: list[dict], issues: list[dict]) -> None:
        self._projects = projects
        self._issues = issues

    def team_projects(self, team_id: str) -> list[dict]:
        return self._projects

    def team_project_issues(self, team_id: str) -> list[dict]:
        return self._issues


def _session() -> Session:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    return Session(engine)


def _add_team(db: Session) -> Team:
    team = Team(linear_id="t1", key="ENG", name="Engineering")
    db.add(team)
    db.flush()
    return team


def test_sync_upserts_replaces_and_drops_stale_projects() -> None:
    with _session() as db:
        team = _add_team(db)
        stale = Project(team_id=team.id, linear_id="p-old", name="Old")
        db.add(stale)
        db.flush()
        db.add(
            ProjectIssue(
                team_id=team.id,
                project_id=stale.id,
                linear_id="i-old",
                identifier="ENG-0",
                title="Gone",
                estimate=8.0,
            )
        )
        db.commit()

        client = _FakeProjectClient(
            [{"id": "p1", "name": "Alpha", "state": "started"}],
            [
                {
                    "id": "i1",
                    "identifier": "ENG-1",
                    "title": "Work",
                    "estimate": 4.0,
                    "state": {"name": "In Progress", "type": "started"},
                    "project": {"id": "p1", "name": "Alpha"},
                }
            ],
        )
        summary = sync_team_projects(db, client, team)
        assert summary.projects_synced == 1
        assert summary.issues_synced == 1

        projects = list(db.scalars(select(Project).where(Project.team_id == team.id)).all())
        assert [row.linear_id for row in projects] == ["p1"]
        assert projects[0].name == "Alpha"
        issues = list(db.scalars(select(ProjectIssue)).all())
        assert len(issues) == 1
        assert issues[0].identifier == "ENG-1"

        client = _FakeProjectClient(
            [{"id": "p1", "name": "Alpha renamed", "state": "completed"}],
            [
                {
                    "id": "i2",
                    "identifier": "ENG-2",
                    "title": "Replacement",
                    "estimate": 2.0,
                    "state": {"name": "Todo", "type": "unstarted"},
                    "project": {"id": "p1", "name": "Alpha renamed"},
                }
            ],
        )
        sync_team_projects(db, client, team)
        project = db.scalar(select(Project).where(Project.linear_id == "p1"))
        assert project is not None
        assert project.name == "Alpha renamed"
        assert project.state == "completed"
        replacements = list(db.scalars(select(ProjectIssue)).all())
        assert [row.identifier for row in replacements] == ["ENG-2"]


def test_sync_skips_sub_issues() -> None:
    with _session() as db:
        team = _add_team(db)
        client = _FakeProjectClient(
            [{"id": "p1", "name": "Alpha"}],
            [
                {
                    "id": "parent",
                    "identifier": "ENG-1",
                    "title": "Parent",
                    "estimate": 5.0,
                    "project": {"id": "p1", "name": "Alpha"},
                },
                {
                    "id": "child",
                    "identifier": "ENG-2",
                    "title": "Child",
                    "estimate": 3.0,
                    "parent": {"id": "parent"},
                    "project": {"id": "p1", "name": "Alpha"},
                },
            ],
        )
        summary = sync_team_projects(db, client, team)
        assert summary.issues_synced == 1
        stored = list(db.scalars(select(ProjectIssue)).all())
        assert [row.linear_id for row in stored] == ["parent"]


def test_sync_keeps_cycle_issues_untouched() -> None:
    with _session() as db:
        team = _add_team(db)
        cycle = Cycle(team_id=team.id, linear_id="c1", name="Cycle 1")
        db.add(cycle)
        db.flush()
        db.add(
            Issue(
                linear_id="i-cycle",
                team_id=team.id,
                cycle_id=cycle.id,
                identifier="ENG-9",
                title="Cycle work",
                estimate=2.0,
            )
        )
        db.commit()

        client = _FakeProjectClient(
            [{"id": "p1", "name": "Alpha"}],
            [
                {
                    "id": "i-proj",
                    "identifier": "ENG-1",
                    "title": "Project work",
                    "estimate": 3.0,
                    "project": {"id": "p1", "name": "Alpha"},
                }
            ],
        )
        sync_team_projects(db, client, team)
        cycle_issue = db.scalar(select(Issue).where(Issue.linear_id == "i-cycle"))
        assert cycle_issue is not None
        assert cycle_issue.title == "Cycle work"
        assert cycle_issue.cycle_id == cycle.id


def test_sync_skips_archived_projects() -> None:
    with _session() as db:
        team = _add_team(db)
        stored = Project(team_id=team.id, linear_id="p-old", name="Was live")
        db.add(stored)
        db.flush()
        db.add(
            ProjectIssue(
                team_id=team.id,
                project_id=stored.id,
                linear_id="i-old",
                identifier="ENG-0",
                title="Old work",
                estimate=8.0,
            )
        )
        db.commit()

        client = _FakeProjectClient(
            [
                {
                    "id": "p-old",
                    "name": "Was live",
                    "archivedAt": "2026-01-01T00:00:00.000Z",
                },
                {"id": "p1", "name": "Active"},
            ],
            [
                {
                    "id": "i-arch",
                    "identifier": "ENG-9",
                    "title": "Archived project work",
                    "estimate": 5.0,
                    "project": {
                        "id": "p-old",
                        "name": "Was live",
                        "archivedAt": "2026-01-01T00:00:00.000Z",
                    },
                },
                {
                    "id": "i1",
                    "identifier": "ENG-1",
                    "title": "Live work",
                    "estimate": 2.0,
                    "project": {"id": "p1", "name": "Active"},
                },
            ],
        )
        summary = sync_team_projects(db, client, team)
        assert summary.projects_synced == 1
        assert summary.issues_synced == 1
        projects = list(db.scalars(select(Project).where(Project.team_id == team.id)).all())
        assert [row.linear_id for row in projects] == ["p1"]
        issues = list(db.scalars(select(ProjectIssue)).all())
        assert [row.identifier for row in issues] == ["ENG-1"]


def test_sync_creates_project_from_issue_only() -> None:
    with _session() as db:
        team = _add_team(db)
        client = _FakeProjectClient(
            [],
            [
                {
                    "id": "i1",
                    "identifier": "ENG-1",
                    "title": "Orphan",
                    "estimate": 1.0,
                    "project": {"id": "p-extra", "name": "From issue"},
                }
            ],
        )
        summary = sync_team_projects(db, client, team)
        assert summary.projects_synced == 1
        project = db.scalar(select(Project).where(Project.linear_id == "p-extra"))
        assert project is not None
        assert project.name == "From issue"


def test_cost_uses_half_man_day_and_excludes_canceled() -> None:
    with _session() as db:
        team = _add_team(db)
        db.add(TeamCost(team_id=team.id, currency="€", man_day_cost=1000))
        project = Project(team_id=team.id, linear_id="p1", name="Alpha")
        empty = Project(team_id=team.id, linear_id="p2", name="Empty")
        db.add_all([project, empty])
        db.flush()
        db.add_all(
            [
                ProjectIssue(
                    team_id=team.id,
                    project_id=project.id,
                    linear_id="i1",
                    identifier="ENG-1",
                    title="Open",
                    estimate=4.0,
                    state_type="started",
                ),
                ProjectIssue(
                    team_id=team.id,
                    project_id=project.id,
                    linear_id="i2",
                    identifier="ENG-2",
                    title="Done",
                    estimate=2.0,
                    state_type="completed",
                ),
                ProjectIssue(
                    team_id=team.id,
                    project_id=project.id,
                    linear_id="i3",
                    identifier="ENG-3",
                    title="Canceled",
                    estimate=10.0,
                    state_type="canceled",
                ),
                ProjectIssue(
                    team_id=team.id,
                    project_id=project.id,
                    linear_id="i4",
                    identifier="ENG-4",
                    title="Unestimated",
                    estimate=None,
                    state_type="unstarted",
                ),
                ProjectIssue(
                    team_id=team.id,
                    project_id=project.id,
                    linear_id="i5",
                    identifier="ENG-5",
                    title="Zero points",
                    estimate=0.0,
                    state_type="unstarted",
                ),
            ]
        )
        db.commit()

        views = compute_team_project_costs(db, team)
        by_name = {view.name: view for view in views}
        alpha = by_name["Alpha"]
        assert alpha.points == 6.0
        assert alpha.done_points == 2.0
        assert alpha.unestimated_issues == 1
        assert alpha.issue_count == 5
        assert alpha.cost == 3000.0
        assert alpha.currency == "€"
        assert by_name["Empty"].points == 0.0
        assert by_name["Empty"].cost == 0.0


def test_cost_excludes_archived_projects() -> None:
    with _session() as db:
        team = _add_team(db)
        db.add(TeamCost(team_id=team.id, currency="$", man_day_cost=200))
        live = Project(team_id=team.id, linear_id="p1", name="Live")
        archived = Project(
            team_id=team.id,
            linear_id="p2",
            name="Archived",
            archived_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        db.add_all([live, archived])
        db.flush()
        db.add_all(
            [
                ProjectIssue(
                    team_id=team.id,
                    project_id=live.id,
                    linear_id="i1",
                    identifier="ENG-1",
                    title="Live work",
                    estimate=2.0,
                ),
                ProjectIssue(
                    team_id=team.id,
                    project_id=archived.id,
                    linear_id="i2",
                    identifier="ENG-2",
                    title="Old work",
                    estimate=20.0,
                ),
            ]
        )
        db.commit()

        views = compute_team_project_costs(db, team)
        assert [view.name for view in views] == ["Live"]
        assert views[0].points == 2.0
        assert views[0].cost == 200.0


def test_cost_is_zero_without_man_day_config() -> None:
    with _session() as db:
        team = _add_team(db)
        project = Project(team_id=team.id, linear_id="p1", name="Alpha")
        db.add(project)
        db.flush()
        db.add(
            ProjectIssue(
                team_id=team.id,
                project_id=project.id,
                linear_id="i1",
                identifier="ENG-1",
                title="Work",
                estimate=4.0,
            )
        )
        db.commit()

        views = compute_team_project_costs(db, team)
        assert views[0].points == 4.0
        assert views[0].cost == 0.0
        assert views[0].man_day_cost == 0


def _api_client():
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


def test_projects_endpoint_returns_cost_totals() -> None:
    client, sessions = _api_client()
    with sessions() as db:
        team = _add_team(db)
        db.add(TeamCost(team_id=team.id, currency="$", man_day_cost=200))
        project = Project(team_id=team.id, linear_id="p1", name="Alpha")
        db.add(project)
        db.flush()
        db.add(
            ProjectIssue(
                team_id=team.id,
                project_id=project.id,
                linear_id="i1",
                identifier="ENG-1",
                title="Work",
                estimate=3.0,
                state_type="started",
            )
        )
        db.commit()
        team_id = team.id

    response = client.get(f"/api/teams/{team_id}/projects")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "Alpha"
    assert body[0]["points"] == 3.0
    assert body[0]["cost"] == 300.0
    assert body[0]["issues"][0]["identifier"] == "ENG-1"
    assert body[0]["excluded"] is False


def test_sync_preserves_excluded_flag() -> None:
    with _session() as db:
        team = _add_team(db)
        db.add(
            Project(
                team_id=team.id,
                linear_id="p1",
                name="Alpha",
                state="started",
                excluded=True,
            )
        )
        db.commit()

        client = _FakeProjectClient(
            [{"id": "p1", "name": "Alpha", "state": "completed"}],
            [],
        )
        sync_team_projects(db, client, team)
        stored = db.scalar(select(Project).where(Project.linear_id == "p1"))
        assert stored is not None
        assert stored.excluded is True
        assert stored.state == "completed"


def test_update_project_excluded() -> None:
    client, sessions = _api_client()
    with sessions() as db:
        team = _add_team(db)
        project = Project(team_id=team.id, linear_id="p1", name="Alpha", state="started")
        db.add(project)
        db.commit()
        team_id, project_id = team.id, project.id

    excluded = client.patch(
        f"/api/teams/{team_id}/projects/{project_id}",
        json={"excluded": True},
    )
    assert excluded.status_code == 200
    assert excluded.json()["excluded"] is True
    assert excluded.json()["state"] == "started"

    listed = client.get(f"/api/teams/{team_id}/projects")
    assert listed.json()[0]["excluded"] is True

    included = client.patch(
        f"/api/teams/{team_id}/projects/{project_id}",
        json={"excluded": False},
    )
    assert included.status_code == 200
    assert included.json()["excluded"] is False

    missing = client.patch(
        f"/api/teams/{team_id}/projects/999",
        json={"excluded": True},
    )
    assert missing.status_code == 404

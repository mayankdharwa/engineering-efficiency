"""Tests for project sync and point-based project cost."""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.linear_client import (
    PROJECT_HISTORY_QUERY,
    PROJECT_ISSUES_QUERY,
    TEAM_PROJECTS_QUERY,
    LinearClient,
    LinearError,
)
from app.main import app
from app.models import (
    AppSettings,
    Cycle,
    Issue,
    Project,
    ProjectDueDateChange,
    ProjectIssue,
    Team,
    TeamCost,
)
from app.projects import (
    HEALTH_AHEAD,
    HEALTH_LAGGING,
    HEALTH_ON_TRACK,
    compute_team_project_costs,
    project_schedule_health,
)
from app.sync import sync_team_projects
from tests.auth_helpers import authenticate


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


def test_sync_includes_issues_owned_by_another_team() -> None:
    class _CrossTeamClient(_FakeProjectClient):
        def project_issues(self, project_id: str) -> list[dict]:
            assert project_id == "p1"
            return [
                {
                    "id": "i-other",
                    "identifier": "DES-4",
                    "title": "Design work",
                    "estimate": 2.0,
                    "assignee": {"id": "u-other", "displayName": "Bea"},
                    "project": {"id": "p1", "name": "Alpha"},
                },
                {
                    "id": "i-child",
                    "identifier": "DES-5",
                    "title": "Nested design work",
                    "estimate": 1.0,
                    "parent": {"id": "i-other"},
                    "project": {"id": "p1", "name": "Alpha"},
                },
                {
                    "id": "i1",
                    "identifier": "ENG-1",
                    "title": "Work",
                    "estimate": 4.0,
                    "project": {"id": "p1", "name": "Alpha"},
                },
            ]

    with _session() as db:
        team = _add_team(db)
        client = _CrossTeamClient(
            [{"id": "p1", "name": "Alpha"}, {"id": "p-old", "name": "Gone", "archivedAt": "2026-01-01"}],
            [
                {
                    "id": "i1",
                    "identifier": "ENG-1",
                    "title": "Work",
                    "estimate": 4.0,
                    "project": {"id": "p1", "name": "Alpha"},
                }
            ],
        )
        summary = sync_team_projects(db, client, team)
        assert summary.issues_synced == 2
        stored = list(db.scalars(select(ProjectIssue).order_by(ProjectIssue.identifier)).all())
        assert [row.identifier for row in stored] == ["DES-4", "ENG-1"]
        assert stored[0].assignee_name == "Bea"
        assert stored[0].estimate == 2.0


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
        assert alpha.incurred_cost == 1000.0
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
    client = TestClient(app)
    authenticate(client)
    return client, testing_session


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
    assert body[0]["incurred_cost"] == 0.0
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


def _health(
    points: float,
    done_points: float,
    target_date: str | None,
    now: datetime,
) -> tuple[str | None, float | None, float | None]:
    return project_schedule_health(
        points=points,
        done_points=done_points,
        target_date=target_date,
        now=now,
        tz=ZoneInfo("UTC"),
        cutoff_hour=19,
    )


def test_project_health_requires_target_date() -> None:
    now = datetime(2026, 10, 14, 11, 0, tzinfo=UTC)
    assert _health(10, 2, None, now) == (None, None, None)
    assert _health(10, 2, "not-a-date", now) == (None, None, None)


def test_project_health_on_track_within_one_day_buffer() -> None:
    # Wednesday before cutoff; target Friday → 3 working days left.
    now = datetime(2026, 10, 14, 11, 0, tzinfo=UTC)
    # 6 remaining points need exactly 3 days → On Track; expected done = 10 - 6 = 4.
    assert _health(10, 4, "2026-10-16", now) == (HEALTH_ON_TRACK, 4.0, 3.0)
    # 1 day spare (4 remaining points / 2 days needed vs 3 left) stays On Track.
    assert _health(10, 6, "2026-10-16", now) == (HEALTH_ON_TRACK, 4.0, 3.0)
    # 1 day behind (8 remaining / 4 days needed vs 3 left) stays On Track.
    assert _health(10, 2, "2026-10-16", now) == (HEALTH_ON_TRACK, 4.0, 3.0)


def test_project_health_ahead_and_lagging_beyond_buffer() -> None:
    now = datetime(2026, 10, 14, 11, 0, tzinfo=UTC)
    # 2 remaining points need 1 day vs 3 left → 2 days spare → Ahead.
    assert _health(10, 8, "2026-10-16", now) == (HEALTH_AHEAD, 4.0, 3.0)
    # 10 remaining points need 5 days vs 3 left → 2 days short → Lagging.
    assert _health(10, 0, "2026-10-16", now) == (HEALTH_LAGGING, 4.0, 3.0)


def test_project_health_uses_cutoff_and_skips_weekends() -> None:
    after_cutoff = datetime(2026, 10, 14, 20, 0, tzinfo=UTC)
    # After Wednesday cutoff, Thu + Fri remain.
    health, expected, days = _health(10, 4, "2026-10-16", after_cutoff)
    assert days == 2.0
    assert expected == 6.0
    assert health == HEALTH_ON_TRACK

    friday = datetime(2026, 10, 16, 11, 0, tzinfo=UTC)
    # Friday through Monday is Fri + Mon.
    _, _, days = _health(4, 0, "2026-10-19", friday)
    assert days == 2.0


def test_project_costs_include_schedule_health() -> None:
    now = datetime(2026, 10, 14, 11, 0, tzinfo=UTC)
    with _session() as db:
        team = _add_team(db)
        project = Project(
            team_id=team.id,
            linear_id="p1",
            name="Alpha",
            target_date="2026-10-16",
        )
        db.add(project)
        db.flush()
        db.add(
            ProjectIssue(
                team_id=team.id,
                project_id=project.id,
                linear_id="i1",
                identifier="ENG-1",
                title="Work",
                estimate=10.0,
                state_type="started",
            )
        )
        db.commit()

        views = compute_team_project_costs(db, team, now=now)
        assert views[0].health == HEALTH_LAGGING
        assert views[0].expected_done_points == 4.0
        assert views[0].working_days_left == 3.0


def test_project_health_follows_app_timezone_and_cutoff() -> None:
    now = datetime(2026, 10, 14, 13, 30, tzinfo=UTC)  # 13:30 UTC == 19:00 IST
    with _session() as db:
        team = _add_team(db)
        project = Project(
            team_id=team.id,
            linear_id="p1",
            name="Alpha",
            target_date="2026-10-16",
        )
        db.add(project)
        db.flush()
        db.add(
            ProjectIssue(
                team_id=team.id,
                project_id=project.id,
                linear_id="i1",
                identifier="ENG-1",
                title="Work",
                estimate=10.0,
                state_type="started",
            )
        )
        db.commit()

        # Default settings are UTC / 19:00, so Wednesday still counts.
        utc_view = compute_team_project_costs(db, team, now=now)[0]
        assert utc_view.working_days_left == 3.0
        assert utc_view.expected_done_points == 4.0

        db.add(AppSettings(id=1, timezone="Asia/Kolkata", day_cutoff_hour=19))
        db.commit()
        ist_view = compute_team_project_costs(db, team, now=now)[0]
        assert ist_view.working_days_left == 2.0
        assert ist_view.expected_done_points == 6.0

        settings = db.get(AppSettings, 1)
        assert settings is not None
        settings.timezone = "UTC"
        settings.day_cutoff_hour = 12
        db.commit()
        early_cutoff = compute_team_project_costs(db, team, now=now)[0]
        assert early_cutoff.working_days_left == 2.0
        assert early_cutoff.expected_done_points == 6.0


def test_sync_stores_due_date_changes_and_replaces_them() -> None:
    with _session() as db:
        team = _add_team(db)
        client = _FakeProjectClient(
            [
                {
                    "id": "p1",
                    "name": "Alpha",
                    "state": "started",
                    "targetDate": "2026-05-01",
                    "history": {
                        "nodes": [
                            {
                                "id": "h1",
                                "createdAt": "2026-02-01T00:00:00.000Z",
                                "entries": {
                                    "targetDate": {"from": "2026-03-01", "to": "2026-04-01"},
                                    "state": {"from": "planned", "to": "started"},
                                },
                            },
                            {
                                "id": "h-noise",
                                "createdAt": "2026-02-02T00:00:00.000Z",
                                "entries": {"name": {"from": "Old", "to": "Alpha"}},
                            },
                        ],
                        "pageInfo": {"hasNextPage": False, "endCursor": None},
                    },
                }
            ],
            [],
        )
        sync_team_projects(db, client, team)
        stored = list(db.scalars(select(ProjectDueDateChange)).all())
        assert [(row.from_date, row.to_date) for row in stored] == [("2026-03-01", "2026-04-01")]

        client = _FakeProjectClient(
            [
                {
                    "id": "p1",
                    "name": "Alpha",
                    "targetDate": None,
                    "history": {
                        "nodes": [
                            {
                                "id": "h2",
                                "createdAt": "2026-04-01T00:00:00.000Z",
                                "entries": {
                                    "type": "targetDate",
                                    "from": "2026-04-01",
                                    "to": None,
                                },
                            }
                        ],
                        "pageInfo": {"hasNextPage": False},
                    },
                }
            ],
            [],
        )
        sync_team_projects(db, client, team)
        replaced = list(db.scalars(select(ProjectDueDateChange)).all())
        assert len(replaced) == 1
        assert replaced[0].linear_id == "h2"
        assert replaced[0].from_date == "2026-04-01"
        assert replaced[0].to_date is None


def test_sync_follows_due_date_history_pages() -> None:
    class _PagingClient(_FakeProjectClient):
        def project_history(self, project_id: str, after: str | None) -> dict:
            assert project_id == "p1"
            assert after == "cursor-1"
            return {
                "nodes": [
                    {
                        "id": "h2",
                        "createdAt": "2026-03-01T00:00:00.000Z",
                        "entries": [
                            {
                                "type": "targetDate",
                                "from": "2026-04-01",
                                "to": "2026-05-01",
                            }
                        ],
                    }
                ],
                "pageInfo": {"hasNextPage": False, "endCursor": None},
            }

    with _session() as db:
        team = _add_team(db)
        client = _PagingClient(
            [
                {
                    "id": "p1",
                    "name": "Alpha",
                    "targetDate": "2026-05-01",
                    "history": {
                        "nodes": [
                            {
                                "id": "h1",
                                "createdAt": "2026-01-15T00:00:00.000Z",
                                "entries": '{"targetDate":["2026-02-01","2026-04-01"]}',
                            }
                        ],
                        "pageInfo": {"hasNextPage": True, "endCursor": "cursor-1"},
                    },
                }
            ],
            [],
        )
        sync_team_projects(db, client, team)
        stored = list(
            db.scalars(
                select(ProjectDueDateChange).order_by(ProjectDueDateChange.changed_at)
            ).all()
        )
        assert [(row.from_date, row.to_date) for row in stored] == [
            ("2026-02-01", "2026-04-01"),
            ("2026-04-01", "2026-05-01"),
        ]


def test_project_trajectory_uses_activity_then_current_date() -> None:
    with _session() as db:
        team = _add_team(db)
        project = Project(
            team_id=team.id,
            linear_id="p1",
            name="Alpha",
            target_date="2026-06-01",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            last_synced_at=datetime(2026, 5, 1, tzinfo=UTC),
        )
        untouched = Project(
            team_id=team.id,
            linear_id="p2",
            name="Beta",
            target_date="2026-07-01",
            created_at=datetime(2026, 2, 1, tzinfo=UTC),
        )
        db.add_all([project, untouched])
        db.flush()
        db.add(
            ProjectDueDateChange(
                team_id=team.id,
                project_id=project.id,
                linear_id="h1",
                changed_at=datetime(2026, 3, 1, tzinfo=UTC),
                from_date="2026-04-01",
                to_date="2026-05-01",
                raw={"targetDate": {"from": "2026-04-01", "to": "2026-05-01"}},
            )
        )
        db.commit()

        views = {view.name: view for view in compute_team_project_costs(db, team)}
        alpha = views["Alpha"].due_date_history
        assert [(point.from_date, point.to_date, point.from_activity) for point in alpha] == [
            ("2026-04-01", "2026-05-01", True),
            ("2026-05-01", "2026-06-01", False),
        ]
        beta = views["Beta"].due_date_history
        assert len(beta) == 1
        assert beta[0].to_date == "2026-07-01"
        assert beta[0].from_activity is False
        assert beta[0].changed_at == datetime(2026, 2, 1, tzinfo=UTC)


def test_team_projects_fetches_history_separately_when_query_is_too_complex() -> None:
    client = LinearClient("test-key")
    calls: list[str] = []

    def _post(query: str, _variables: dict) -> dict:
        calls.append(query)
        if query == TEAM_PROJECTS_QUERY:
            raise LinearError("Query too complex")
        if query == PROJECT_HISTORY_QUERY:
            return {
                "project": {
                    "history": {
                        "nodes": [
                            {
                                "id": "h1",
                                "createdAt": "2026-01-01T00:00:00.000Z",
                                "entries": {
                                    "targetDate": {"from": None, "to": "2026-02-01"}
                                },
                            }
                        ],
                        "pageInfo": {"hasNextPage": False, "endCursor": None},
                    }
                }
            }
        return {
            "team": {
                "projects": {
                    "nodes": [{"id": "p1", "name": "Alpha"}],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        }

    client._post = _post  # type: ignore[method-assign]
    try:
        projects = client.team_projects("team-1")
    finally:
        client.close()

    assert [project["id"] for project in projects] == ["p1"]
    assert projects[0]["history"]["nodes"][0]["id"] == "h1"
    assert calls[0] == TEAM_PROJECTS_QUERY
    assert PROJECT_HISTORY_QUERY in calls


def test_project_issues_pages_across_teams() -> None:
    client = LinearClient("test-key")
    calls: list[tuple[str, dict]] = []

    def _post(query: str, variables: dict) -> dict:
        calls.append((query, variables))
        if variables.get("after") is None:
            return {
                "project": {
                    "issues": {
                        "nodes": [{"id": "i1", "identifier": "ENG-1"}],
                        "pageInfo": {"hasNextPage": True, "endCursor": "cursor-1"},
                    }
                }
            }
        return {
            "project": {
                "issues": {
                    "nodes": [{"id": "i2", "identifier": "DES-2"}],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        }

    client._post = _post  # type: ignore[method-assign]
    try:
        issues = client.project_issues("p1")
    finally:
        client.close()

    assert [issue["identifier"] for issue in issues] == ["ENG-1", "DES-2"]
    assert calls[0][0] == PROJECT_ISSUES_QUERY
    assert calls[0][1]["projectId"] == "p1"
    assert calls[1][1]["after"] == "cursor-1"

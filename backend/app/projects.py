"""Project cost totals from the locally stored project snapshot.

A point is half a man-day (``POINTS_PER_DAY`` = 2), matching cycle metrics:

``cost = points * man_day_cost / POINTS_PER_DAY``
``incurred_cost = done_points * man_day_cost / POINTS_PER_DAY``

Canceled issues are stored but omitted from points and cost. Projects marked
excluded locally still return their own totals so they can be reviewed, but
team-level calculations skip them. Empty projects still appear with zero totals.

Schedule health compares remaining points to leftover Mon–Fri days before the
target date, at ``POINTS_PER_DAY``. Remaining days use the app timezone and
end-of-day cutoff. A one-day buffer keeps the project On Track.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .app_settings import get_app_settings
from .costs import get_team_cost
from .metrics import POINTS_PER_DAY, remaining_weekdays
from .models import Project, ProjectIssue, Team, utcnow

HEALTH_ON_TRACK = "on_track"
HEALTH_LAGGING = "lagging"
HEALTH_AHEAD = "ahead"
HEALTH_BUFFER_DAYS = 1.0


@dataclass
class ProjectIssueView:
    id: int
    identifier: str
    title: str
    state_name: str | None
    state_type: str | None
    estimate: float | None
    assignee_name: str | None
    created_at: datetime | None
    completed_at: datetime | None


@dataclass
class ProjectCostView:
    id: int
    linear_id: str
    name: str
    state: str | None
    start_date: str | None
    target_date: str | None
    completed_at: datetime | None
    canceled_at: datetime | None
    archived_at: datetime | None
    last_synced_at: datetime | None
    excluded: bool
    issue_count: int
    points: float
    done_points: float
    unestimated_issues: int
    incurred_cost: float
    cost: float
    currency: str
    man_day_cost: int
    health: str | None
    expected_done_points: float | None
    working_days_left: float | None
    issues: list[ProjectIssueView] = field(default_factory=list)


def parse_project_date(value: str | None) -> date | None:
    """Parse a Linear project date (``YYYY-MM-DD``) into a calendar date."""
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def classify_project_health(
    remaining_points: float,
    remaining_days: float,
    *,
    points_per_day: float = POINTS_PER_DAY,
    buffer_days: float = HEALTH_BUFFER_DAYS,
) -> str:
    """Compare remaining work to remaining weekdays, with a one-day buffer."""
    days_needed = remaining_points / points_per_day if points_per_day > 0 else float("inf")
    slack = remaining_days - days_needed
    if slack > buffer_days:
        return HEALTH_AHEAD
    if slack < -buffer_days:
        return HEALTH_LAGGING
    return HEALTH_ON_TRACK


def project_schedule_health(
    *,
    points: float,
    done_points: float,
    target_date: str | None,
    now: datetime,
    tz: ZoneInfo,
    cutoff_hour: int,
) -> tuple[str | None, float | None, float | None]:
    """Return ``(health, expected_done_points, working_days_left)``.

    Expected done points are ``total − remaining_weekdays × POINTS_PER_DAY``:
    the points that should already be finished if the leftover weekdays are
    spent at one person-day of velocity. Remaining weekdays follow the app
    timezone and cutoff. Health is On Track when actual remaining work is
    within one working day of that leftover capacity.
    """
    parsed_target = parse_project_date(target_date)
    if parsed_target is None:
        return None, None, None
    remaining_days = remaining_weekdays(parsed_target, now, tz, cutoff_hour)
    remaining_points = max(0.0, points - done_points)
    expected_done = points - remaining_days * POINTS_PER_DAY
    return (
        classify_project_health(remaining_points, remaining_days),
        expected_done,
        remaining_days,
    )


def _issue_view(issue: ProjectIssue) -> ProjectIssueView:
    return ProjectIssueView(
        id=issue.id,
        identifier=issue.identifier,
        title=issue.title,
        state_name=issue.state_name,
        state_type=issue.state_type,
        estimate=issue.estimate,
        assignee_name=issue.assignee_name,
        created_at=issue.created_at,
        completed_at=issue.completed_at,
    )


def compute_team_project_costs(
    db: Session, team: Team, *, now: datetime | None = None
) -> list[ProjectCostView]:
    """Aggregate stored project issues into per-project point and cost totals."""
    cost = get_team_cost(db, team.id)
    settings = get_app_settings(db)
    now = now or utcnow()
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.team_id == team.id, Project.archived_at.is_(None))
            .order_by(Project.name)
        ).all()
    )
    issues_by_project: dict[int, list[ProjectIssue]] = {}
    for issue in db.scalars(
        select(ProjectIssue).where(ProjectIssue.team_id == team.id)
    ).all():
        issues_by_project.setdefault(issue.project_id, []).append(issue)

    views: list[ProjectCostView] = []
    for project in projects:
        issues = issues_by_project.get(project.id, [])
        issues.sort(key=lambda issue: (issue.identifier, issue.id))
        points = 0.0
        done_points = 0.0
        unestimated = 0
        for issue in issues:
            if issue.is_canceled:
                continue
            estimate = issue.estimate or 0.0
            points += estimate
            if issue.is_completed:
                done_points += estimate
            if issue.estimate is None:
                unestimated += 1
        health, expected_done_points, working_days_left = project_schedule_health(
            points=points,
            done_points=done_points,
            target_date=project.target_date,
            now=now,
            tz=settings.zone,
            cutoff_hour=settings.day_cutoff_hour,
        )
        views.append(
            ProjectCostView(
                id=project.id,
                linear_id=project.linear_id,
                name=project.name,
                state=project.state,
                start_date=project.start_date,
                target_date=project.target_date,
                completed_at=project.completed_at,
                canceled_at=project.canceled_at,
                archived_at=project.archived_at,
                last_synced_at=project.last_synced_at,
                excluded=bool(project.excluded),
                issue_count=len(issues),
                points=points,
                done_points=done_points,
                unestimated_issues=unestimated,
                incurred_cost=done_points / POINTS_PER_DAY * cost.man_day_cost,
                cost=points / POINTS_PER_DAY * cost.man_day_cost,
                currency=cost.currency,
                man_day_cost=cost.man_day_cost,
                health=health,
                expected_done_points=expected_done_points,
                working_days_left=working_days_left,
                issues=[_issue_view(issue) for issue in issues],
            )
        )
    return views

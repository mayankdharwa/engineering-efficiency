"""Project cost totals from the locally stored project snapshot.

A point is half a man-day (``POINTS_PER_DAY`` = 2), matching cycle metrics:

``cost = points * man_day_cost / POINTS_PER_DAY``
``incurred_cost = done_points * man_day_cost / POINTS_PER_DAY``

Canceled issues are stored but omitted from points and cost. Projects marked
excluded locally still return their own totals so they can be reviewed, but
team-level calculations skip them. Empty projects still appear with zero totals.
A completion window drops projects finished before that many calendar months
and does not load their issues or due-date history. Projects with no
completion time stay in every window.

Schedule health compares remaining points to leftover Mon–Fri days before the
target date, at ``POINTS_PER_DAY``. Remaining days use the app timezone and
end-of-day cutoff. A one-day buffer keeps the project On Track.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .app_settings import get_app_settings
from .costs import get_team_cost
from .metrics import POINTS_PER_DAY, remaining_weekdays
from .models import Project, ProjectDueDateChange, ProjectIssue, Team, utcnow
from .project_history import (
    DueDatePoint,
    build_due_date_trajectory,
    calendar_date,
    target_date_changes,
)

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
    due_date_history: list[DueDatePoint] = field(default_factory=list)
    issues: list[ProjectIssueView] = field(default_factory=list)


def months_before(moment: datetime, months: int) -> datetime:
    """The same clock time ``months`` calendar months before ``moment``.

    The day is clamped when the earlier month is shorter, so 31 March minus
    one month is 28 or 29 February.
    """
    if months < 1:
        raise ValueError("months must be at least 1")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    month_index = moment.month - 1 - months
    year = moment.year + month_index // 12
    month = month_index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


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


def _activity_changes(
    rows: list[ProjectDueDateChange],
) -> list[tuple[datetime, str | None, str | None]]:
    """Prefer each event's own timestamp when the stored payload has one.

    One Linear history record can contain every target-date change, and each
    event carries its own ``at``. Rows saved before that time was stored share
    a single ``changed_at``, so the payload is read again here.
    """
    collected: list[tuple[datetime, str | None, str | None]] = []
    seen: list[object] = []
    for row in rows:
        raw = row.raw or {}
        if any(raw == previous for previous in seen):
            continue
        seen.append(raw)
        for change in target_date_changes(raw):
            if change.changed_at is None:
                continue
            collected.append((change.changed_at, change.from_date, change.to_date))
    if collected:
        return collected
    return [
        (row.changed_at, calendar_date(row.from_date), calendar_date(row.to_date))
        for row in rows
    ]


def compute_team_project_costs(
    db: Session,
    team: Team,
    *,
    now: datetime | None = None,
    completed_within_months: int | None = None,
) -> list[ProjectCostView]:
    """Aggregate stored project issues into per-project point and cost totals.

    ``completed_within_months`` leaves out projects completed before that many
    calendar months. Their issue rows and due-date history are not queried.
    ``None`` keeps every non-archived project, which single-project updates use.
    """
    now = now or utcnow()
    project_query = select(Project).where(
        Project.team_id == team.id, Project.archived_at.is_(None)
    )
    if completed_within_months is not None:
        cutoff = months_before(now, completed_within_months)
        project_query = project_query.where(
            or_(Project.completed_at.is_(None), Project.completed_at >= cutoff)
        )
    projects = list(db.scalars(project_query.order_by(Project.name)).all())
    if not projects:
        return []

    cost = get_team_cost(db, team.id)
    settings = get_app_settings(db)
    project_ids = [project.id for project in projects]
    issues_by_project: dict[int, list[ProjectIssue]] = {}
    for issue in db.scalars(
        select(ProjectIssue).where(ProjectIssue.project_id.in_(project_ids))
    ).all():
        issues_by_project.setdefault(issue.project_id, []).append(issue)
    stored_changes: dict[int, list[ProjectDueDateChange]] = {}
    for change in db.scalars(
        select(ProjectDueDateChange)
        .where(ProjectDueDateChange.project_id.in_(project_ids))
        .order_by(ProjectDueDateChange.id)
    ).all():
        stored_changes.setdefault(change.project_id, []).append(change)
    changes_by_project = {
        project_id: _activity_changes(rows) for project_id, rows in stored_changes.items()
    }

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
                due_date_history=build_due_date_trajectory(
                    changes_by_project.get(project.id, []),
                    target_date=project.target_date,
                    initial_observed_at=project.created_at,
                    current_observed_at=project.last_synced_at,
                ),
                issues=[_issue_view(issue) for issue in issues],
            )
        )
    return views

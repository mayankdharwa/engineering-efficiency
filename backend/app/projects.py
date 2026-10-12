"""Project cost totals from the locally stored project snapshot.

A point is half a man-day (``POINTS_PER_DAY`` = 2), matching cycle metrics:

``cost = points * man_day_cost / POINTS_PER_DAY``

Canceled issues are stored but excluded from points and cost. Empty projects
still appear with zero totals.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .costs import get_team_cost
from .metrics import POINTS_PER_DAY
from .models import Project, ProjectIssue, Team


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
    issue_count: int
    points: float
    done_points: float
    unestimated_issues: int
    cost: float
    currency: str
    man_day_cost: int
    issues: list[ProjectIssueView] = field(default_factory=list)


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


def compute_team_project_costs(db: Session, team: Team) -> list[ProjectCostView]:
    """Aggregate stored project issues into per-project point and cost totals."""
    cost = get_team_cost(db, team.id)
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
                issue_count=len(issues),
                points=points,
                done_points=done_points,
                unestimated_issues=unestimated,
                cost=points / POINTS_PER_DAY * cost.man_day_cost,
                currency=cost.currency,
                man_day_cost=cost.man_day_cost,
                issues=[_issue_view(issue) for issue in issues],
            )
        )
    return views

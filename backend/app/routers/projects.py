"""Project listing, cost totals, and per-team project refresh."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import require_refresher
from ..database import get_db
from ..models import Project, SyncKind, SyncStatus
from ..projects import compute_team_project_costs
from ..schemas import ProjectOut, ProjectRefreshResult, ProjectUpdateIn
from ..sync import client_from_config, record_sync_run, sync_team_projects
from .deps import get_team_or_404
from .teams import _tracked_sync_run

router = APIRouter(prefix="/teams", tags=["projects"])


def _project_view(db: Session, team, project_id: int) -> ProjectOut:
    view = next(
        (item for item in compute_team_project_costs(db, team) if item.id == project_id),
        None,
    )
    if view is None:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    return ProjectOut(**asdict(view))


@router.get("/{team_id}/projects", response_model=list[ProjectOut])
def list_projects(team_id: int, db: Session = Depends(get_db)) -> list[ProjectOut]:
    """Projects stored for a team, with point totals and man-day cost."""
    team = get_team_or_404(db, team_id)
    return [ProjectOut(**asdict(view)) for view in compute_team_project_costs(db, team)]


@router.patch("/{team_id}/projects/{project_id}", response_model=ProjectOut)
def update_project(
    team_id: int,
    project_id: int,
    payload: ProjectUpdateIn,
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Update local project fields that Linear refresh must not overwrite."""
    team = get_team_or_404(db, team_id)
    project = db.get(Project, project_id)
    if project is None or project.team_id != team.id:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found.")
    project.excluded = payload.excluded
    db.commit()
    return _project_view(db, team, project_id)


@router.post(
    "/{team_id}/projects/refresh",
    response_model=ProjectRefreshResult,
    dependencies=[Depends(require_refresher)],
)
def refresh_projects(team_id: int, db: Session = Depends(get_db)) -> ProjectRefreshResult:
    """Download the team's Linear projects and their issues."""
    team = get_team_or_404(db, team_id)
    with _tracked_sync_run(db, SyncKind.PROJECTS, team_id=team.id) as run:
        with client_from_config(db) as client:
            summary = sync_team_projects(db, client, team)
        message = (
            f"Synced {summary.projects_synced} project(s) and "
            f"{summary.issues_synced} issue(s)."
        )
        record_sync_run(
            db,
            kind=SyncKind.PROJECTS,
            status=SyncStatus.SUCCESS,
            team_id=team.id,
            message=message,
            issues_synced=summary.issues_synced,
            run=run,
        )
    return ProjectRefreshResult(
        team_id=team.id,
        status="success",
        projects_synced=summary.projects_synced,
        issues_synced=summary.issues_synced,
        message=message,
    )

"""Project listing, cost totals, and per-team project refresh."""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SyncKind, SyncStatus
from ..projects import compute_team_project_costs
from ..schemas import ProjectOut, ProjectRefreshResult
from ..sync import client_from_config, record_sync_run, sync_team_projects
from .deps import get_team_or_404
from .teams import _tracked_sync_run

router = APIRouter(prefix="/teams", tags=["projects"])


@router.get("/{team_id}/projects", response_model=list[ProjectOut])
def list_projects(team_id: int, db: Session = Depends(get_db)) -> list[ProjectOut]:
    """Projects stored for a team, with point totals and man-day cost."""
    team = get_team_or_404(db, team_id)
    return [ProjectOut(**asdict(view)) for view in compute_team_project_costs(db, team)]


@router.post("/{team_id}/projects/refresh", response_model=ProjectRefreshResult)
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

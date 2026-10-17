"""Team listing, import and per-team refresh endpoints."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..auth import require_admin, require_refresher
from ..cycles import format_cycle_label
from ..database import get_db
from ..linear_client import LinearError
from ..models import (
    Cycle,
    CycleMembership,
    Issue,
    MemberGroup,
    Project,
    ProjectIssue,
    SyncKind,
    SyncRun,
    SyncStatus,
    Team,
    TeamCost,
    TeamMember,
)
from ..schemas import IssueOut, RefreshResult, SyncRunOut, TeamOut
from ..sync import (
    CycleMismatchError,
    client_from_config,
    record_sync_run,
    sync_team_issues,
    upsert_teams,
)
from .deps import get_team_or_404, resolve_cycle_or_404

router = APIRouter(prefix="/teams", tags=["teams"])


@contextmanager
def _tracked_sync_run(
    db: Session, kind: SyncKind, *, team_id: int | None = None
) -> Iterator[SyncRun]:
    """Record a running sync, and persist the error status if it fails."""
    run = record_sync_run(db, kind=kind, status=SyncStatus.RUNNING, team_id=team_id)
    try:
        yield run
    except CycleMismatchError as exc:
        record_sync_run(
            db, kind=kind, status=SyncStatus.ERROR, team_id=team_id, message=str(exc), run=run
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (LinearError, RuntimeError) as exc:
        record_sync_run(
            db, kind=kind, status=SyncStatus.ERROR, team_id=team_id, message=str(exc), run=run
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)).all())


@router.post("/import", response_model=list[TeamOut], dependencies=[Depends(require_admin)])
def import_teams(db: Session = Depends(get_db)) -> list[Team]:
    """Fetch the team list from Linear and store it locally."""
    with _tracked_sync_run(db, SyncKind.TEAMS) as run:
        with client_from_config(db) as client:
            teams = upsert_teams(db, client)
        record_sync_run(
            db,
            kind=SyncKind.TEAMS,
            status=SyncStatus.SUCCESS,
            message=f"Imported {len(teams)} team(s).",
            run=run,
        )
    return teams


@router.post(
    "/{team_id}/refresh",
    response_model=RefreshResult,
    dependencies=[Depends(require_refresher)],
)
def refresh_team(team_id: int, db: Session = Depends(get_db)) -> RefreshResult:
    """Download the current cycle's issues for one team into SQLite."""
    team = get_team_or_404(db, team_id)
    with _tracked_sync_run(db, SyncKind.ISSUES, team_id=team.id) as run:
        with client_from_config(db) as client:
            summary = sync_team_issues(db, client, team)
        if summary.has_active_cycle:
            cycle_label = format_cycle_label(
                summary.cycle_name, summary.cycle_number, summary.cycle_id
            )
            message = f"Synced {summary.issues_synced} issue(s) from {cycle_label}."
        else:
            message = "No active cycle for this team."

        record_sync_run(
            db,
            kind=SyncKind.ISSUES,
            status=SyncStatus.SUCCESS,
            team_id=team.id,
            message=message,
            issues_synced=summary.issues_synced,
            run=run,
        )
    return RefreshResult(
        team_id=team.id,
        status="success",
        issues_synced=summary.issues_synced,
        members_synced=summary.members_synced,
        cycle_name=summary.cycle_name,
        message=message,
    )


@router.delete(
    "/{team_id}", status_code=204, dependencies=[Depends(require_admin)]
)
def delete_team(team_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a team and all of its locally stored data.

    Linear itself is untouched: the team can be re-imported and refreshed
    later, but its cycle configuration (dates, working days, member
    groups/leave) is lost.
    """
    team = get_team_or_404(db, team_id)
    # Clear children explicitly so this still works if a connection does not
    # have SQLite foreign keys enabled. With PRAGMA foreign_keys=ON the same
    # deletes also happen via ON DELETE CASCADE / SET NULL.
    db.execute(delete(Issue).where(Issue.team_id == team_id))
    db.execute(delete(ProjectIssue).where(ProjectIssue.team_id == team_id))
    db.execute(delete(Project).where(Project.team_id == team_id))
    db.execute(delete(CycleMembership).where(CycleMembership.team_id == team_id))
    db.execute(delete(Cycle).where(Cycle.team_id == team_id))
    db.execute(delete(TeamMember).where(TeamMember.team_id == team_id))
    db.execute(delete(TeamCost).where(TeamCost.team_id == team_id))
    db.execute(delete(MemberGroup).where(MemberGroup.team_id == team_id))
    # Keep the sync audit trail but detach it from the deleted team.
    db.execute(update(SyncRun).where(SyncRun.team_id == team_id).values(team_id=None))
    db.delete(team)
    db.commit()
    return Response(status_code=204)


@router.get("/{team_id}/issues", response_model=list[IssueOut])
def list_issues(
    team_id: int,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[Issue]:
    team = get_team_or_404(db, team_id)
    cycle = resolve_cycle_or_404(db, team, cycle_id)
    if cycle is None:
        return []
    stmt = (
        select(Issue)
        .where(Issue.team_id == team_id, Issue.cycle_id == cycle.id)
        .order_by(Issue.updated_at.desc().nullslast())
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt).all())


@router.get("/{team_id}/sync-runs", response_model=list[SyncRunOut])
def list_sync_runs(
    team_id: int,
    db: Session = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[SyncRun]:
    get_team_or_404(db, team_id)
    stmt = (
        select(SyncRun)
        .where(SyncRun.team_id == team_id)
        .order_by(SyncRun.started_at.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())

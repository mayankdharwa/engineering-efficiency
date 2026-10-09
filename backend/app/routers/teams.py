"""Team listing, import and per-team refresh endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..app_settings import get_app_settings
from ..database import get_db
from ..linear_client import LinearError
from ..metrics import compute_team_metrics, get_cycle_settings, weekdays_between
from ..models import (
    CycleSettings,
    Issue,
    MemberUnavailability,
    SyncRun,
    Team,
    TeamMember,
)
from ..schemas import (
    CycleMemberOut,
    CycleSettingsIn,
    CycleSettingsOut,
    IssueOut,
    RefreshResult,
    SyncRunOut,
    TeamOut,
)
from ..sync import client_from_config, record_sync_run, sync_team_issues, upsert_teams

router = APIRouter(prefix="/teams", tags=["teams"])


def _get_team_or_404(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found.")
    return team


@router.get("", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)) -> list[Team]:
    return list(db.scalars(select(Team).order_by(Team.name)).all())


@router.post("/import", response_model=list[TeamOut])
def import_teams(db: Session = Depends(get_db)) -> list[Team]:
    """Fetch the team list from Linear and store it locally."""
    run = record_sync_run(db, kind="teams", status="running")
    try:
        with client_from_config(db) as client:
            teams = upsert_teams(db, client)
    except (LinearError, RuntimeError) as exc:
        record_sync_run(db, kind="teams", status="error", message=str(exc), run=run)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    record_sync_run(
        db,
        kind="teams",
        status="success",
        message=f"Imported {len(teams)} team(s).",
        run=run,
    )
    return teams


@router.post("/{team_id}/refresh", response_model=RefreshResult)
def refresh_team(team_id: int, db: Session = Depends(get_db)) -> RefreshResult:
    """Download the current cycle's issues for one team into SQLite."""
    team = _get_team_or_404(db, team_id)
    run = record_sync_run(db, kind="issues", status="running", team_id=team.id)
    try:
        with client_from_config(db) as client:
            summary = sync_team_issues(db, client, team)
    except (LinearError, RuntimeError) as exc:
        record_sync_run(
            db, kind="issues", status="error", team_id=team.id, message=str(exc), run=run
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if summary.has_active_cycle:
        cycle_label = summary.cycle_name or (
            f"Cycle {summary.cycle_number:g}"
            if summary.cycle_number is not None
            else summary.cycle_id
        )
        message = f"Synced {summary.issues_synced} issue(s) from {cycle_label}."
    else:
        message = "No active cycle for this team; stored issues were cleared."

    record_sync_run(
        db,
        kind="issues",
        status="success",
        team_id=team.id,
        message=message,
        issues_synced=summary.issues_synced,
        run=run,
    )
    return RefreshResult(
        team_id=team.id,
        status="success",
        issues_synced=summary.issues_synced,
        cycle_name=summary.cycle_name,
        message=message,
    )


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a team and all of its locally stored data.

    Linear itself is untouched: the team can be re-imported and refreshed
    later, but its cycle configuration (dates, working days, member
    roles/leave) is lost.
    """
    team = _get_team_or_404(db, team_id)
    # SQLite foreign-key cascades are not enabled, so clear the child rows
    # explicitly before removing the team.
    db.execute(delete(Issue).where(Issue.team_id == team_id))
    db.execute(delete(CycleSettings).where(CycleSettings.team_id == team_id))
    db.execute(delete(TeamMember).where(TeamMember.team_id == team_id))
    db.execute(
        delete(MemberUnavailability).where(MemberUnavailability.team_id == team_id)
    )
    # Keep the sync audit trail but detach it from the deleted team.
    db.execute(update(SyncRun).where(SyncRun.team_id == team_id).values(team_id=None))
    db.delete(team)
    db.commit()
    return Response(status_code=204)


@router.get("/{team_id}/issues", response_model=list[IssueOut])
def list_issues(
    team_id: int,
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[Issue]:
    _get_team_or_404(db, team_id)
    stmt = (
        select(Issue)
        .where(Issue.team_id == team_id)
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
    _get_team_or_404(db, team_id)
    stmt = (
        select(SyncRun)
        .where(SyncRun.team_id == team_id)
        .order_by(SyncRun.started_at.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())


def _cycle_out(db: Session, team: Team) -> CycleSettingsOut:
    """Build the cycle-settings view from the stored settings + membership."""
    metrics = compute_team_metrics(db, team)
    settings = get_cycle_settings(db, team)

    overrides: dict[str, float] = {}
    if settings is not None:
        overrides = {
            row.member_linear_id: row.unavailable_days
            for row in db.scalars(
                select(MemberUnavailability).where(
                    MemberUnavailability.team_id == team.id,
                    MemberUnavailability.cycle_id == settings.cycle_id,
                )
            ).all()
        }

    members = list(
        db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all()
    )
    members.sort(key=lambda member: (member.display_name or member.name or "").lower())

    return CycleSettingsOut(
        team_id=team.id,
        ready=metrics.ready,
        message=metrics.message,
        cycle_id=metrics.cycle_id,
        cycle_name=metrics.cycle_name,
        cycle_number=metrics.cycle_number,
        starts_at=metrics.starts_at,
        ends_at=metrics.ends_at,
        working_days=metrics.working_days,
        default_working_days=metrics.default_working_days,
        working_days_overridden=metrics.working_days_overridden,
        points_per_day=metrics.points_per_day,
        members=[
            CycleMemberOut(
                linear_id=member.linear_id,
                name=member.display_name or member.name or member.linear_id,
                email=member.email,
                role=member.role,
                unavailable_days=overrides.get(member.linear_id, 0.0),
                counts_toward_capacity=bool(member.counts_toward_capacity),
            )
            for member in members
        ],
    )


@router.get("/{team_id}/cycle", response_model=CycleSettingsOut)
def read_cycle_settings(team_id: int, db: Session = Depends(get_db)) -> CycleSettingsOut:
    """Current cycle dates, working-day override and per-member leave."""
    team = _get_team_or_404(db, team_id)
    return _cycle_out(db, team)


@router.put("/{team_id}/cycle", response_model=CycleSettingsOut)
def update_cycle_settings(
    team_id: int,
    payload: CycleSettingsIn,
    db: Session = Depends(get_db),
) -> CycleSettingsOut:
    """Update working days, cycle dates and per-member unavailable days."""
    team = _get_team_or_404(db, team_id)
    settings = get_cycle_settings(db, team)
    if settings is None:
        raise HTTPException(
            status_code=400,
            detail="No active cycle stored for this team. Refresh the team first.",
        )

    if payload.starts_at is not None or payload.ends_at is not None:
        if payload.starts_at is not None:
            settings.starts_at = payload.starts_at
        if payload.ends_at is not None:
            settings.ends_at = payload.ends_at
        settings.dates_overridden = True

    if payload.working_days is not None:
        # Submitting the computed default clears the override.
        default_days = weekdays_between(
            settings.starts_at, settings.ends_at, get_app_settings(db).zone
        )
        if abs(payload.working_days - default_days) < 1e-9:
            settings.working_days = None
        else:
            settings.working_days = payload.working_days

    for entry in payload.members:
        member = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == team.id,
                TeamMember.linear_id == entry.linear_id,
            )
        )
        if member is not None and entry.counts_toward_capacity is not None:
            member.counts_toward_capacity = entry.counts_toward_capacity
        # `role` may legitimately be null (clearing a tag), so only touch it when
        # the client actually sent the field.
        if member is not None and "role" in entry.model_fields_set:
            member.role = entry.role

        row = db.scalar(
            select(MemberUnavailability).where(
                MemberUnavailability.team_id == team.id,
                MemberUnavailability.cycle_id == settings.cycle_id,
                MemberUnavailability.member_linear_id == entry.linear_id,
            )
        )
        if entry.unavailable_days <= 0:
            if row is not None:
                db.delete(row)
            continue
        if row is None:
            row = MemberUnavailability(
                team_id=team.id,
                cycle_id=settings.cycle_id,
                member_linear_id=entry.linear_id,
            )
            db.add(row)
        row.unavailable_days = entry.unavailable_days

    db.commit()
    return _cycle_out(db, team)

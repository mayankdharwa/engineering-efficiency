"""Team listing, import and per-team refresh endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..app_settings import get_app_settings
from ..costs import TeamCostView, get_team_cost
from ..database import get_db
from ..linear_client import LinearError
from ..metrics import compute_team_metrics, get_cycle, weekdays_between
from ..models import (
    Cycle,
    CycleMembership,
    Issue,
    MemberGroup,
    SyncRun,
    Team,
    TeamCost,
    TeamMember,
    utcnow,
)
from ..sync import (
    CycleMismatchError,
    client_from_config,
    record_sync_run,
    sync_team_issues,
    upsert_teams,
)
from ..schemas import (
    CycleMemberOut,
    CycleOut,
    CycleSettingsIn,
    CycleSettingsOut,
    GroupIn,
    GroupOut,
    IssueOut,
    RefreshResult,
    SyncRunOut,
    TeamCostIn,
    TeamCostOut,
    TeamOut,
)

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
    except CycleMismatchError as exc:
        record_sync_run(
            db, kind="issues", status="error", team_id=team.id, message=str(exc), run=run
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (LinearError, RuntimeError) as exc:
        record_sync_run(
            db, kind="issues", status="error", team_id=team.id, message=str(exc), run=run
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if summary.has_active_cycle:
        cycle_label = summary.cycle_name or (
            f"Cycle {summary.cycle_number}"
            if summary.cycle_number is not None
            else summary.cycle_id
        )
        message = f"Synced {summary.issues_synced} issue(s) from {cycle_label}."
    else:
        message = "No active cycle for this team."

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
    groups/leave) is lost.
    """
    team = _get_team_or_404(db, team_id)
    # Clear children explicitly so this still works if a connection does not
    # have SQLite foreign keys enabled. With PRAGMA foreign_keys=ON the same
    # deletes also happen via ON DELETE CASCADE / SET NULL.
    db.execute(delete(Issue).where(Issue.team_id == team_id))
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


def _resolve_cycle(
    db: Session, team: Team, cycle_id: int | None
) -> Cycle | None:
    """Resolve an optional cycle id; 404 if the client named a missing cycle."""
    if cycle_id is None:
        return get_cycle(db, team)
    cycle = get_cycle(db, team, cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} not found.")
    return cycle


@router.get("/{team_id}/issues", response_model=list[IssueOut])
def list_issues(
    team_id: int,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[Issue]:
    team = _get_team_or_404(db, team_id)
    settings = _resolve_cycle(db, team, cycle_id)
    if settings is None:
        return []
    stmt = (
        select(Issue)
        .where(Issue.team_id == team_id, Issue.cycle_id == settings.id)
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


def _cycle_memberships(db: Session, team_id: int, cycle_id: int) -> dict[str, CycleMembership]:
    return {
        row.member_linear_id: row
        for row in db.scalars(
            select(CycleMembership).where(
                CycleMembership.team_id == team_id,
                CycleMembership.cycle_id == cycle_id,
            )
        ).all()
    }


def _cycle_out(
    db: Session, team: Team, cycle: Cycle | None = None
) -> CycleSettingsOut:
    """Build the cycle-settings view from the stored cycle + membership."""
    settings = cycle if cycle is not None else get_cycle(db, team)
    metrics = compute_team_metrics(db, team, cycle=settings)

    snapshots = (
        _cycle_memberships(db, team.id, settings.id) if settings is not None else {}
    )
    members = list(
        db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all()
    )
    member_by_id = {member.linear_id: member for member in members}

    # Current cycle: live roster. Historical cycle: whoever was snapshotted.
    if settings is not None and settings.id != team.current_cycle_id:
        linear_ids = list(snapshots)
    else:
        linear_ids = [member.linear_id for member in members]
        for linear_id in snapshots:
            if linear_id not in member_by_id:
                linear_ids.append(linear_id)

    def _sort_key(linear_id: str) -> str:
        member = member_by_id.get(linear_id)
        if member is not None:
            return (member.display_name or member.name or linear_id).lower()
        return linear_id.lower()

    linear_ids.sort(key=_sort_key)

    groups = list(
        db.scalars(
            select(MemberGroup)
            .where(MemberGroup.team_id == team.id)
            .order_by(MemberGroup.id)
        ).all()
    )
    group_name_by_id = {group.id: group.name for group in groups}

    return CycleSettingsOut(
        team_id=team.id,
        ready=metrics.ready,
        message=metrics.message,
        cycle_id=metrics.cycle_id,
        cycle_linear_id=metrics.cycle_linear_id,
        cycle_name=metrics.cycle_name,
        cycle_number=metrics.cycle_number,
        starts_at=metrics.starts_at,
        ends_at=metrics.ends_at,
        working_days=metrics.working_days,
        default_working_days=metrics.default_working_days,
        working_days_overridden=metrics.working_days_overridden,
        archived_at=settings.archived_at if settings is not None else None,
        is_current=(
            settings is not None and settings.id == team.current_cycle_id
        ),
        points_per_day=metrics.points_per_day,
        groups=[GroupOut.model_validate(group) for group in groups],
        members=[
            CycleMemberOut(
                linear_id=linear_id,
                name=(
                    (member_by_id[linear_id].display_name or member_by_id[linear_id].name)
                    if linear_id in member_by_id
                    else None
                )
                or linear_id,
                email=member_by_id[linear_id].email if linear_id in member_by_id else None,
                group_id=snapshots[linear_id].group_id if linear_id in snapshots else None,
                group_name=(
                    group_name_by_id.get(snapshots[linear_id].group_id)
                    if linear_id in snapshots and snapshots[linear_id].group_id is not None
                    else None
                ),
                unavailable_days=(
                    snapshots[linear_id].unavailable_days if linear_id in snapshots else 0.0
                ),
                counts_toward_capacity=(
                    bool(snapshots[linear_id].counts_toward_capacity)
                    if linear_id in snapshots
                    else True
                ),
            )
            for linear_id in linear_ids
        ],
    )


@router.get("/{team_id}/cycles", response_model=list[CycleOut])
def list_cycles(team_id: int, db: Session = Depends(get_db)) -> list[CycleOut]:
    """Every stored cycle for a team, newest first."""
    team = _get_team_or_404(db, team_id)
    rows = list(
        db.scalars(
            select(Cycle)
            .where(Cycle.team_id == team.id)
            .order_by(Cycle.number.desc().nullslast(), Cycle.id.desc())
        ).all()
    )
    return [
        CycleOut(
            id=row.id,
            linear_id=row.linear_id,
            name=row.name,
            number=row.number,
            starts_at=row.starts_at,
            ends_at=row.ends_at,
            archived_at=row.archived_at,
            is_current=row.id == team.current_cycle_id,
        )
        for row in rows
    ]


@router.get("/{team_id}/cycle", response_model=CycleSettingsOut)
def read_cycle_settings(
    team_id: int,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
) -> CycleSettingsOut:
    """Cycle dates, working-day override and per-member leave."""
    team = _get_team_or_404(db, team_id)
    return _cycle_out(db, team, _resolve_cycle(db, team, cycle_id))


def _snapshot_row(
    db: Session, team_id: int, cycle_id: int, linear_id: str
) -> CycleMembership | None:
    return db.scalar(
        select(CycleMembership).where(
            CycleMembership.team_id == team_id,
            CycleMembership.cycle_id == cycle_id,
            CycleMembership.member_linear_id == linear_id,
        )
    )


@router.put("/{team_id}/cycle", response_model=CycleSettingsOut)
def update_cycle_settings(
    team_id: int,
    payload: CycleSettingsIn,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
) -> CycleSettingsOut:
    """Update working days, cycle dates and the per-member cycle snapshot."""
    team = _get_team_or_404(db, team_id)
    settings = _resolve_cycle(db, team, cycle_id)
    if settings is None:
        raise HTTPException(
            status_code=400,
            detail="No active cycle stored for this team. Refresh the team first.",
        )

    finalized = settings.archived_at is not None
    cycle_fields = payload.model_fields_set & {"starts_at", "ends_at", "working_days"}
    if finalized and cycle_fields:
        raise HTTPException(
            status_code=409,
            detail="This cycle is finalized and its dates / working days cannot be edited.",
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

    valid_group_ids = set(
        db.scalars(select(MemberGroup.id).where(MemberGroup.team_id == team.id)).all()
    )

    for entry in payload.members:
        member = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == team.id,
                TeamMember.linear_id == entry.linear_id,
            )
        )
        row = _snapshot_row(db, team.id, settings.id, entry.linear_id)
        stored_leave = row.unavailable_days if row is not None else 0.0
        stored_counts = row.counts_toward_capacity if row is not None else True
        stored_group = row.group_id if row is not None else None
        next_counts = (
            entry.counts_toward_capacity
            if entry.counts_toward_capacity is not None
            else stored_counts
        )
        next_group = entry.group_id if "group_id" in entry.model_fields_set else stored_group
        if next_group is not None and next_group not in valid_group_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Group {entry.group_id} does not belong to this team.",
            )

        if finalized:
            if (
                abs(entry.unavailable_days - stored_leave) > 1e-9
                or next_counts != stored_counts
                or next_group != stored_group
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This cycle is finalized and its member snapshot "
                        "(group, capacity, leave) cannot be edited."
                    ),
                )
            continue

        if member is None and row is None:
            continue
        if row is None:
            row = CycleMembership(
                team_id=team.id,
                cycle_id=settings.id,
                member_id=member.id if member is not None else None,
                member_linear_id=entry.linear_id,
            )
            db.add(row)
        if member is not None:
            row.member_id = member.id
        row.unavailable_days = entry.unavailable_days
        row.counts_toward_capacity = next_counts
        if "group_id" in entry.model_fields_set:
            row.group_id = entry.group_id

    db.commit()
    return _cycle_out(db, team, settings)


@router.post("/{team_id}/cycle/finalize", response_model=CycleSettingsOut)
def finalize_cycle(team_id: int, db: Session = Depends(get_db)) -> CycleSettingsOut:
    """Mark the team's current cycle as finalized (frozen).

    Finalization preserves the cycle's data and is required before a refresh can
    switch the team to a newer cycle. It is scoped to one team, so teams on
    different cycle schedules roll over independently.
    """
    team = _get_team_or_404(db, team_id)
    settings = get_cycle(db, team)
    if settings is None:
        raise HTTPException(
            status_code=400,
            detail="No active cycle stored for this team. Refresh the team first.",
        )
    if settings.archived_at is None:
        settings.archived_at = utcnow()
        db.commit()
    return _cycle_out(db, team, settings)


# ---------------------------------------------------------------------------
# Per-team cost configuration
# ---------------------------------------------------------------------------


def _cost_out(team_id: int, view: TeamCostView) -> TeamCostOut:
    return TeamCostOut(
        team_id=team_id,
        currency=view.currency,
        man_day_cost=view.man_day_cost,
    )


@router.get("/{team_id}/cost", response_model=TeamCostOut)
def read_team_cost(team_id: int, db: Session = Depends(get_db)) -> TeamCostOut:
    """A team's currency symbol and man-day cost."""
    team = _get_team_or_404(db, team_id)
    return _cost_out(team.id, get_team_cost(db, team.id))


@router.put("/{team_id}/cost", response_model=TeamCostOut)
def update_team_cost(
    team_id: int, payload: TeamCostIn, db: Session = Depends(get_db)
) -> TeamCostOut:
    """Save a team's currency symbol and man-day cost."""
    team = _get_team_or_404(db, team_id)
    row = db.scalar(select(TeamCost).where(TeamCost.team_id == team.id))
    if row is None:
        row = TeamCost(team_id=team.id)
        db.add(row)
    row.currency = payload.currency
    row.man_day_cost = payload.man_day_cost
    db.commit()
    db.refresh(row)
    return _cost_out(team.id, get_team_cost(db, team.id))


# ---------------------------------------------------------------------------
# Member groups (per team, fluid)
# ---------------------------------------------------------------------------


def _group_or_404(db: Session, team_id: int, group_id: int) -> MemberGroup:
    group = db.get(MemberGroup, group_id)
    if group is None or group.team_id != team_id:
        raise HTTPException(status_code=404, detail=f"Group {group_id} not found.")
    return group


@router.get("/{team_id}/groups", response_model=list[GroupOut])
def list_groups(team_id: int, db: Session = Depends(get_db)) -> list[MemberGroup]:
    """All groups defined for a team, in creation order."""
    _get_team_or_404(db, team_id)
    return list(
        db.scalars(
            select(MemberGroup)
            .where(MemberGroup.team_id == team_id)
            .order_by(MemberGroup.id)
        ).all()
    )


@router.post("/{team_id}/groups", response_model=GroupOut, status_code=201)
def create_group(
    team_id: int, payload: GroupIn, db: Session = Depends(get_db)
) -> MemberGroup:
    """Add a group to a team."""
    team = _get_team_or_404(db, team_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name cannot be blank.")
    existing = db.scalar(
        select(MemberGroup).where(
            MemberGroup.team_id == team.id, MemberGroup.name == name
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=400, detail=f"Group '{name}' already exists for this team."
        )

    group = MemberGroup(team_id=team.id, name=name)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put("/{team_id}/groups/{group_id}", response_model=GroupOut)
def rename_group(
    team_id: int,
    group_id: int,
    payload: GroupIn,
    db: Session = Depends(get_db),
) -> MemberGroup:
    """Rename a team's group."""
    _get_team_or_404(db, team_id)
    group = _group_or_404(db, team_id, group_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name cannot be blank.")
    clash = db.scalar(
        select(MemberGroup).where(
            MemberGroup.team_id == team_id,
            MemberGroup.name == name,
            MemberGroup.id != group_id,
        )
    )
    if clash is not None:
        raise HTTPException(
            status_code=400, detail=f"Group '{name}' already exists for this team."
        )

    group.name = name
    db.commit()
    db.refresh(group)
    return group


@router.delete("/{team_id}/groups/{group_id}", status_code=204)
def delete_group(
    team_id: int, group_id: int, db: Session = Depends(get_db)
) -> Response:
    """Remove a group, unassigning any members that belonged to it."""
    _get_team_or_404(db, team_id)
    group = _group_or_404(db, team_id, group_id)
    finalized_use = db.scalar(
        select(CycleMembership.id)
        .join(Cycle, Cycle.id == CycleMembership.cycle_id)
        .where(
            CycleMembership.group_id == group.id,
            Cycle.archived_at.is_not(None),
        )
        .limit(1)
    )
    if finalized_use is not None:
        raise HTTPException(
            status_code=409,
            detail="Group is used by a finalized cycle and cannot be deleted.",
        )
    db.execute(
        update(CycleMembership)
        .where(CycleMembership.group_id == group.id)
        .values(group_id=None)
    )
    db.delete(group)
    db.commit()
    return Response(status_code=204)

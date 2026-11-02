"""Cycle listing, settings, and finalize endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..app_settings import get_app_settings
from ..auth import require_admin
from ..cycles import apply_cycle_member_updates, build_cycle_settings_out, format_cycle_label
from ..database import get_db
from ..metrics import get_cycle, weekdays_between
from ..models import Cycle, SyncKind, SyncStatus
from ..schemas import CycleFinalizeIn, CycleFinalizeOut, CycleOut, CycleSettingsIn, CycleSettingsOut
from ..sync import client_from_config, finalize_team_cycle, record_sync_run
from .deps import get_team_or_404, resolve_cycle_or_404
from .teams import _tracked_sync_run

router = APIRouter(prefix="/teams", tags=["cycles"])


@router.get("/{team_id}/cycles", response_model=list[CycleOut])
def list_cycles(team_id: int, db: Session = Depends(get_db)) -> list[CycleOut]:
    """Every stored cycle for a team, newest first."""
    team = get_team_or_404(db, team_id)
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
    team = get_team_or_404(db, team_id)
    return build_cycle_settings_out(db, team, resolve_cycle_or_404(db, team, cycle_id))


@router.put(
    "/{team_id}/cycle",
    response_model=CycleSettingsOut,
    dependencies=[Depends(require_admin)],
)
def update_cycle_settings(
    team_id: int,
    payload: CycleSettingsIn,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
) -> CycleSettingsOut:
    """Update working days, cycle dates and the per-member cycle snapshot."""
    team = get_team_or_404(db, team_id)
    cycle = resolve_cycle_or_404(db, team, cycle_id)
    if cycle is None:
        raise HTTPException(
            status_code=400,
            detail="No cycle for this team yet. Refresh to load one.",
        )

    finalized = cycle.is_finalized
    cycle_fields = payload.model_fields_set & {"starts_at", "ends_at", "working_days"}
    if finalized and cycle_fields:
        raise HTTPException(
            status_code=409,
            detail="This cycle is finalized and its dates / working days cannot be edited.",
        )

    if payload.starts_at is not None or payload.ends_at is not None:
        if payload.starts_at is not None:
            cycle.starts_at = payload.starts_at
        if payload.ends_at is not None:
            cycle.ends_at = payload.ends_at
        cycle.dates_overridden = True

    if payload.working_days is not None:
        # Submitting the computed default clears the override.
        default_days = weekdays_between(
            cycle.starts_at, cycle.ends_at, get_app_settings(db).zone
        )
        if abs(payload.working_days - default_days) < 1e-9:
            cycle.working_days = None
        else:
            cycle.working_days = payload.working_days

    apply_cycle_member_updates(
        db, cycle, team, payload.members, finalized=finalized
    )
    db.commit()
    return build_cycle_settings_out(db, team, cycle)


@router.post(
    "/{team_id}/cycle/finalize",
    response_model=CycleFinalizeOut,
    dependencies=[Depends(require_admin)],
)
def finalize_cycle(
    team_id: int,
    payload: CycleFinalizeIn | None = None,
    db: Session = Depends(get_db),
) -> CycleFinalizeOut:
    """Mark the team's current cycle as finalized (frozen).

    Optionally sync issue rows from Linear for the closing cycle first, then
    load Linear's active cycle when it is newer than the one being closed.
    """
    team = get_team_or_404(db, team_id)
    cycle = get_cycle(db, team)
    if cycle is None:
        raise HTTPException(
            status_code=400,
            detail="No cycle for this team yet. Refresh to load one.",
        )

    body = payload or CycleFinalizeIn()
    was_already_finalized = cycle.is_finalized
    with _tracked_sync_run(db, SyncKind.ISSUES, team_id=team.id) as run:
        try:
            with client_from_config(db) as client:
                summary = finalize_team_cycle(
                    db, client, team, refresh_issues=body.refresh_issues
                )
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        parts: list[str] = []
        if summary.issues_refreshed is not None:
            parts.append(
                f"Synced {summary.issues_refreshed} issue(s) for the closing cycle."
            )
        if not was_already_finalized:
            parts.append("Cycle finalized.")
        elif summary.advanced:
            parts.append("Loaded next cycle.")

        if summary.advanced and summary.advance is not None:
            if summary.advance.has_active_cycle:
                label = format_cycle_label(
                    summary.advance.cycle_name,
                    summary.advance.cycle_number,
                    summary.advance.cycle_id,
                )
                parts.append(
                    f"Loaded {summary.advance.issues_synced} issue(s) from {label}."
                )
            else:
                parts.append("No active cycle in Linear.")

        message = " ".join(parts) if parts else "Cycle finalized."
        issues_synced = summary.issues_refreshed or 0
        if summary.advance is not None:
            issues_synced += summary.advance.issues_synced

        record_sync_run(
            db,
            kind=SyncKind.ISSUES,
            status=SyncStatus.SUCCESS,
            team_id=team.id,
            message=message,
            issues_synced=issues_synced,
            run=run,
        )

    current = get_cycle(db, team)
    settings = build_cycle_settings_out(db, team, current)
    loaded_next = bool(
        summary.advanced and summary.advance is not None and summary.advance.has_active_cycle
    )
    return CycleFinalizeOut(
        **settings.model_dump(),
        loaded_next_cycle=loaded_next,
        issues_refreshed=summary.issues_refreshed,
    )

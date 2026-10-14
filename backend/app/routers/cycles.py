"""Cycle listing, settings, and finalize endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..app_settings import get_app_settings
from ..auth import require_admin
from ..cycles import apply_cycle_member_updates, build_cycle_settings_out
from ..database import get_db
from ..metrics import get_cycle, weekdays_between
from ..models import Cycle, utcnow
from ..schemas import CycleOut, CycleSettingsIn, CycleSettingsOut
from .deps import get_team_or_404, resolve_cycle_or_404

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
    response_model=CycleSettingsOut,
    dependencies=[Depends(require_admin)],
)
def finalize_cycle(team_id: int, db: Session = Depends(get_db)) -> CycleSettingsOut:
    """Mark the team's current cycle as finalized (frozen).

    Finalization preserves the cycle's data and is required before a refresh can
    switch the team to a newer cycle. It is scoped to one team, so teams on
    different cycle schedules roll over independently.
    """
    team = get_team_or_404(db, team_id)
    cycle = get_cycle(db, team)
    if cycle is None:
        raise HTTPException(
            status_code=400,
            detail="No cycle for this team yet. Refresh to load one.",
        )
    if not cycle.is_finalized:
        cycle.archived_at = utcnow()
        db.commit()
    return build_cycle_settings_out(db, team, cycle)

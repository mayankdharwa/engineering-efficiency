"""Efficiency metrics endpoint.

Computes planning efficiency, velocity and bandwidth efficiency from the locally
stored cycle data. See :mod:`app.metrics` for the definitions.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..costs import get_team_cost
from ..database import get_db
from ..metrics import compute_team_metrics
from ..schemas import TeamStatsOut
from .deps import get_team_or_404, resolve_cycle_or_404

router = APIRouter(prefix="/teams", tags=["stats"])


@router.get("/{team_id}/stats", response_model=TeamStatsOut)
def get_stats(
    team_id: int,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
) -> TeamStatsOut:
    team = get_team_or_404(db, team_id)
    cycle = resolve_cycle_or_404(db, team, cycle_id)

    metrics = compute_team_metrics(db, team, cycle=cycle)
    cost = get_team_cost(db, team_id)
    return TeamStatsOut(
        team_id=team_id,
        currency=cost.currency,
        man_day_cost=cost.man_day_cost,
        **asdict(metrics),
    )

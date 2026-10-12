"""Efficiency metrics endpoint.

Computes planning efficiency, velocity and bandwidth efficiency from the locally
stored cycle data. See :mod:`app.metrics` for the definitions.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..costs import get_team_cost
from ..database import get_db
from ..metrics import compute_team_metrics, get_cycle
from ..models import Team
from ..schemas import TeamStatsOut

router = APIRouter(prefix="/teams", tags=["stats"])


@router.get("/{team_id}/stats", response_model=TeamStatsOut)
def get_stats(
    team_id: int,
    db: Session = Depends(get_db),
    cycle_id: int | None = Query(default=None),
) -> TeamStatsOut:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found.")

    cycle = None
    if cycle_id is not None:
        cycle = get_cycle(db, team, cycle_id)
        if cycle is None:
            raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} not found.")

    metrics = compute_team_metrics(db, team, cycle=cycle)
    cost = get_team_cost(db, team_id)
    return TeamStatsOut(
        team_id=team_id,
        currency=cost.currency,
        man_day_cost=cost.man_day_cost,
        **asdict(metrics),
    )

"""Efficiency metrics endpoint.

Computes planning efficiency, velocity and bandwidth efficiency from the locally
stored current-cycle data. See :mod:`app.metrics` for the definitions.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..metrics import compute_team_metrics
from ..models import Team
from ..schemas import TeamStatsOut

router = APIRouter(prefix="/teams", tags=["stats"])


@router.get("/{team_id}/stats", response_model=TeamStatsOut)
def get_stats(team_id: int, db: Session = Depends(get_db)) -> TeamStatsOut:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found.")

    metrics = compute_team_metrics(db, team)
    return TeamStatsOut(team_id=team_id, **asdict(metrics))

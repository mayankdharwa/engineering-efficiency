"""Per-team cost configuration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..costs import TeamCostView, get_team_cost
from ..database import get_db
from ..models import TeamCost
from ..schemas import TeamCostIn, TeamCostOut
from .deps import get_team_or_404

router = APIRouter(prefix="/teams", tags=["costs"])


def _cost_out(team_id: int, view: TeamCostView) -> TeamCostOut:
    return TeamCostOut(
        team_id=team_id,
        currency=view.currency,
        man_day_cost=view.man_day_cost,
    )


@router.get("/{team_id}/cost", response_model=TeamCostOut)
def read_team_cost(team_id: int, db: Session = Depends(get_db)) -> TeamCostOut:
    """A team's currency symbol and man-day cost."""
    team = get_team_or_404(db, team_id)
    return _cost_out(team.id, get_team_cost(db, team.id))


@router.put("/{team_id}/cost", response_model=TeamCostOut)
def update_team_cost(
    team_id: int, payload: TeamCostIn, db: Session = Depends(get_db)
) -> TeamCostOut:
    """Save a team's currency symbol and man-day cost."""
    team = get_team_or_404(db, team_id)
    row = db.scalar(select(TeamCost).where(TeamCost.team_id == team.id))
    if row is None:
        row = TeamCost(team_id=team.id)
        db.add(row)
    row.currency = payload.currency
    row.man_day_cost = payload.man_day_cost
    db.commit()
    db.refresh(row)
    return _cost_out(team.id, get_team_cost(db, team.id))

"""Shared lookup helpers for the team-scoped routers."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..metrics import get_cycle
from ..models import Cycle, Team


def get_team_or_404(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found.")
    return team


def resolve_cycle_or_404(
    db: Session, team: Team, cycle_id: int | None
) -> Cycle | None:
    """Resolve an optional cycle id; 404 if the client named a missing cycle."""
    if cycle_id is None:
        return get_cycle(db, team)
    cycle = get_cycle(db, team, cycle_id)
    if cycle is None:
        raise HTTPException(status_code=404, detail=f"Cycle {cycle_id} not found.")
    return cycle

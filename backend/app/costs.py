"""Per-team cost preferences: currency symbol and man-day cost.

Values are stored in a :class:`~app.models.TeamCost` row (one per team) so they
can be edited from the Settings page and used to value work on
Cycles and Projects. When no row exists yet the defaults below are used.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import TeamCost

DEFAULT_CURRENCY = "$"
DEFAULT_MAN_DAY_COST = 0
CURRENCY_SYMBOLS = ("€", "$", "₹")


@dataclass(frozen=True)
class TeamCostView:
    """Resolved cost preferences, independent of whether a DB row exists."""

    currency: str = DEFAULT_CURRENCY
    man_day_cost: int = DEFAULT_MAN_DAY_COST


def get_team_cost(db: Session, team_id: int) -> TeamCostView:
    """Read a team's cost row, falling back to the defaults."""
    row = db.scalar(select(TeamCost).where(TeamCost.team_id == team_id))
    if row is None:
        return TeamCostView()
    return TeamCostView(
        currency=row.currency or DEFAULT_CURRENCY,
        man_day_cost=(row.man_day_cost if row.man_day_cost is not None else DEFAULT_MAN_DAY_COST),
    )

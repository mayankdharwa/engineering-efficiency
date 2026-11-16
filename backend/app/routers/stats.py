"""Efficiency metrics endpoint.

Computes planning efficiency, velocity and bandwidth efficiency from the locally
stored cycle data. See :mod:`app.metrics` for the definitions.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..costs import get_team_cost
from ..database import get_db
from ..metrics import TeamMetrics, compute_team_metrics
from ..models import Cycle
from ..schemas import (
    AnalyticsCycleOut,
    AnalyticsGroupOut,
    AnalyticsMemberOut,
    TeamAnalyticsOut,
    TeamStatsOut,
)
from .deps import get_team_or_404, resolve_cycle_or_404

router = APIRouter(prefix="/teams", tags=["stats"])

# Analytics compares this many most recent cycles, oldest to newest on the page.
ANALYTICS_CYCLE_COUNT = 6


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


@router.get("/{team_id}/analytics", response_model=TeamAnalyticsOut)
def get_analytics(team_id: int, db: Session = Depends(get_db)) -> TeamAnalyticsOut:
    """Velocity, bandwidth, and planning for the last six cycles.

    Cycles are oldest to newest. Each cycle repeats the team totals plus the
    same three ratios for every group and member, using the cycle metrics.
    """
    team = get_team_or_404(db, team_id)
    cycles = list(
        db.scalars(
            select(Cycle)
            .where(Cycle.team_id == team.id)
            .order_by(Cycle.number.desc().nullslast(), Cycle.id.desc())
            .limit(ANALYTICS_CYCLE_COUNT)
        ).all()
    )
    cycles.reverse()

    points = [
        _analytics_cycle(cycle, compute_team_metrics(db, team, cycle=cycle))
        for cycle in cycles
    ]
    return TeamAnalyticsOut(
        team_id=team_id,
        cycle_limit=ANALYTICS_CYCLE_COUNT,
        cycles=points,
    )


def _analytics_cycle(cycle: Cycle, metrics: TeamMetrics) -> AnalyticsCycleOut:
    """Slim a full cycle snapshot down to the three analytics ratios.

    The id comes from the stored cycle. ``compute_team_metrics`` is unready
    only when no cycle is given, and this caller always passes one.
    """
    return AnalyticsCycleOut(
        cycle_id=cycle.id,
        cycle_name=metrics.cycle_name,
        cycle_number=metrics.cycle_number,
        starts_at=metrics.starts_at,
        ends_at=metrics.ends_at,
        planning_efficiency=metrics.planning_efficiency,
        velocity=metrics.velocity,
        bandwidth_efficiency=metrics.bandwidth_efficiency,
        groups=[
            AnalyticsGroupOut(
                group_id=group.group_id,
                label=group.label,
                color=group.color,
                members=group.members,
                planning_efficiency=group.planning_efficiency,
                velocity=group.velocity,
                bandwidth_efficiency=group.bandwidth_efficiency,
            )
            for group in metrics.groups
        ],
        members=[
            AnalyticsMemberOut(
                linear_id=member.linear_id,
                name=member.name,
                group_id=member.group_id,
                group_name=member.group_name,
                group_color=member.group_color,
                counts_toward_capacity=member.counts_toward_capacity,
                planning_efficiency=member.planning_efficiency,
                velocity=member.velocity,
                bandwidth_efficiency=member.bandwidth_efficiency,
            )
            for member in metrics.members
            if member.linear_id is not None
        ],
    )

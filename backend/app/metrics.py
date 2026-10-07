"""Efficiency metrics computed from the locally stored cycle data.

Definitions (confirmed with product):

* A day's worth of work is :data:`POINTS_PER_DAY` points.
* ``working_days`` is configurable per cycle (defaults to the weekdays between
  the cycle's start and end dates).
* ``unavailable_days`` is planned leave per member per cycle.
* ``capacity`` = ``max(working_days - unavailable_days, 0) * POINTS_PER_DAY``.
  Only members with ``counts_toward_capacity`` contribute capacity; anyone else
  still contributes their ``taken`` points but with zero capacity.
* ``taken``  = sum of estimates assigned to the member (a null estimate is 0).
* ``done``   = sum of estimates for issues in a completed state.
* ``adhoc``  = sum of estimates for issues attached to the cycle *after its
  first day* (``added_to_cycle_at`` on a later date than the cycle start).
* ``planned`` = ``taken - adhoc``.

Derived per member:

* ``planning_efficiency`` = ``planned / taken`` (higher is better)
* ``velocity``            = ``done / (progress * taken)``, where ``progress`` is
  the fraction of the cycle's working days elapsed so far (0..1). At the end of
  the cycle this reduces to ``done / taken``; 100% means on pace.
* ``bandwidth_efficiency``= ``taken / capacity``

Team metrics are ratios of the team totals rather than sums of ratios.
Members may be tagged with a role (``DEV``/``QA``); the same metrics are also
aggregated per role so the dashboard can compare the groups.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CycleSettings, Issue, MemberUnavailability, Team, TeamMember, utcnow

POINTS_PER_DAY = 2.0
DEFAULT_WORKING_DAYS = 10.0
UNASSIGNED_LABEL = "Unassigned"

# Roles a member can be tagged with. Metrics are also aggregated per role.
ROLE_DEV = "DEV"
ROLE_QA = "QA"
ROLE_LABELS = {ROLE_DEV: "DEV", ROLE_QA: "QA", None: "Unspecified"}


def weekdays_between(start: datetime | None, end: datetime | None) -> float:
    """Count weekdays in the half-open interval ``[start, end)``.

    Treating the end date as exclusive gives the expected 10 working days for a
    two-week Linear cycle (whose ``endsAt`` is often the following Monday).
    """
    if start is None or end is None:
        return DEFAULT_WORKING_DAYS

    first, last = start.date(), end.date()
    if last < first:
        first, last = last, first
    if first == last:
        return 1.0 if first.weekday() < 5 else 0.0

    days = 0
    cursor = first
    while cursor < last:
        if cursor.weekday() < 5:
            days += 1
        cursor += timedelta(days=1)
    return float(days)


def _ratio(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def elapsed_working_days(start: datetime | None, now: datetime) -> float:
    """Count weekdays from ``start`` through ``now`` (inclusive).

    The current day counts as elapsed so that velocity is defined from the first
    day of the cycle rather than only after a full day has passed.
    """
    if start is None:
        return 0.0
    first, last = start.date(), now.date()
    if last < first:
        return 0.0
    days = 0
    cursor = first
    while cursor <= last:
        if cursor.weekday() < 5:
            days += 1
        cursor += timedelta(days=1)
    return float(days)


def _progress_fraction(
    starts_at: datetime | None, working_days: float, now: datetime
) -> float:
    """Fraction of the cycle's working days elapsed, clamped to ``[0, 1]``."""
    if working_days <= 0:
        return 0.0
    elapsed = elapsed_working_days(starts_at, now)
    return max(0.0, min(elapsed / working_days, 1.0))


@dataclass
class MemberMetrics:
    linear_id: str | None
    name: str
    email: str | None
    role: str | None
    counts_toward_capacity: bool
    unavailable_days: float
    capacity_points: float
    taken_points: float
    done_points: float
    adhoc_points: float
    planned_points: float
    unestimated_count: int
    planning_efficiency: float | None
    velocity: float | None
    bandwidth_efficiency: float | None


@dataclass
class VelocityTrendPoint:
    """Velocity as it stood at the end of one working day of the cycle."""

    date: str
    progress: float
    done_points: float
    expected_points: float
    velocity: float | None


@dataclass
class RoleMetrics:
    """Team metrics aggregated over the members sharing a role tag."""

    role: str | None
    label: str
    members: int
    capacity_points: float
    taken_points: float
    done_points: float
    adhoc_points: float
    planned_points: float
    unestimated_count: int
    planning_efficiency: float | None
    velocity: float | None
    bandwidth_efficiency: float | None
    velocity_trend: list[VelocityTrendPoint] = field(default_factory=list)


@dataclass
class TeamMetrics:
    ready: bool
    message: str | None = None
    cycle_id: str | None = None
    cycle_name: str | None = None
    cycle_number: float | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    working_days: float = DEFAULT_WORKING_DAYS
    default_working_days: float = DEFAULT_WORKING_DAYS
    working_days_overridden: bool = False
    points_per_day: float = POINTS_PER_DAY
    progress: float = 0.0
    total_taken_points: float = 0.0
    total_done_points: float = 0.0
    total_adhoc_points: float = 0.0
    total_planned_points: float = 0.0
    total_capacity_points: float = 0.0
    unestimated_issues: int = 0
    planning_efficiency: float | None = None
    velocity: float | None = None
    bandwidth_efficiency: float | None = None
    members: list[MemberMetrics] = field(default_factory=list)
    roles: list[RoleMetrics] = field(default_factory=list)
    velocity_trend: list[VelocityTrendPoint] = field(default_factory=list)


@dataclass
class _Bucket:
    taken: float = 0.0
    done: float = 0.0
    adhoc: float = 0.0
    unestimated: int = 0
    name: str | None = None


def get_cycle_settings(db: Session, team: Team) -> CycleSettings | None:
    if not team.current_cycle_id:
        return None
    return db.scalar(
        select(CycleSettings).where(
            CycleSettings.team_id == team.id,
            CycleSettings.cycle_id == team.current_cycle_id,
        )
    )


def compute_team_metrics(db: Session, team: Team) -> TeamMetrics:
    settings = get_cycle_settings(db, team)
    if settings is None:
        return TeamMetrics(
            ready=False,
            message=(
                "No active cycle stored for this team. Refresh the team to "
                "download its current cycle."
            ),
        )

    default_working_days = weekdays_between(settings.starts_at, settings.ends_at)
    working_days = (
        settings.working_days
        if settings.working_days is not None
        else default_working_days
    )
    working_days = max(working_days, 0.0)

    # Velocity is scaled by how far through the cycle we are, so a mid-cycle
    # number isn't penalised for the time that hasn't elapsed yet.
    now = utcnow()
    progress = _progress_fraction(settings.starts_at, working_days, now)

    issues = list(db.scalars(select(Issue).where(Issue.team_id == team.id)).all())
    members = list(
        db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all()
    )
    overrides = {
        row.member_linear_id: row.unavailable_days
        for row in db.scalars(
            select(MemberUnavailability).where(
                MemberUnavailability.team_id == team.id,
                MemberUnavailability.cycle_id == settings.cycle_id,
            )
        ).all()
    }

    # Bucket issues by assignee (None groups unassigned work).
    buckets: dict[str | None, _Bucket] = {}
    for issue in issues:
        key = issue.assignee_linear_id
        bucket = buckets.setdefault(key, _Bucket())
        if bucket.name is None:
            bucket.name = issue.assignee_name
        estimate = issue.estimate or 0.0
        bucket.taken += estimate
        if issue.state_type == "completed":
            bucket.done += estimate
        if _is_adhoc(issue, settings.starts_at):
            bucket.adhoc += estimate
        if issue.estimate is None:
            bucket.unestimated += 1

    member_by_id = {member.linear_id: member for member in members}
    # Members who count toward capacity, plus anyone who owns work this cycle.
    # People who do not count still surface their points, but with 0 capacity.
    member_ids: list[str] = [
        member.linear_id
        for member in members
        if member.counts_toward_capacity or member.linear_id in buckets
    ]
    for key in buckets:
        if key is not None and key not in member_by_id and key not in member_ids:
            member_ids.append(key)

    rows: list[MemberMetrics] = []
    for linear_id in member_ids:
        member = member_by_id.get(linear_id)
        bucket = buckets.get(linear_id, _Bucket())
        name = (
            (member.display_name or member.name) if member else None
        ) or bucket.name or linear_id
        counts = bool(member.counts_toward_capacity) if member else False
        rows.append(
            _build_member_metrics(
                linear_id=linear_id,
                name=name,
                email=member.email if member else None,
                role=member.role if member else None,
                # Only members opted into capacity get the full allowance;
                # assignees outside the team count their work but no capacity.
                counts_toward_capacity=counts,
                unavailable=overrides.get(linear_id, 0.0),
                working_days=working_days,
                progress=progress,
                bucket=bucket,
                capacity_points=None if counts else 0.0,
            )
        )

    if None in buckets:
        rows.append(
            _build_member_metrics(
                linear_id=None,
                name=UNASSIGNED_LABEL,
                email=None,
                counts_toward_capacity=False,
                unavailable=0.0,
                working_days=working_days,
                progress=progress,
                bucket=buckets[None],
                capacity_points=0.0,
            )
        )

    rows.sort(key=lambda row: (row.linear_id is None, row.name.lower()))

    # Aggregate the per-person rows by role tag. Unassigned work (the synthetic
    # row) is excluded so the groups only reflect real members.
    role_groups: dict[str | None, list[MemberMetrics]] = {}
    for row in rows:
        if row.linear_id is None:
            continue
        role_groups.setdefault(row.role, []).append(row)

    def _trend_for(group: list[MemberMetrics]) -> list[VelocityTrendPoint]:
        member_ids = {row.linear_id for row in group if row.linear_id is not None}
        member_issues = [
            issue for issue in issues if issue.assignee_linear_id in member_ids
        ]
        return _velocity_trend(
            member_issues, settings.starts_at, settings.ends_at, working_days, now
        )

    role_rows: list[RoleMetrics] = []
    for role in (ROLE_DEV, ROLE_QA):
        group = role_groups.get(role, [])
        role_rows.append(_build_role_metrics(role, group, progress, _trend_for(group)))
    unspecified = role_groups.get(None, [])
    if unspecified:
        role_rows.append(
            _build_role_metrics(None, unspecified, progress, _trend_for(unspecified))
        )

    velocity_trend = _velocity_trend(
        issues, settings.starts_at, settings.ends_at, working_days, now
    )

    total_taken = sum(row.taken_points for row in rows)
    total_done = sum(row.done_points for row in rows)
    total_adhoc = sum(row.adhoc_points for row in rows)
    total_planned = sum(row.planned_points for row in rows)
    total_capacity = sum(row.capacity_points for row in rows)

    return TeamMetrics(
        ready=True,
        cycle_id=settings.cycle_id,
        cycle_name=settings.cycle_name,
        cycle_number=settings.cycle_number,
        starts_at=settings.starts_at,
        ends_at=settings.ends_at,
        working_days=working_days,
        default_working_days=default_working_days,
        working_days_overridden=settings.working_days is not None,
        points_per_day=POINTS_PER_DAY,
        progress=progress,
        total_taken_points=total_taken,
        total_done_points=total_done,
        total_adhoc_points=total_adhoc,
        total_planned_points=total_planned,
        total_capacity_points=total_capacity,
        unestimated_issues=sum(row.unestimated_count for row in rows),
        planning_efficiency=_ratio(total_planned, total_taken),
        velocity=_ratio(total_done, progress * total_taken),
        bandwidth_efficiency=_ratio(total_taken, total_capacity),
        members=rows,
        roles=role_rows,
        velocity_trend=velocity_trend,
    )


def _is_adhoc(issue: Issue, cycle_start: datetime | None) -> bool:
    """Adhoc work = attached strictly after the cycle's first day.

    Anything attached on the cycle's start date counts as planned; only work
    attached from the second day onwards is adhoc.
    """
    added = issue.added_to_cycle_at
    if added is None or cycle_start is None:
        return False
    return _comparable(added).date() > _comparable(cycle_start).date()


def _comparable(value: datetime) -> datetime:
    """Normalise timestamps to naive UTC so aware/naive rows compare safely.

    SQLite returns naive datetimes for ``DateTime(timezone=True)`` columns, but
    values can still be aware in-memory right after a sync.
    """
    if value.tzinfo is not None:
        return value.astimezone(utcnow().tzinfo).replace(tzinfo=None)
    return value


def _velocity_trend(
    issues: list[Issue],
    starts_at: datetime | None,
    ends_at: datetime | None,
    working_days: float,
    now: datetime,
) -> list[VelocityTrendPoint]:
    """Velocity as it stood at the end of each working day so far.

    For every weekday from the cycle start through today (capped at the cycle
    end) this recomputes the velocity formula using the points completed *by*
    that day and the points expected by that day (``progress × taken``). The
    final point therefore matches the headline velocity for the same issue set.
    """
    if starts_at is None or working_days <= 0:
        return []

    start = _comparable(starts_at).date()
    last = _comparable(now).date()
    if ends_at is not None:
        last = min(last, _comparable(ends_at).date())
    if last < start:
        return []

    taken_total = sum(issue.estimate or 0.0 for issue in issues)
    completions = [
        (_comparable(issue.completed_at).date(), issue.estimate or 0.0)
        for issue in issues
        if issue.state_type == "completed" and issue.completed_at is not None
    ]

    points: list[VelocityTrendPoint] = []
    cursor = start
    while cursor <= last:
        if cursor.weekday() < 5:
            end_of_day = datetime(cursor.year, cursor.month, cursor.day, 23, 59)
            progress = _progress_fraction(starts_at, working_days, end_of_day)
            done = sum(points for day, points in completions if day <= cursor)
            expected = progress * taken_total
            points.append(
                VelocityTrendPoint(
                    date=cursor.isoformat(),
                    progress=progress,
                    done_points=done,
                    expected_points=expected,
                    velocity=_ratio(done, expected),
                )
            )
        cursor += timedelta(days=1)
    return points


def _build_role_metrics(
    role: str | None,
    group: list[MemberMetrics],
    progress: float,
    velocity_trend: list[VelocityTrendPoint] | None = None,
) -> RoleMetrics:
    """Aggregate member rows sharing a role into a team-style ratio of totals."""
    taken = sum(row.taken_points for row in group)
    done = sum(row.done_points for row in group)
    adhoc = sum(row.adhoc_points for row in group)
    planned = sum(row.planned_points for row in group)
    capacity = sum(row.capacity_points for row in group)
    return RoleMetrics(
        role=role,
        label=ROLE_LABELS.get(role, role or "Unspecified"),
        members=len(group),
        capacity_points=capacity,
        taken_points=taken,
        done_points=done,
        adhoc_points=adhoc,
        planned_points=planned,
        unestimated_count=sum(row.unestimated_count for row in group),
        planning_efficiency=_ratio(planned, taken),
        velocity=_ratio(done, progress * taken),
        bandwidth_efficiency=_ratio(taken, capacity),
        velocity_trend=velocity_trend or [],
    )


def _build_member_metrics(
    *,
    linear_id: str | None,
    name: str,
    email: str | None,
    role: str | None = None,
    counts_toward_capacity: bool = True,
    unavailable: float,
    working_days: float,
    progress: float = 1.0,
    bucket: _Bucket,
    capacity_points: float | None = None,
) -> MemberMetrics:
    if capacity_points is None:
        capacity_points = max(working_days - unavailable, 0.0) * POINTS_PER_DAY
    planned = bucket.taken - bucket.adhoc
    return MemberMetrics(
        linear_id=linear_id,
        name=name,
        email=email,
        role=role,
        counts_toward_capacity=counts_toward_capacity,
        unavailable_days=unavailable,
        capacity_points=capacity_points,
        taken_points=bucket.taken,
        done_points=bucket.done,
        adhoc_points=bucket.adhoc,
        planned_points=planned,
        unestimated_count=bucket.unestimated,
        planning_efficiency=_ratio(planned, bucket.taken),
        velocity=_ratio(bucket.done, progress * bucket.taken),
        bandwidth_efficiency=_ratio(bucket.taken, capacity_points),
    )

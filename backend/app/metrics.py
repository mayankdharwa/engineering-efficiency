"""Efficiency metrics computed from the locally stored cycle data.

Definitions (confirmed with product):

* A day's worth of work is :data:`POINTS_PER_DAY` points.
* ``working_days`` is configurable per cycle (defaults to the weekdays between
  the cycle's start and end dates).
* ``unavailable_days`` is planned leave per member per cycle.
* Group assignment and ``counts_toward_capacity`` are snapshotted per cycle
  (copied forward when a new cycle is created).
* ``capacity`` = ``max(working_days - unavailable_days, 0) * POINTS_PER_DAY``.
  Only members with ``counts_toward_capacity`` on that cycle contribute
  capacity; anyone else still contributes their ``taken`` points but with zero
  capacity.
* ``taken``  = sum of estimates assigned to the member (a null estimate is 0).
* ``done``   = sum of estimates for issues in a completed state.
* ``adhoc``  = sum of estimates for issues attached to the cycle *after its
  first day* (``added_to_cycle_at`` on a later date than the cycle start).
  ``adhoc_by_day`` breaks those points down by the local calendar date they
  were attached and by assignee; ``adhoc_dates`` is every calendar day in the
  cycle so the chart axis stays complete even when a day has no adhoc work.
* ``planned`` = ``taken - adhoc``.

Derived per member:

* ``planning_efficiency`` = ``planned / taken`` (higher is better)
* ``velocity``            = ``done / expected``, where per-person ``expected``
  is ``POINTS_PER_DAY × min(elapsed, available days)``. Available days are
  ``max(working_days - unavailable_days, 0)``. 100% means they finished 2
  points for each day they should have been working. Taken is not in the
  denominator: a light load pulls velocity down after the backlog is gone.
  Team and group velocity use the same definition rolled up:
  ``sum(done) / sum(expected)``. The cycle ``progress`` field is still
  elapsed working days over ``working_days`` (calendar pace). A day only
  counts once the configured end-of-day cutoff (in the configured timezone)
  has passed. At the end of a person's available days this reduces to
  ``done / capacity``; finishing all taken work then equals bandwidth.
* ``bandwidth_efficiency``= ``taken / capacity``

Team metrics are ratios of the team totals rather than sums of ratios.
Members may be assigned to a per-team group; the same metrics are also
aggregated per group so the dashboard can compare them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from .app_settings import DEFAULT_DAY_CUTOFF_HOUR, get_app_settings
from .cycles import load_team_cycle_data
from .group_colors import resolve_color
from .models import Cycle, Issue, Team, utcnow

POINTS_PER_DAY = 2.0
DEFAULT_WORKING_DAYS = 10.0
UNASSIGNED_LABEL = "Unassigned"


def _to_local(value: datetime, tz: ZoneInfo) -> datetime:
    """Convert a stored timestamp to the configured working timezone.

    Stored values are UTC (naive or aware); this normalises them first so the
    local calendar date and clock time are always interpreted consistently.
    """
    return _comparable(value).replace(tzinfo=UTC).astimezone(tz)


def _effective_date(now_local: datetime, cutoff_hour: int) -> date:
    """The last calendar day that counts as elapsed.

    Before the cutoff the current day is still in progress, so it does not count
    yet and the previous day is returned instead.
    """
    if now_local.hour < cutoff_hour:
        return now_local.date() - timedelta(days=1)
    return now_local.date()


def _count_weekdays(first: date, last: date) -> float:
    """Count weekdays in the inclusive interval ``[first, last]``."""
    if last < first:
        return 0.0
    days = 0
    cursor = first
    while cursor <= last:
        if cursor.weekday() < 5:
            days += 1
        cursor += timedelta(days=1)
    return float(days)


def weekdays_between(
    start: datetime | None, end: datetime | None, tz: ZoneInfo | None = None
) -> float:
    """Count weekdays in the half-open interval ``[start, end)``.

    Treating the end date as exclusive gives the expected 10 working days for a
    two-week Linear cycle (whose ``endsAt`` is often the following Monday). Dates
    are resolved in the configured working timezone.
    """
    if start is None or end is None:
        return DEFAULT_WORKING_DAYS

    zone = tz or ZoneInfo("UTC")
    first, last = _to_local(start, zone).date(), _to_local(end, zone).date()
    if last < first:
        first, last = last, first
    if first == last:
        return 1.0 if first.weekday() < 5 else 0.0

    return _count_weekdays(first, last - timedelta(days=1))


def _ratio(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return numerator / denominator


def elapsed_working_days(
    start: datetime | None,
    now: datetime,
    tz: ZoneInfo | None = None,
    cutoff_hour: int = DEFAULT_DAY_CUTOFF_HOUR,
) -> float:
    """Count weekdays from ``start`` through the last *elapsed* day inclusive.

    A day only counts once the configured cutoff hour has passed in the working
    timezone. Before the cutoff the current day is still underway, so it is not
    treated as elapsed (fixing velocity being penalised mid-day).
    """
    if start is None:
        return 0.0
    zone = tz or ZoneInfo("UTC")
    first = _to_local(start, zone).date()
    last = _effective_date(_to_local(now, zone), cutoff_hour)
    return _count_weekdays(first, last)


def remaining_weekdays(
    end: date | None,
    now: datetime,
    tz: ZoneInfo | None = None,
    cutoff_hour: int = DEFAULT_DAY_CUTOFF_HOUR,
) -> float:
    """Count weekdays still available from now through ``end`` inclusive.

    Uses the same working timezone and cutoff as :func:`elapsed_working_days`:
    today stays available only before the cutoff hour, then remaining days
    start tomorrow.
    """
    if end is None:
        return 0.0
    zone = tz or ZoneInfo("UTC")
    first = _effective_date(_to_local(now, zone), cutoff_hour) + timedelta(days=1)
    return _count_weekdays(first, end)


def _days_passed_fraction(
    elapsed: float,
    working_days: float,
    available_days: float | None = None,
) -> float:
    """Days-passed fraction for velocity, clamped to ``[0, 1]``.

    Team progress omits ``available_days`` and uses the cycle length. Per
    person the denominator is available days, so
    ``min(elapsed, available) / available`` — finishing their taken work in
    their available time is 100%.
    """
    denominator = working_days if available_days is None else max(available_days, 0.0)
    if denominator <= 0:
        return 0.0
    passed = min(max(elapsed, 0.0), denominator)
    return max(0.0, min(passed / denominator, 1.0))


def _available_days(working_days: float, unavailable: float) -> float:
    return max(working_days - unavailable, 0.0)


def _expected_points(elapsed: float, working_days: float, unavailable: float) -> float:
    """Points a person should have finished: 2 per day they should have worked."""
    available = _available_days(working_days, unavailable)
    return POINTS_PER_DAY * min(max(elapsed, 0.0), available)


def _progress_fraction(
    starts_at: datetime | None,
    working_days: float,
    now: datetime,
    tz: ZoneInfo | None = None,
    cutoff_hour: int = DEFAULT_DAY_CUTOFF_HOUR,
) -> float:
    """Fraction of the cycle's working days elapsed, clamped to ``[0, 1]``."""
    elapsed = elapsed_working_days(starts_at, now, tz, cutoff_hour)
    return _days_passed_fraction(elapsed, working_days)


@dataclass
class MemberMetrics:
    linear_id: str | None
    name: str
    email: str | None
    group_id: int | None
    group_name: str | None
    group_color: str | None
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
class AdhocByDayPoint:
    """Adhoc points attached on one calendar day, for one assignee."""

    date: str
    assignee: str
    linear_id: str | None
    group_id: int | None
    points: float


@dataclass
class GroupMetrics:
    """Team metrics aggregated over the members sharing a group."""

    group_id: int | None
    label: str
    color: str | None
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
    cycle_id: int | None = None
    cycle_linear_id: str | None = None
    cycle_name: str | None = None
    cycle_number: int | None = None
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
    groups: list[GroupMetrics] = field(default_factory=list)
    velocity_trend: list[VelocityTrendPoint] = field(default_factory=list)
    adhoc_dates: list[str] = field(default_factory=list)
    adhoc_by_day: list[AdhocByDayPoint] = field(default_factory=list)


@dataclass
class _AssigneeIssueTotals:
    taken: float = 0.0
    done: float = 0.0
    adhoc: float = 0.0
    unestimated: int = 0
    name: str | None = None


def get_cycle(
    db: Session, team: Team, cycle_id: int | None = None
) -> Cycle | None:
    """Load a team's cycle by id, defaulting to the team's current cycle."""
    target_id = cycle_id if cycle_id is not None else team.current_cycle_id
    if target_id is None:
        return None
    cycle = db.get(Cycle, target_id)
    if cycle is None or cycle.team_id != team.id:
        return None
    return cycle


def compute_team_metrics(
    db: Session, team: Team, cycle: Cycle | None = None
) -> TeamMetrics:
    cycle = cycle if cycle is not None else get_cycle(db, team)
    if cycle is None:
        return TeamMetrics(
            ready=False,
            message="No cycle for this team yet. Refresh to load one.",
        )

    # Working-calendar preferences: which timezone defines a "day" and the
    # local hour after which the current day counts as elapsed.
    preferences = get_app_settings(db)
    zone = preferences.zone
    cutoff_hour = preferences.day_cutoff_hour

    default_working_days = weekdays_between(cycle.starts_at, cycle.ends_at, zone)
    working_days = (
        cycle.working_days if cycle.working_days is not None else default_working_days
    )
    working_days = max(working_days, 0.0)

    # Velocity is scaled by how far through the cycle we are, so a mid-cycle
    # number isn't penalised for the time that hasn't elapsed yet. The current
    # day only counts once the cutoff hour has passed.
    now = utcnow()
    elapsed = elapsed_working_days(cycle.starts_at, now, zone, cutoff_hour)
    progress = _days_passed_fraction(elapsed, working_days)

    ctx = load_team_cycle_data(db, team, cycle)
    issues = ctx.issues
    members = ctx.members
    groups = ctx.groups
    memberships = ctx.memberships
    group_name_by_id = {group.id: group.name for group in groups}
    group_color_by_id = {group.id: resolve_color(group.color) for group in groups}

    # Bucket issues by assignee (None groups unassigned work).
    buckets: dict[str | None, _AssigneeIssueTotals] = {}
    for issue in issues:
        key = issue.assignee_linear_id
        bucket = buckets.setdefault(key, _AssigneeIssueTotals())
        if bucket.name is None:
            bucket.name = issue.assignee_name
        estimate = issue.estimate or 0.0
        bucket.taken += estimate
        if issue.is_completed:
            bucket.done += estimate
        if _is_adhoc(issue, cycle.starts_at, zone):
            bucket.adhoc += estimate
        if issue.estimate is None:
            bucket.unestimated += 1

    member_by_id = {member.linear_id: member for member in members}
    # Snapshot members who count toward capacity, plus anyone who owns work.
    # People who do not count still surface their points, but with 0 capacity.
    member_ids: list[str] = [
        linear_id
        for linear_id, snapshot in memberships.items()
        if snapshot.counts_toward_capacity or linear_id in buckets
    ]
    for key in buckets:
        if key is not None and key not in member_ids:
            member_ids.append(key)

    rows: list[MemberMetrics] = []
    for linear_id in member_ids:
        member = member_by_id.get(linear_id)
        snapshot = memberships.get(linear_id)
        bucket = buckets.get(linear_id, _AssigneeIssueTotals())
        name = (
            (member.display_name or member.name) if member else None
        ) or bucket.name or linear_id
        counts = bool(snapshot.counts_toward_capacity) if snapshot is not None else False
        member_group_id = snapshot.group_id if snapshot is not None else None
        rows.append(
            _build_member_metrics(
                linear_id=linear_id,
                name=name,
                email=member.email if member else None,
                group_id=member_group_id,
                group_name=(
                    group_name_by_id.get(member_group_id)
                    if member_group_id is not None
                    else None
                ),
                group_color=(
                    group_color_by_id.get(member_group_id)
                    if member_group_id is not None
                    else None
                ),
                # Only members opted into capacity get the full allowance;
                # assignees outside the team count their work but no capacity.
                counts_toward_capacity=counts,
                unavailable=snapshot.unavailable_days if snapshot is not None else 0.0,
                working_days=working_days,
                elapsed=elapsed,
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
                group_id=None,
                group_name=None,
                group_color=None,
                counts_toward_capacity=False,
                unavailable=0.0,
                working_days=working_days,
                elapsed=elapsed,
                bucket=buckets[None],
                capacity_points=0.0,
            )
        )

    rows.sort(key=lambda row: (row.linear_id is None, row.name.lower()))

    # Aggregate the per-person rows by group. Unassigned work (the synthetic
    # row) is excluded so the groups only reflect real members.
    grouped: dict[int | None, list[MemberMetrics]] = {}
    for row in rows:
        if row.linear_id is None:
            continue
        grouped.setdefault(row.group_id, []).append(row)

    def _trend_for(group: list[MemberMetrics]) -> list[VelocityTrendPoint]:
        member_ids = {row.linear_id for row in group if row.linear_id is not None}
        member_issues = [
            issue for issue in issues if issue.assignee_linear_id in member_ids
        ]
        return _velocity_trend(
            member_issues,
            cycle.starts_at,
            cycle.ends_at,
            working_days,
            now,
            zone,
            cutoff_hour,
            {row.linear_id: max(working_days - row.unavailable_days, 0.0) for row in group},
        )

    # One row per defined group (in creation order), plus an "Unassigned" row
    # for real members who are not in any group.
    group_rows: list[GroupMetrics] = []
    for group in groups:
        members_in_group = grouped.get(group.id, [])
        group_rows.append(
            _build_group_metrics(
                group.id,
                group.name,
                members_in_group,
                elapsed,
                working_days,
                _trend_for(members_in_group),
                resolve_color(group.color),
            )
        )
    ungrouped = grouped.get(None, [])
    if ungrouped:
        group_rows.append(
            _build_group_metrics(
                None,
                UNASSIGNED_LABEL,
                ungrouped,
                elapsed,
                working_days,
                _trend_for(ungrouped),
                None,
            )
        )

    velocity_trend = _velocity_trend(
        issues,
        cycle.starts_at,
        cycle.ends_at,
        working_days,
        now,
        zone,
        cutoff_hour,
        {row.linear_id: max(working_days - row.unavailable_days, 0.0) for row in rows},
    )
    name_by_id = {row.linear_id: row.name for row in rows if row.linear_id is not None}
    group_by_id = {row.linear_id: row.group_id for row in rows if row.linear_id is not None}
    adhoc_dates = cycle_calendar_dates(cycle.starts_at, cycle.ends_at, zone)
    adhoc_by_day = _adhoc_by_day(issues, cycle.starts_at, zone, name_by_id, group_by_id)

    total_taken = sum(row.taken_points for row in rows)
    total_done = sum(row.done_points for row in rows)
    total_adhoc = sum(row.adhoc_points for row in rows)
    total_planned = sum(row.planned_points for row in rows)
    total_capacity = sum(row.capacity_points for row in rows)

    return TeamMetrics(
        ready=True,
        cycle_id=cycle.id,
        cycle_linear_id=cycle.linear_id,
        cycle_name=cycle.name,
        cycle_number=cycle.number,
        starts_at=cycle.starts_at,
        ends_at=cycle.ends_at,
        working_days=working_days,
        default_working_days=default_working_days,
        working_days_overridden=cycle.working_days is not None,
        points_per_day=POINTS_PER_DAY,
        progress=progress,
        total_taken_points=total_taken,
        total_done_points=total_done,
        total_adhoc_points=total_adhoc,
        total_planned_points=total_planned,
        total_capacity_points=total_capacity,
        unestimated_issues=sum(row.unestimated_count for row in rows),
        planning_efficiency=_ratio(total_planned, total_taken),
        velocity=_ratio(
            total_done,
            sum(
                _expected_points(elapsed, working_days, row.unavailable_days)
                for row in rows
            ),
        ),
        bandwidth_efficiency=_ratio(total_taken, total_capacity),
        members=rows,
        groups=group_rows,
        velocity_trend=velocity_trend,
        adhoc_dates=adhoc_dates,
        adhoc_by_day=adhoc_by_day,
    )


def cycle_calendar_dates(
    starts_at: datetime | None,
    ends_at: datetime | None,
    tz: ZoneInfo,
) -> list[str]:
    """Every calendar date in the half-open cycle interval ``[start, end)``.

    Dates are resolved in the working timezone so they match adhoc bucketing.
    """
    if starts_at is None:
        return []
    first = _to_local(starts_at, tz).date()
    if ends_at is None:
        return [first.isoformat()]
    last = _to_local(ends_at, tz).date()
    if last <= first:
        return [first.isoformat()]
    dates: list[str] = []
    cursor = first
    while cursor < last:
        dates.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return dates


def _adhoc_by_day(
    issues: list[Issue],
    starts_at: datetime | None,
    tz: ZoneInfo,
    name_by_id: dict[str, str],
    group_by_id: dict[str, int | None],
) -> list[AdhocByDayPoint]:
    """Adhoc points attached on each calendar day, grouped by assignee.

    Unestimated issues contribute 0 and are omitted. Planned work (attached on
    the cycle's first day) is excluded.
    """
    buckets: dict[tuple[str, str | None], float] = {}
    issue_name: dict[str | None, str] = {}
    for issue in issues:
        if not _is_adhoc(issue, starts_at, tz):
            continue
        added = issue.added_to_cycle_at
        if added is None:
            continue
        points = issue.estimate or 0.0
        if points <= 0:
            continue
        day = _to_local(added, tz).date().isoformat()
        key = (day, issue.assignee_linear_id)
        buckets[key] = buckets.get(key, 0.0) + points
        if issue.assignee_linear_id not in issue_name and issue.assignee_name:
            issue_name[issue.assignee_linear_id] = issue.assignee_name

    rows: list[AdhocByDayPoint] = []
    for (day, linear_id), points in sorted(
        buckets.items(),
        key=lambda item: (item[0][0], (item[0][1] or "")),
    ):
        if linear_id is None:
            name = UNASSIGNED_LABEL
            group_id = None
        else:
            name = name_by_id.get(linear_id) or issue_name.get(linear_id) or linear_id
            group_id = group_by_id.get(linear_id)
        rows.append(
            AdhocByDayPoint(
                date=day,
                assignee=name,
                linear_id=linear_id,
                group_id=group_id,
                points=points,
            )
        )
    return rows


def _is_adhoc(issue: Issue, cycle_start: datetime | None, tz: ZoneInfo) -> bool:
    """Adhoc work = attached strictly after the cycle's first day.

    Anything attached on the cycle's start date counts as planned; only work
    attached from the second day onwards is adhoc. Calendar days are resolved in
    the configured working timezone.
    """
    added = issue.added_to_cycle_at
    if added is None or cycle_start is None:
        return False
    return _to_local(added, tz).date() > _to_local(cycle_start, tz).date()


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
    tz: ZoneInfo,
    cutoff_hour: int,
    available_by_assignee: dict[str | None, float] | None = None,
) -> list[VelocityTrendPoint]:
    """Velocity as it stood at the end of each elapsed working day.

    For every elapsed weekday from the cycle start (capped at the cycle end)
    this recomputes the velocity formula using the points completed *by* that
    day and the points expected by that day. Expected work uses each
    assignee's available days when provided, matching headline velocity.
    A day only counts once the configured cutoff hour has passed.
    """
    if starts_at is None or working_days <= 0:
        return []

    start = _to_local(starts_at, tz).date()
    last = _effective_date(_to_local(now, tz), cutoff_hour)
    if ends_at is not None:
        last = min(last, _to_local(ends_at, tz).date())
    if last < start:
        return []

    completions = [
        (_to_local(issue.completed_at, tz).date(), issue.estimate or 0.0)
        for issue in issues
        if issue.is_completed and issue.completed_at is not None
    ]
    if available_by_assignee is not None:
        available_slots = list(available_by_assignee.values())
    else:
        assignees = {issue.assignee_linear_id for issue in issues}
        available_slots = [working_days] * len(assignees)

    points: list[VelocityTrendPoint] = []
    elapsed = 0
    cursor = start
    while cursor <= last:
        if cursor.weekday() < 5:
            elapsed += 1
            progress = _days_passed_fraction(elapsed, working_days)
            done = sum(value for day, value in completions if day <= cursor)
            expected = sum(
                POINTS_PER_DAY * min(elapsed, max(available, 0.0))
                for available in available_slots
            )
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


def _build_group_metrics(
    group_id: int | None,
    label: str,
    group: list[MemberMetrics],
    elapsed: float,
    working_days: float,
    velocity_trend: list[VelocityTrendPoint] | None = None,
    color: str | None = None,
) -> GroupMetrics:
    """Aggregate member rows in a group into a team-style ratio of totals."""
    taken = sum(row.taken_points for row in group)
    done = sum(row.done_points for row in group)
    adhoc = sum(row.adhoc_points for row in group)
    planned = sum(row.planned_points for row in group)
    capacity = sum(row.capacity_points for row in group)
    expected = sum(
        _expected_points(elapsed, working_days, row.unavailable_days) for row in group
    )
    return GroupMetrics(
        group_id=group_id,
        label=label,
        color=color,
        members=len(group),
        capacity_points=capacity,
        taken_points=taken,
        done_points=done,
        adhoc_points=adhoc,
        planned_points=planned,
        unestimated_count=sum(row.unestimated_count for row in group),
        planning_efficiency=_ratio(planned, taken),
        velocity=_ratio(done, expected),
        bandwidth_efficiency=_ratio(taken, capacity),
        velocity_trend=velocity_trend or [],
    )


def _build_member_metrics(
    *,
    linear_id: str | None,
    name: str,
    email: str | None,
    group_id: int | None = None,
    group_name: str | None = None,
    group_color: str | None = None,
    counts_toward_capacity: bool = True,
    unavailable: float,
    working_days: float,
    elapsed: float = 0.0,
    bucket: _AssigneeIssueTotals,
    capacity_points: float | None = None,
) -> MemberMetrics:
    available_days = _available_days(working_days, unavailable)
    if capacity_points is None:
        capacity_points = available_days * POINTS_PER_DAY
    planned = bucket.taken - bucket.adhoc
    expected = _expected_points(elapsed, working_days, unavailable)
    return MemberMetrics(
        linear_id=linear_id,
        name=name,
        email=email,
        group_id=group_id,
        group_name=group_name,
        group_color=group_color,
        counts_toward_capacity=counts_toward_capacity,
        unavailable_days=unavailable,
        capacity_points=capacity_points,
        taken_points=bucket.taken,
        done_points=bucket.done,
        adhoc_points=bucket.adhoc,
        planned_points=planned,
        unestimated_count=bucket.unestimated,
        planning_efficiency=_ratio(planned, bucket.taken),
        velocity=_ratio(bucket.done, expected),
        bandwidth_efficiency=_ratio(bucket.taken, capacity_points),
    )

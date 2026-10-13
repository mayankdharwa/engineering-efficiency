"""Tests for the timezone/cutoff-aware working-day calculations."""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.metrics import (
    _adhoc_by_day,
    _is_adhoc,
    _progress_fraction,
    _velocity_trend,
    compute_team_metrics,
    cycle_calendar_dates,
    elapsed_working_days,
    remaining_weekdays,
    weekdays_between,
)
from app.models import AppSettings, Cycle, CycleMembership, Issue, Team, TeamMember

UTC_ZONE = ZoneInfo("UTC")
KOLKATA = ZoneInfo("Asia/Kolkata")
LOS_ANGELES = ZoneInfo("America/Los_Angeles")

CUTOFF = 19


def test_elapsed_working_days_excludes_today_before_cutoff() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)  # Monday
    # Wednesday 11:30, before the 19:00 cutoff: only Mon + Tue count.
    now = datetime(2026, 10, 7, 11, 30, tzinfo=UTC)
    assert elapsed_working_days(start, now, UTC_ZONE, CUTOFF) == 2.0


def test_elapsed_working_days_includes_today_after_cutoff() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)  # Monday
    now = datetime(2026, 10, 7, 19, 30, tzinfo=UTC)  # Wednesday after cutoff
    assert elapsed_working_days(start, now, UTC_ZONE, CUTOFF) == 3.0


def test_elapsed_working_days_ignores_weekends() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)  # Monday
    # Saturday after cutoff: still five weekdays in the cycle so far.
    now = datetime(2026, 10, 10, 20, 0, tzinfo=UTC)
    assert elapsed_working_days(start, now, UTC_ZONE, CUTOFF) == 5.0


def test_elapsed_working_days_zero_before_first_day_cutoff() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)
    now = datetime(2026, 10, 5, 11, 30, tzinfo=UTC)  # Monday before cutoff
    assert elapsed_working_days(start, now, UTC_ZONE, CUTOFF) == 0.0


def test_elapsed_working_days_follows_configured_timezone() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)
    now = datetime(2026, 10, 7, 13, 30, tzinfo=UTC)  # 13:30 UTC == 19:00 IST
    assert elapsed_working_days(start, now, UTC_ZONE, CUTOFF) == 2.0
    assert elapsed_working_days(start, now, KOLKATA, CUTOFF) == 3.0


def test_elapsed_working_days_negative_offset_timezone() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)
    now = datetime(2026, 10, 8, 20, 0, tzinfo=UTC)  # 13:00 in L.A., before cutoff
    assert elapsed_working_days(start, now, UTC_ZONE, CUTOFF) == 4.0
    assert elapsed_working_days(start, now, LOS_ANGELES, CUTOFF) == 3.0


def test_remaining_weekdays_includes_today_before_cutoff() -> None:
    now = datetime(2026, 10, 14, 11, 30, tzinfo=UTC)  # Wednesday
    assert remaining_weekdays(date(2026, 10, 16), now, UTC_ZONE, CUTOFF) == 3.0


def test_remaining_weekdays_excludes_today_after_cutoff() -> None:
    now = datetime(2026, 10, 14, 19, 30, tzinfo=UTC)  # Wednesday after cutoff
    assert remaining_weekdays(date(2026, 10, 16), now, UTC_ZONE, CUTOFF) == 2.0


def test_remaining_weekdays_skips_weekends() -> None:
    now = datetime(2026, 10, 16, 11, 0, tzinfo=UTC)  # Friday before cutoff
    assert remaining_weekdays(date(2026, 10, 19), now, UTC_ZONE, CUTOFF) == 2.0  # Fri + Mon


def test_remaining_weekdays_zero_when_target_has_passed() -> None:
    now = datetime(2026, 10, 16, 20, 0, tzinfo=UTC)  # Friday after cutoff
    assert remaining_weekdays(date(2026, 10, 16), now, UTC_ZONE, CUTOFF) == 0.0
    assert remaining_weekdays(None, now, UTC_ZONE, CUTOFF) == 0.0


def test_remaining_weekdays_follows_configured_timezone() -> None:
    now = datetime(2026, 10, 14, 13, 30, tzinfo=UTC)  # 13:30 UTC == 19:00 IST
    assert remaining_weekdays(date(2026, 10, 16), now, UTC_ZONE, CUTOFF) == 3.0
    assert remaining_weekdays(date(2026, 10, 16), now, KOLKATA, CUTOFF) == 2.0


def test_remaining_weekdays_negative_offset_timezone() -> None:
    now = datetime(2026, 10, 16, 20, 0, tzinfo=UTC)  # Friday 13:00 in L.A.
    assert remaining_weekdays(date(2026, 10, 16), now, UTC_ZONE, CUTOFF) == 0.0
    assert remaining_weekdays(date(2026, 10, 16), now, LOS_ANGELES, CUTOFF) == 1.0


def test_progress_fraction_is_zero_until_first_cutoff() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)
    now = datetime(2026, 10, 5, 11, 30, tzinfo=UTC)
    assert _progress_fraction(start, 10.0, now, UTC_ZONE, CUTOFF) == 0.0
    now = datetime(2026, 10, 5, 20, 0, tzinfo=UTC)
    assert _progress_fraction(start, 10.0, now, UTC_ZONE, CUTOFF) == 0.1


def test_weekdays_between_resolves_dates_in_timezone() -> None:
    # 2026-10-04 20:00 UTC is Monday 01:30 in IST; 2026-10-08 20:00 UTC is
    # Friday 01:30 in IST.
    start = datetime(2026, 10, 4, 20, 0, tzinfo=UTC)
    end = datetime(2026, 10, 8, 20, 0, tzinfo=UTC)
    assert weekdays_between(start, end, UTC_ZONE) == 3.0  # Mon, Tue, Wed
    assert weekdays_between(start, end, KOLKATA) == 4.0  # Mon, Tue, Wed, Thu


def _issue(estimate: float, completed_at: datetime | None) -> Issue:
    issue = Issue(
        linear_id=f"issue-{completed_at}-{estimate}",
        team_id=1,
        identifier="ENG-1",
        title="Test",
        estimate=estimate,
        state_type="completed" if completed_at else "started",
        completed_at=completed_at,
    )
    return issue


def test_velocity_trend_stops_at_last_elapsed_day() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)  # Monday
    ends_at = datetime(2026, 10, 16, 0, 0, tzinfo=UTC)
    issues = [
        _issue(2.0, datetime(2026, 10, 6, 12, 0, tzinfo=UTC)),  # Tue
        _issue(2.0, datetime(2026, 10, 7, 12, 0, tzinfo=UTC)),  # Wed
    ]

    before = datetime(2026, 10, 7, 11, 30, tzinfo=UTC)
    trend = _velocity_trend(issues, start, ends_at, 10.0, before, UTC_ZONE, CUTOFF)
    assert [point.date for point in trend] == ["2026-10-05", "2026-10-06"]
    assert trend[-1].progress == 0.2
    assert trend[-1].done_points == 2.0
    # The final point matches the headline progress for the same period.
    assert trend[-1].progress == _progress_fraction(start, 10.0, before, UTC_ZONE, CUTOFF)

    after = datetime(2026, 10, 7, 20, 0, tzinfo=UTC)
    trend = _velocity_trend(issues, start, ends_at, 10.0, after, UTC_ZONE, CUTOFF)
    assert [point.date for point in trend] == ["2026-10-05", "2026-10-06", "2026-10-07"]
    assert trend[-1].progress == 0.3
    assert trend[-1].done_points == 4.0


def test_cycle_calendar_dates_are_half_open_in_timezone() -> None:
    start = datetime(2026, 10, 4, 18, 30, tzinfo=UTC)  # Monday 00:00 IST
    end = datetime(2026, 10, 15, 18, 30, tzinfo=UTC)  # Thursday 00:00 IST
    assert cycle_calendar_dates(start, end, UTC_ZONE)[0] == "2026-10-04"
    assert cycle_calendar_dates(start, end, UTC_ZONE)[-1] == "2026-10-14"
    ist = cycle_calendar_dates(start, end, KOLKATA)
    assert ist[0] == "2026-10-05"
    assert ist[-1] == "2026-10-15"
    assert "2026-10-10" in ist  # weekend stays in the domain
    assert cycle_calendar_dates(None, end, UTC_ZONE) == []
    assert cycle_calendar_dates(start, None, KOLKATA) == ["2026-10-05"]


def test_adhoc_by_day_groups_points_and_skips_planned() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)
    planned = _issue(3.0, None)
    planned.assignee_linear_id = "u1"
    planned.assignee_name = "Ada"
    planned.added_to_cycle_at = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)

    ada_first = _issue(2.0, None)
    ada_first.assignee_linear_id = "u1"
    ada_first.assignee_name = "Ada"
    ada_first.added_to_cycle_at = datetime(2026, 10, 6, 9, 0, tzinfo=UTC)

    ada_second = _issue(1.0, None)
    ada_second.assignee_linear_id = "u1"
    ada_second.assignee_name = "Ada"
    ada_second.added_to_cycle_at = datetime(2026, 10, 6, 15, 0, tzinfo=UTC)

    grace = _issue(4.0, None)
    grace.assignee_linear_id = "u2"
    grace.assignee_name = "Grace"
    grace.added_to_cycle_at = datetime(2026, 10, 7, 10, 0, tzinfo=UTC)

    unestimated = _issue(2.0, None)
    unestimated.estimate = None
    unestimated.assignee_linear_id = "u2"
    unestimated.added_to_cycle_at = datetime(2026, 10, 7, 11, 0, tzinfo=UTC)

    unassigned = _issue(2.0, None)
    unassigned.assignee_linear_id = None
    unassigned.added_to_cycle_at = datetime(2026, 10, 8, 10, 0, tzinfo=UTC)

    points = _adhoc_by_day(
        [planned, ada_first, ada_second, grace, unestimated, unassigned],
        start,
        UTC_ZONE,
        {"u1": "ada.l", "u2": "grace.h"},
        {"u1": 1, "u2": 2},
    )
    assert [(row.date, row.assignee, row.points, row.group_id) for row in points] == [
        ("2026-10-06", "ada.l", 3.0, 1),
        ("2026-10-07", "grace.h", 4.0, 2),
        ("2026-10-08", "Unassigned", 2.0, None),
    ]


def test_is_adhoc_uses_configured_timezone() -> None:
    start = datetime(2026, 10, 5, 0, 0, tzinfo=UTC)  # Monday
    # 2026-10-05 20:00 UTC is still Monday in UTC but Tuesday 01:30 in IST.
    issue = _issue(2.0, None)
    issue.added_to_cycle_at = datetime(2026, 10, 5, 20, 0, tzinfo=UTC)
    assert _is_adhoc(issue, start, UTC_ZONE) is False
    assert _is_adhoc(issue, start, KOLKATA) is True


def test_compute_team_metrics_honours_app_settings(monkeypatch) -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()

        # Cycle starts Monday 2026-10-05 in IST (2026-10-04 18:30 UTC).
        start = datetime(2026, 10, 4, 18, 30, tzinfo=UTC)
        end = datetime(2026, 10, 16, 18, 30, tzinfo=UTC)
        cycle = Cycle(
            team_id=team.id,
            linear_id="c1",
            starts_at=start,
            ends_at=end,
            working_days=10,
        )
        db.add(cycle)
        db.flush()
        team.current_cycle_id = cycle.id
        db.add(AppSettings(id=1, timezone="Asia/Kolkata", day_cutoff_hour=19))
        # 2026-10-05 00:30 UTC is Monday 06:00 IST (the cycle's first local day,
        # so planned) but Sunday's UTC date is before the start, then Monday's
        # UTC date is after it (adhoc) when the timezone is UTC.
        db.add(
            Issue(
                linear_id="i1",
                team_id=team.id,
                identifier="ENG-1",
                title="Boundary work",
                estimate=2.0,
                state_type="started",
                cycle_id=cycle.id,
                added_to_cycle_at=datetime(2026, 10, 5, 0, 30, tzinfo=UTC),
            )
        )
        db.commit()

        # Wednesday 13:30 UTC == 19:00 IST: Mon/Tue/Wed count, so 3/10. The
        # issue is on the start day in IST, so it is planned rather than adhoc.
        monkeypatch.setattr(
            "app.metrics.utcnow", lambda: datetime(2026, 10, 7, 13, 30, tzinfo=UTC)
        )
        metrics = compute_team_metrics(db, team)
        assert metrics.progress == 0.3
        assert metrics.total_adhoc_points == 0.0

        # Switching to UTC: the same instant is only Tuesday (before the 19:00
        # cutoff) and the issue now falls after the UTC start date.
        ist_row = db.get(AppSettings, 1)
        assert ist_row is not None
        ist_row.timezone = "UTC"
        db.commit()
        metrics = compute_team_metrics(db, team)
        assert metrics.progress == 0.2
        assert metrics.total_adhoc_points == 2.0


def test_compute_team_metrics_only_counts_active_cycle() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        old = Cycle(team_id=team.id, linear_id="c1", working_days=10)
        current = Cycle(team_id=team.id, linear_id="c2", working_days=10)
        db.add_all([old, current])
        db.flush()
        team.current_cycle_id = current.id
        # A retained issue from a finalized cycle must not affect the metrics.
        db.add(
            Issue(
                linear_id="i-old",
                team_id=team.id,
                identifier="ENG-1",
                title="Old cycle",
                estimate=2.0,
                cycle_id=old.id,
            )
        )
        db.add(
            Issue(
                linear_id="i-new",
                team_id=team.id,
                identifier="ENG-2",
                title="Current cycle",
                estimate=3.0,
                cycle_id=current.id,
            )
        )
        db.commit()

        metrics = compute_team_metrics(db, team)
        assert metrics.total_taken_points == 3.0
        assert metrics.cycle_id == current.id
        assert metrics.cycle_linear_id == "c2"

        historical = compute_team_metrics(db, team, cycle=old)
        assert historical.total_taken_points == 2.0
        assert historical.cycle_id == old.id


def test_compute_team_metrics_adhoc_by_day(monkeypatch) -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        start = datetime(2026, 10, 4, 18, 30, tzinfo=UTC)
        end = datetime(2026, 10, 15, 18, 30, tzinfo=UTC)
        cycle = Cycle(
            team_id=team.id,
            linear_id="c1",
            starts_at=start,
            ends_at=end,
            working_days=10,
        )
        db.add(cycle)
        db.flush()
        team.current_cycle_id = cycle.id
        ada = TeamMember(
            team_id=team.id, linear_id="u1", name="Ada Lovelace", display_name="ada.l"
        )
        db.add(ada)
        db.flush()
        db.add(
            CycleMembership(
                team_id=team.id,
                cycle_id=cycle.id,
                member_id=ada.id,
                member_linear_id="u1",
            )
        )
        db.add(AppSettings(id=1, timezone="Asia/Kolkata", day_cutoff_hour=19))
        db.add(
            Issue(
                linear_id="planned",
                team_id=team.id,
                identifier="ENG-1",
                title="Planned",
                estimate=3.0,
                state_type="started",
                cycle_id=cycle.id,
                assignee_linear_id="u1",
                assignee_name="Ada",
                added_to_cycle_at=datetime(2026, 10, 5, 4, 0, tzinfo=UTC),
            )
        )
        db.add(
            Issue(
                linear_id="adhoc",
                team_id=team.id,
                identifier="ENG-2",
                title="Adhoc",
                estimate=2.0,
                state_type="started",
                cycle_id=cycle.id,
                assignee_linear_id="u1",
                assignee_name="Ada",
                added_to_cycle_at=datetime(2026, 10, 6, 4, 0, tzinfo=UTC),
            )
        )
        db.commit()

        monkeypatch.setattr(
            "app.metrics.utcnow", lambda: datetime(2026, 10, 7, 13, 30, tzinfo=UTC)
        )
        metrics = compute_team_metrics(db, team)
        assert metrics.adhoc_dates[0] == "2026-10-05"
        assert metrics.adhoc_dates[-1] == "2026-10-15"
        assert [
            (row.date, row.assignee, row.points) for row in metrics.adhoc_by_day
        ] == [("2026-10-06", "ada.l", 2.0)]


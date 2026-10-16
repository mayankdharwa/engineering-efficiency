"""Tests for Linear project activity due-date parsing."""

from __future__ import annotations

from datetime import UTC, datetime

from app.project_history import build_due_date_trajectory, target_date_changes


def _pairs(entries: object) -> list[tuple[str | None, str | None]]:
    return [(change.from_date, change.to_date) for change in target_date_changes(entries)]


def test_target_date_changes_accept_activity_shapes() -> None:
    assert _pairs(
        {
            "targetDate": {"from": "2026-03-01", "to": "2026-04-15"},
            "state": {"from": "a", "to": "b"},
        }
    ) == [("2026-03-01", "2026-04-15")]
    assert _pairs({"type": "targetDate", "from": "2026-04-15", "to": None}) == [
        ("2026-04-15", None)
    ]
    assert _pairs(
        [
            {"type": "name", "from": "Old", "to": "New"},
            {"property": "dueDate", "old": None, "new": "2026-08-01"},
        ]
    ) == [(None, "2026-08-01")]
    assert _pairs(
        {"updatedFrom": {"targetDate": "2026-01-01"}, "targetDate": "2026-02-01"}
    ) == [("2026-01-01", "2026-02-01")]
    assert _pairs({"entries": '{"target_date": ["2026-05-01", "2026-06-01"]}'}) == [
        ("2026-05-01", "2026-06-01")
    ]
    assert _pairs({"name": {"from": "A", "to": "B"}}) == []
    assert _pairs({"type": "targetDate", "from": "2026-01-01", "to": "2026-01-01"}) == []


def test_target_date_changes_keep_each_event_time() -> None:
    changes = target_date_changes(
        [
            {"at": 1790311726104, "to": "2026-10-09", "type": "targetDate"},
            {
                "at": 1790313282070,
                "to": "2026-10-13",
                "from": "2026-10-09",
                "type": "targetDate",
            },
            {"at": 1791787980199, "to": "2026-10-15", "from": "2026-10-13", "type": "targetDate"},
        ]
    )
    assert [(change.from_date, change.to_date) for change in changes] == [
        (None, "2026-10-09"),
        ("2026-10-09", "2026-10-13"),
        ("2026-10-13", "2026-10-15"),
    ]
    assert [change.changed_at for change in changes] == [
        datetime.fromtimestamp(1790311726104 / 1000, UTC),
        datetime.fromtimestamp(1790313282070 / 1000, UTC),
        datetime.fromtimestamp(1791787980199 / 1000, UTC),
    ]


def test_trajectory_appends_current_date_after_activity() -> None:
    points = build_due_date_trajectory(
        [(datetime(2026, 3, 1, tzinfo=UTC), "2026-04-01", "2026-05-01")],
        target_date="2026-06-01",
        initial_observed_at=datetime(2026, 1, 1, tzinfo=UTC),
        current_observed_at=datetime(2026, 5, 2, tzinfo=UTC),
    )
    assert [(point.to_date, point.from_activity) for point in points] == [
        ("2026-05-01", True),
        ("2026-06-01", False),
    ]


def test_trajectory_uses_one_point_when_activity_is_missing() -> None:
    observed = datetime(2026, 2, 1, tzinfo=UTC)
    points = build_due_date_trajectory(
        [],
        target_date="2026-07-01",
        initial_observed_at=observed,
        current_observed_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    assert len(points) == 1
    assert points[0].changed_at == observed
    assert points[0].from_date is None
    assert points[0].to_date == "2026-07-01"
    assert points[0].from_activity is False
    assert (
        build_due_date_trajectory(
            [],
            target_date=None,
            initial_observed_at=observed,
            current_observed_at=observed,
        )
        == []
    )

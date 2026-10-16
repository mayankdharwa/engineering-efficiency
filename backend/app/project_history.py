"""Parse Linear project-activity entries into due-date changes.

``ProjectHistory.entries`` is an opaque JSON object. Linear records a target-date
change in a few shapes, so the parser accepts the ones observed in the API and
ignores every other activity event.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .datetime_util import parse_iso_datetime

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_TARGET_KEYS = frozenset({"targetdate", "target_date", "duedate", "due_date"})
_CONTAINER_KEYS = frozenset(
    {"entries", "changes", "events", "updates", "items", "history"}
)
_FROM_KEYS = ("from", "fromDate", "fromString", "fromValue", "old", "previous", "previousValue")
_TO_KEYS = ("to", "toDate", "toString", "toValue", "new", "current", "next", "nextValue")

# A value that is present but is not a calendar date or an explicit clear.
_INVALID = object()


@dataclass(frozen=True)
class TargetDateChange:
    """One target-date change found in a Linear activity payload."""

    from_date: str | None
    to_date: str | None
    changed_at: datetime | None = None


@dataclass(frozen=True)
class DueDatePoint:
    changed_at: datetime
    from_date: str | None
    to_date: str | None
    from_activity: bool


def calendar_date(value: str | None) -> str | None:
    """Return the ``YYYY-MM-DD`` prefix of a Linear date, or ``None``."""
    parsed = _calendar_date(value)
    if parsed is _INVALID:
        return None
    return parsed


def target_date_changes(entries: Any) -> list[TargetDateChange]:
    """Return target-date changes found in one history payload.

    Linear stores each event's time on ``at`` (epoch milliseconds). That time is
    kept when it is present so several changes inside one history record stay
    in order.
    """
    found: list[TargetDateChange] = []
    _collect(_unwrap_json(entries), found, depth=0)
    return found


def build_due_date_trajectory(
    changes: list[tuple[datetime, str | None, str | None]],
    *,
    target_date: str | None,
    initial_observed_at: datetime | None,
    current_observed_at: datetime | None,
) -> list[DueDatePoint]:
    """Turn stored activity into the points drawn on the trajectory.

    Activity entries stay in chronological order. When Linear has not recorded
    a change but the project still has a due date, the current date is included
    as a single non-activity point. When the stored current date disagrees with
    the latest activity entry, that current date is appended as well.
    """
    ordered = sorted(changes, key=lambda change: change[0])
    points = [
        DueDatePoint(
            changed_at=changed_at,
            from_date=from_date,
            to_date=to_date,
            from_activity=True,
        )
        for changed_at, from_date, to_date in ordered
    ]
    current = calendar_date(target_date)
    if not points:
        if current is None or initial_observed_at is None:
            return []
        return [
            DueDatePoint(
                changed_at=initial_observed_at,
                from_date=None,
                to_date=current,
                from_activity=False,
            )
        ]

    last = points[-1]
    if current == last.to_date or current_observed_at is None:
        return points
    changed_at = current_observed_at
    if changed_at <= last.changed_at:
        return points
    return [
        *points,
        DueDatePoint(
            changed_at=changed_at,
            from_date=last.to_date,
            to_date=current,
            from_activity=False,
        ),
    ]


def _unwrap_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "[{":
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def _is_target(name: str) -> bool:
    normalized = name.strip().lower().replace("-", "_")
    compact = normalized.replace("_", "")
    return normalized in _TARGET_KEYS or compact in {"targetdate", "duedate"}


def _calendar_date(value: Any) -> str | None | object:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in {"null", "none"}:
            return None
        if _DATE_RE.match(text):
            return text[:10]
        return _INVALID
    if isinstance(value, dict):
        for key in ("date", "value", "targetDate", "target_date"):
            if key in value:
                return _calendar_date(value[key])
        return _INVALID
    return _INVALID


def _pair(value: Any) -> tuple[str | None, str | None] | None:
    if isinstance(value, dict):
        from_key = next((key for key in _FROM_KEYS if key in value), None)
        to_key = next((key for key in _TO_KEYS if key in value), None)
        if from_key is None and to_key is None:
            return None
        from_date = _calendar_date(value.get(from_key)) if from_key else None
        to_date = _calendar_date(value.get(to_key)) if to_key else None
        if from_date is _INVALID or to_date is _INVALID:
            return None
        if from_date == to_date:
            return None
        return from_date, to_date
    if isinstance(value, list) and len(value) == 2:
        from_date = _calendar_date(value[0])
        to_date = _calendar_date(value[1])
        if from_date is _INVALID or to_date is _INVALID or from_date == to_date:
            return None
        return from_date, to_date
    return None


def _event_time(value: dict[str, Any]) -> datetime | None:
    """Read the time Linear stamps on an individual activity event."""
    for key in ("at", "updatedAt", "createdAt"):
        if key not in value:
            continue
        parsed = _timestamp(value.get(key))
        if parsed is not None:
            return parsed
    return None


def _timestamp(value: Any) -> datetime | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        seconds = float(value)
        if seconds > 10_000_000_000:
            seconds /= 1000
        if seconds <= 0:
            return None
        try:
            return datetime.fromtimestamp(seconds, UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = parse_iso_datetime(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def _collect(value: Any, found: list[TargetDateChange], *, depth: int) -> None:
    if depth > 8 or value is None:
        return
    if isinstance(value, str):
        unwrapped = _unwrap_json(value)
        if unwrapped is not value:
            _collect(unwrapped, found, depth=depth + 1)
        return
    if isinstance(value, list):
        for item in value:
            _collect(item, found, depth=depth + 1)
        return
    if not isinstance(value, dict):
        return

    event_type = value.get("type") or value.get("property") or value.get("field")
    if isinstance(event_type, str) and _is_target(event_type):
        change = _pair(value)
        if change is not None:
            found.append(TargetDateChange(*change, _event_time(value)))
        return

    consumed: set[str] = set()
    updated_from = value.get("updatedFrom")
    if isinstance(updated_from, dict):
        for key, old in updated_from.items():
            if not isinstance(key, str) or not _is_target(key) or key not in value:
                continue
            from_date = _calendar_date(old)
            to_date = _calendar_date(value.get(key))
            if from_date is _INVALID or to_date is _INVALID or from_date == to_date:
                continue
            found.append(TargetDateChange(from_date, to_date, _event_time(value)))
            consumed.add(key)

    for key, item in value.items():
        if not isinstance(key, str) or key in consumed or key == "updatedFrom":
            continue
        if _is_target(key):
            change = _pair(item)
            if change is not None:
                found.append(TargetDateChange(*change, _event_time(value)))
            continue
        if key in _CONTAINER_KEYS:
            _collect(item, found, depth=depth + 1)

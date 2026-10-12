"""ISO-8601 datetime parsing shared by Linear sync and snapshot import."""

from __future__ import annotations

from datetime import datetime


def parse_iso_datetime(value: str) -> datetime:
    """Parse an ISO-8601 timestamp, treating a trailing ``Z`` as UTC."""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

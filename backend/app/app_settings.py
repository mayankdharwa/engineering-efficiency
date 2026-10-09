"""App-wide metric preferences: working timezone and end-of-day cutoff.

Both values are stored in a singleton :class:`~app.models.AppSettings` row so
they can be edited from the Configuration page. When no row exists yet the
defaults below are used, which matches the previous UTC-date behaviour apart
from the end-of-day cutoff.
"""

from __future__ import annotations

from dataclasses import dataclass
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from .models import AppSettings

DEFAULT_TIMEZONE = "UTC"
DEFAULT_DAY_CUTOFF_HOUR = 19


@dataclass(frozen=True)
class AppSettingsView:
    """Resolved preferences, independent of whether a DB row exists."""

    timezone: str = DEFAULT_TIMEZONE
    day_cutoff_hour: int = DEFAULT_DAY_CUTOFF_HOUR

    @property
    def zone(self) -> ZoneInfo:
        """The timezone as a :class:`~zoneinfo.ZoneInfo`."""
        return ZoneInfo(self.timezone)


def get_app_settings(db: Session) -> AppSettingsView:
    """Read the singleton settings row, falling back to the defaults."""
    row = db.get(AppSettings, 1)
    if row is None:
        return AppSettingsView()
    return AppSettingsView(
        timezone=row.timezone or DEFAULT_TIMEZONE,
        day_cutoff_hour=(
            row.day_cutoff_hour
            if row.day_cutoff_hour is not None
            else DEFAULT_DAY_CUTOFF_HOUR
        ),
    )

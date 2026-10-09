"""App-wide metric settings: working timezone and end-of-day cutoff."""

from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..app_settings import (
    DEFAULT_DAY_CUTOFF_HOUR,
    DEFAULT_TIMEZONE,
    get_app_settings,
)
from ..database import get_db
from ..models import AppSettings
from ..schemas import AppSettingsIn, AppSettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettingsOut)
def read_settings(db: Session = Depends(get_db)) -> AppSettingsOut:
    preferences = get_app_settings(db)
    return AppSettingsOut(
        timezone=preferences.timezone,
        day_cutoff_hour=preferences.day_cutoff_hour,
    )


@router.put("", response_model=AppSettingsOut)
def update_settings(
    payload: AppSettingsIn, db: Session = Depends(get_db)
) -> AppSettingsOut:
    """Validate and persist the working timezone and end-of-day cutoff."""
    try:
        ZoneInfo(payload.timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail=f"Unknown timezone: {payload.timezone}"
        ) from exc

    row = db.get(AppSettings, 1)
    if row is None:
        row = AppSettings(
            id=1, timezone=DEFAULT_TIMEZONE, day_cutoff_hour=DEFAULT_DAY_CUTOFF_HOUR
        )
        db.add(row)

    row.timezone = payload.timezone
    row.day_cutoff_hour = payload.day_cutoff_hour
    db.commit()
    db.refresh(row)

    return AppSettingsOut(timezone=row.timezone, day_cutoff_hour=row.day_cutoff_hour)

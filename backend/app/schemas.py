"""Pydantic request/response schemas for the public API."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LinearConfigIn(BaseModel):
    api_key: str = Field(min_length=1)


class LinearConfigOut(BaseModel):
    configured: bool
    viewer_name: str | None = None
    viewer_email: str | None = None
    organization_name: str | None = None
    updated_at: datetime | None = None


class ConnectionTestOut(BaseModel):
    ok: bool
    message: str
    viewer_name: str | None = None
    organization_name: str | None = None


class AppSettingsOut(BaseModel):
    timezone: str
    day_cutoff_hour: int


class AppSettingsIn(BaseModel):
    timezone: str = Field(min_length=1, max_length=64)
    day_cutoff_hour: int = Field(ge=0, le=23)


class TeamOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    linear_id: str
    key: str
    name: str
    description: str | None = None
    color: str | None = None
    issue_count: int
    last_synced_at: datetime | None = None


class IssueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    identifier: str
    title: str
    state_name: str | None = None
    state_type: str | None = None
    estimate: float | None = None
    assignee_name: str | None = None
    project_name: str | None = None
    cycle_id: str | None = None
    cycle_name: str | None = None
    cycle_number: float | None = None
    labels: list[str] = []
    created_at: datetime | None = None
    completed_at: datetime | None = None


class SyncRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    status: str
    message: str | None = None
    issues_synced: int
    started_at: datetime
    finished_at: datetime | None = None


class RefreshResult(BaseModel):
    team_id: int
    status: str
    issues_synced: int
    members_synced: int = 0
    cycle_name: str | None = None
    message: str | None = None


class MemberMetricsOut(BaseModel):
    linear_id: str | None = None
    name: str
    email: str | None = None
    role: str | None = None
    counts_toward_capacity: bool = True
    unavailable_days: float
    capacity_points: float
    taken_points: float
    done_points: float
    adhoc_points: float
    planned_points: float
    unestimated_count: int
    planning_efficiency: float | None = None
    velocity: float | None = None
    bandwidth_efficiency: float | None = None


class VelocityTrendPointOut(BaseModel):
    date: str
    progress: float
    done_points: float
    expected_points: float
    velocity: float | None = None


class RoleMetricsOut(BaseModel):
    role: str | None = None
    label: str
    members: int
    capacity_points: float
    taken_points: float
    done_points: float
    adhoc_points: float
    planned_points: float
    unestimated_count: int
    planning_efficiency: float | None = None
    velocity: float | None = None
    bandwidth_efficiency: float | None = None
    velocity_trend: list[VelocityTrendPointOut] = []


class TeamStatsOut(BaseModel):
    team_id: int
    ready: bool
    message: str | None = None
    cycle_id: str | None = None
    cycle_name: str | None = None
    cycle_number: float | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    working_days: float
    default_working_days: float
    working_days_overridden: bool
    points_per_day: float
    progress: float = 0.0
    total_taken_points: float
    total_done_points: float
    total_adhoc_points: float
    total_planned_points: float
    total_capacity_points: float
    unestimated_issues: int
    planning_efficiency: float | None = None
    velocity: float | None = None
    bandwidth_efficiency: float | None = None
    members: list[MemberMetricsOut] = []
    roles: list[RoleMetricsOut] = []
    velocity_trend: list[VelocityTrendPointOut] = []


class CycleMemberOut(BaseModel):
    linear_id: str
    name: str
    email: str | None = None
    role: str | None = None
    unavailable_days: float
    counts_toward_capacity: bool = True


class CycleSettingsOut(BaseModel):
    team_id: int
    ready: bool
    message: str | None = None
    cycle_id: str | None = None
    cycle_name: str | None = None
    cycle_number: float | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    working_days: float
    default_working_days: float
    working_days_overridden: bool
    points_per_day: float
    members: list[CycleMemberOut] = []


class CycleMemberAvailabilityIn(BaseModel):
    linear_id: str
    unavailable_days: float = Field(default=0, ge=0, le=60)
    counts_toward_capacity: bool | None = None
    role: Literal["DEV", "QA"] | None = None


class CycleSettingsIn(BaseModel):
    working_days: float | None = Field(default=None, ge=0, le=60)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    members: list[CycleMemberAvailabilityIn] = []

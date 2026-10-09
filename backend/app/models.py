"""ORM models.

The schema is intentionally lean but captures everything we expect to need for
efficiency metrics later (throughput, cycle time, WIP, estimation accuracy...).
Raw Linear payloads are also stored so nothing is lost.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base, UTCDateTime


def utcnow() -> datetime:
    return datetime.now(UTC)


class LinearConfig(Base):
    """Singleton row (id == 1) holding the Linear connection settings."""

    __tablename__ = "linear_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    api_key: Mapped[str] = mapped_column(Text)
    viewer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    viewer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organization_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )


class AppSettings(Base):
    """Singleton row (id == 1) holding app-wide metric preferences.

    ``timezone`` is an IANA name (e.g. ``Asia/Kolkata``) that defines the
    working calendar used to decide which day "now" falls on. ``day_cutoff_hour``
    is the local hour (0-23) after which the current day counts as elapsed.
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    day_cutoff_hour: Mapped[int] = mapped_column(Integer, default=19)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    linear_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    key: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    # Linear id of the cycle currently stored for this team (set on refresh).
    current_cycle_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

    issues: Mapped[list[Issue]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )


class Issue(Base):
    __tablename__ = "issues"
    __table_args__ = (UniqueConstraint("linear_id", name="uq_issues_linear_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    linear_id: Mapped[str] = mapped_column(String(64), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)

    identifier: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    state_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    state_type: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    priority: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimate: Mapped[float | None] = mapped_column(Float, nullable=True)

    assignee_linear_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    assignee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    creator_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    project_name: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    cycle_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    cycle_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cycle_number: Mapped[float | None] = mapped_column(Float, nullable=True)

    labels: Mapped[list[str]] = mapped_column(JSON, default=list)

    # When Linear recorded the issue as being attached to its cycle. Used to
    # classify "adhoc" work (added after the cycle started).
    added_to_cycle_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    # Linear timestamps
    created_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    raw: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    team: Mapped[Team] = relationship(back_populates="issues")


class SyncRun(Base):
    """Audit trail of every download/refresh, surfaced in the UI."""

    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32))  # "teams" | "issues"
    status: Mapped[str] = mapped_column(String(32))  # "running" | "success" | "error"
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    issues_synced: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class CycleSettings(Base):
    """Per-team, per-cycle configuration used by the efficiency metrics.

    Values are seeded from Linear on refresh (cycle name/number and start/end
    dates). ``working_days`` is a manual override for holidays; when null the
    metrics fall back to the number of weekdays between the cycle dates.
    """

    __tablename__ = "cycle_settings"
    __table_args__ = (
        UniqueConstraint("team_id", "cycle_id", name="uq_cycle_settings_team_cycle"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    cycle_id: Mapped[str] = mapped_column(String(64), index=True)
    cycle_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cycle_number: Mapped[float | None] = mapped_column(Float, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Manual override for the number of working days (e.g. holidays). Null means
    # "derive from the cycle dates".
    working_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    # True once a user edits the dates, so refreshes stop overwriting them.
    dates_overridden: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )


class MemberGroup(Base):
    """A per-team grouping used to aggregate member metrics.

    Groups are fluid: a team can add any number of them, rename them and remove
    them. A member belongs to at most one group; unassigned members roll up
    under an "Unassigned" bucket in the UI.
    """

    __tablename__ = "member_groups"
    __table_args__ = (
        UniqueConstraint("team_id", "name", name="uq_member_groups_team_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )


class TeamMember(Base):
    """A member imported from the team's Linear membership."""

    __tablename__ = "team_members"
    __table_args__ = (
        UniqueConstraint("team_id", "linear_id", name="uq_team_members_team_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    linear_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_assignable: Mapped[bool] = mapped_column(Boolean, default=True)
    # Whether this member contributes capacity to the team's metrics. Defaults
    # to True for assignable, active members but can be toggled per member.
    counts_toward_capacity: Mapped[bool] = mapped_column(Boolean, default=True)
    # Optional group assignment used to aggregate metrics. Null = unassigned.
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    group: Mapped[MemberGroup | None] = relationship()


class MemberUnavailability(Base):
    """Planned leave, in days, for a member within a specific cycle."""

    __tablename__ = "member_unavailability"
    __table_args__ = (
        UniqueConstraint(
            "team_id",
            "cycle_id",
            "member_linear_id",
            name="uq_member_unavailability_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    cycle_id: Mapped[str] = mapped_column(String(64), index=True)
    member_linear_id: Mapped[str] = mapped_column(String(64), index=True)
    unavailable_days: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

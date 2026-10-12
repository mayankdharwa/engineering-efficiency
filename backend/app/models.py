"""ORM models.

Cycles are first-class: each team can retain many of them, and issues / leave
point at a cycle row rather than a bare Linear id. Raw Linear payloads are
also stored so nothing is lost.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base, IntegerPK, UTCDateTime

# Incremented when a one-shot data migration is required. See ``init_db``.
CURRENT_SCHEMA_VERSION = 3


def utcnow() -> datetime:
    return datetime.now(UTC)


class SyncKind(StrEnum):
    TEAMS = "teams"
    ISSUES = "issues"


class SyncStatus(StrEnum):
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"


class SchemaVersion(Base):
    """Singleton row (id == 1) recording the applied schema version."""

    __tablename__ = "schema_version"

    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer)


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
    # Issue count from the last refresh of the team's *current* cycle — not a
    # live COUNT of every historical issue stored for the team.
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    # Integer PK of the cycle currently pointed at by this team (set on refresh).
    # Stored as a plain integer to avoid a circular FK with ``cycles.team_id``.
    current_cycle_id: Mapped[int | None] = mapped_column(
        IntegerPK, nullable=True, index=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

    issues: Mapped[list[Issue]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    cycles: Mapped[list[Cycle]] = relationship(
        back_populates="team",
        foreign_keys="Cycle.team_id",
        cascade="all, delete-orphan",
    )


class Issue(Base):
    __tablename__ = "issues"
    __table_args__ = (
        UniqueConstraint("cycle_id", "linear_id", name="uq_issues_cycle_linear"),
        Index("ix_issues_team_id_cycle_id", "team_id", "cycle_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    linear_id: Mapped[str] = mapped_column(String(64), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    cycle_id: Mapped[int | None] = mapped_column(
        ForeignKey("cycles.id", ondelete="CASCADE"), nullable=True, index=True
    )

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
    cycle: Mapped[Cycle | None] = relationship(back_populates="issues")

    @property
    def is_completed(self) -> bool:
        return self.state_type == "completed"


class SyncRun(Base):
    """Audit trail of every download/refresh, surfaced in the UI."""

    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    issues_synced: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Cycle(Base):
    """A Linear cycle stored for a team, plus local overrides.

    Seeded from Linear on refresh (name/number and start/end dates).
    ``working_days`` is a manual override for holidays; when null the metrics
    fall back to the number of weekdays between the cycle dates. Finalized
    cycles keep their issues and leave so history can be browsed.
    """

    __tablename__ = "cycles"
    __table_args__ = (
        UniqueConstraint("team_id", "linear_id", name="uq_cycles_team_linear"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    linear_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    starts_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Manual override for the number of working days (e.g. holidays). Null means
    # "derive from the cycle dates".
    working_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    # True once a user edits the dates, so refreshes stop overwriting them.
    dates_overridden: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when the cycle is finalized (frozen). Archived cycles are preserved for
    # history and no longer the team's active cycle once a newer one is refreshed.
    archived_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

    team: Mapped[Team] = relationship(back_populates="cycles", foreign_keys=[team_id])
    issues: Mapped[list[Issue]] = relationship(back_populates="cycle")

    @hybrid_property
    def is_finalized(self) -> bool:
        return self.archived_at is not None

    @is_finalized.inplace.expression
    @classmethod
    def _is_finalized_expression(cls):
        return cls.archived_at.is_not(None)


class TeamCost(Base):
    """Per-team cost configuration used to value man-days.

    A team has at most one row (enforced by the unique ``team_id``). ``currency``
    is a display symbol (€, $ or ₹) and ``man_day_cost`` is the cost of a single
    working day for the team, stored as a whole number in that currency.
    """

    __tablename__ = "team_costs"
    __table_args__ = (UniqueConstraint("team_id", name="uq_team_costs_team"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    currency: Mapped[str] = mapped_column(String(8), default="$")
    man_day_cost: Mapped[int] = mapped_column(Integer, default=0)
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
    color: Mapped[str] = mapped_column(String(7), default="#d97706", server_default="#d97706")
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
    last_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class CycleMembership(Base):
    """Per-cycle snapshot of a member's group, capacity flag and leave.

    Group and capacity are copied forward when a new cycle is created; leave
    starts at zero. Finalized cycles keep their snapshot so history stays
    accurate even if the live roster later changes.
    """

    __tablename__ = "cycle_memberships"
    __table_args__ = (
        UniqueConstraint(
            "cycle_id",
            "member_linear_id",
            name="uq_cycle_memberships_scope",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    cycle_id: Mapped[int] = mapped_column(
        ForeignKey("cycles.id", ondelete="CASCADE"), index=True
    )
    # Optional FK so the snapshot survives a later member deletion (SET NULL)
    # while ``member_linear_id`` still attributes the row.
    member_id: Mapped[int | None] = mapped_column(
        ForeignKey("team_members.id", ondelete="SET NULL"), nullable=True, index=True
    )
    member_linear_id: Mapped[str] = mapped_column(String(64), index=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("member_groups.id", ondelete="SET NULL"), nullable=True, index=True
    )
    counts_toward_capacity: Mapped[bool] = mapped_column(Boolean, default=True)
    unavailable_days: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow
    )

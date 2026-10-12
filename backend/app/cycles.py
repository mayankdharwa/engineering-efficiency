"""Cycle snapshots: loading, labelling, and membership updates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Cycle, CycleMembership, Issue, MemberGroup, Team, TeamMember
from .schemas import (
    CycleMemberAvailabilityIn,
    CycleMemberOut,
    CycleSettingsOut,
    GroupOut,
)


@dataclass(frozen=True)
class CycleMemberKey:
    """Identity of one member's snapshot row on a cycle."""

    team_id: int
    cycle_id: int
    member_linear_id: str

    def new_membership(self, **kwargs: Any) -> CycleMembership:
        return CycleMembership(
            team_id=self.team_id,
            cycle_id=self.cycle_id,
            member_linear_id=self.member_linear_id,
            **kwargs,
        )


@dataclass
class CycleContext:
    team: Team
    cycle: Cycle
    issues: list[Issue]
    members: list[TeamMember]
    groups: list[MemberGroup]
    memberships: dict[str, CycleMembership]


def format_cycle_label(
    name: str | None = None,
    number: int | float | None = None,
    cycle_id: str | None = None,
    *,
    missing: str = "no cycle",
) -> str:
    """Human label: name, then number, then id."""
    if name:
        return f"cycle '{name}'"
    if number is not None:
        return f"cycle {number:g}"
    if cycle_id:
        return f"cycle '{cycle_id}'"
    return missing


def load_team_cycle_data(db: Session, team: Team, cycle: Cycle) -> CycleContext:
    """Issues, roster, groups and memberships for one team cycle."""
    issues = list(
        db.scalars(
            select(Issue).where(
                Issue.team_id == team.id,
                Issue.cycle_id == cycle.id,
            )
        ).all()
    )
    members = list(
        db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all()
    )
    groups = list(
        db.scalars(
            select(MemberGroup)
            .where(MemberGroup.team_id == team.id)
            .order_by(MemberGroup.id)
        ).all()
    )
    memberships = {
        row.member_linear_id: row
        for row in db.scalars(
            select(CycleMembership).where(
                CycleMembership.team_id == team.id,
                CycleMembership.cycle_id == cycle.id,
            )
        ).all()
    }
    return CycleContext(
        team=team,
        cycle=cycle,
        issues=issues,
        members=members,
        groups=groups,
        memberships=memberships,
    )


def get_cycle_membership(db: Session, key: CycleMemberKey) -> CycleMembership | None:
    return db.scalar(
        select(CycleMembership).where(
            CycleMembership.team_id == key.team_id,
            CycleMembership.cycle_id == key.cycle_id,
            CycleMembership.member_linear_id == key.member_linear_id,
        )
    )


def build_cycle_settings_out(
    db: Session, team: Team, cycle: Cycle | None = None
) -> CycleSettingsOut:
    """Build the cycle-settings view from the stored cycle + membership."""
    from .metrics import compute_team_metrics, get_cycle

    if cycle is None:
        cycle = get_cycle(db, team)
    metrics = compute_team_metrics(db, team, cycle=cycle)

    if cycle is None:
        members = list(
            db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all()
        )
        groups = list(
            db.scalars(
                select(MemberGroup)
                .where(MemberGroup.team_id == team.id)
                .order_by(MemberGroup.id)
            ).all()
        )
        snapshots: dict[str, CycleMembership] = {}
    else:
        ctx = load_team_cycle_data(db, team, cycle)
        members = ctx.members
        groups = ctx.groups
        snapshots = ctx.memberships

    member_by_id = {member.linear_id: member for member in members}

    # Current cycle: live roster. Historical cycle: whoever was snapshotted.
    if cycle is not None and cycle.id != team.current_cycle_id:
        linear_ids = list(snapshots)
    else:
        linear_ids = [member.linear_id for member in members]
        for linear_id in snapshots:
            if linear_id not in member_by_id:
                linear_ids.append(linear_id)

    def _sort_key(linear_id: str) -> str:
        member = member_by_id.get(linear_id)
        if member is not None:
            return (member.display_name or member.name or linear_id).lower()
        return linear_id.lower()

    linear_ids.sort(key=_sort_key)
    group_name_by_id = {group.id: group.name for group in groups}

    return CycleSettingsOut(
        team_id=team.id,
        ready=metrics.ready,
        message=metrics.message,
        cycle_id=metrics.cycle_id,
        cycle_linear_id=metrics.cycle_linear_id,
        cycle_name=metrics.cycle_name,
        cycle_number=metrics.cycle_number,
        starts_at=metrics.starts_at,
        ends_at=metrics.ends_at,
        working_days=metrics.working_days,
        default_working_days=metrics.default_working_days,
        working_days_overridden=metrics.working_days_overridden,
        archived_at=cycle.archived_at if cycle is not None else None,
        is_current=(cycle is not None and cycle.id == team.current_cycle_id),
        points_per_day=metrics.points_per_day,
        groups=[GroupOut.model_validate(group) for group in groups],
        members=[
            CycleMemberOut(
                linear_id=linear_id,
                name=(
                    (member_by_id[linear_id].display_name or member_by_id[linear_id].name)
                    if linear_id in member_by_id
                    else None
                )
                or linear_id,
                email=member_by_id[linear_id].email if linear_id in member_by_id else None,
                group_id=snapshots[linear_id].group_id if linear_id in snapshots else None,
                group_name=(
                    group_name_by_id.get(snapshots[linear_id].group_id)
                    if linear_id in snapshots and snapshots[linear_id].group_id is not None
                    else None
                ),
                unavailable_days=(
                    snapshots[linear_id].unavailable_days if linear_id in snapshots else 0.0
                ),
                counts_toward_capacity=(
                    bool(snapshots[linear_id].counts_toward_capacity)
                    if linear_id in snapshots
                    else True
                ),
            )
            for linear_id in linear_ids
        ],
    )


def apply_cycle_member_updates(
    db: Session,
    cycle: Cycle,
    team: Team,
    entries: list[CycleMemberAvailabilityIn],
    *,
    finalized: bool,
) -> None:
    """Apply per-member snapshot edits; raise HTTPException on lock/validation errors."""
    valid_group_ids = set(
        db.scalars(select(MemberGroup.id).where(MemberGroup.team_id == team.id)).all()
    )

    for entry in entries:
        member = db.scalar(
            select(TeamMember).where(
                TeamMember.team_id == team.id,
                TeamMember.linear_id == entry.linear_id,
            )
        )
        key = CycleMemberKey(team.id, cycle.id, entry.linear_id)
        row = get_cycle_membership(db, key)
        stored_leave = row.unavailable_days if row is not None else 0.0
        stored_counts = row.counts_toward_capacity if row is not None else True
        stored_group = row.group_id if row is not None else None
        next_counts = (
            entry.counts_toward_capacity
            if entry.counts_toward_capacity is not None
            else stored_counts
        )
        next_group = entry.group_id if "group_id" in entry.model_fields_set else stored_group
        if next_group is not None and next_group not in valid_group_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Group {entry.group_id} does not belong to this team.",
            )

        if finalized:
            if (
                abs(entry.unavailable_days - stored_leave) > 1e-9
                or next_counts != stored_counts
                or next_group != stored_group
            ):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This cycle is finalized and its member snapshot "
                        "(group, capacity, leave) cannot be edited."
                    ),
                )
            continue

        if member is None and row is None:
            continue
        if row is None:
            row = key.new_membership(
                member_id=member.id if member is not None else None,
            )
            db.add(row)
        if member is not None:
            row.member_id = member.id
        row.unavailable_days = entry.unavailable_days
        row.counts_toward_capacity = next_counts
        if "group_id" in entry.model_fields_set:
            row.group_id = entry.group_id

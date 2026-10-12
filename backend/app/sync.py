"""Sync logic: download from Linear and persist into SQLite."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .linear_client import LinearClient
from .models import (
    Cycle,
    CycleMembership,
    Issue,
    LinearConfig,
    SyncRun,
    Team,
    TeamMember,
    utcnow,
)


@dataclass
class SyncSummary:
    """Outcome of a single team refresh."""

    issues_synced: int
    has_active_cycle: bool
    members_synced: int = 0
    cycle_id: str | None = None
    cycle_name: str | None = None
    cycle_number: int | None = None
    cycle_starts_at: datetime | None = None
    cycle_ends_at: datetime | None = None


class CycleMismatchError(RuntimeError):
    """Raised when Linear's active cycle differs from the locally stored one.

    Refreshing would replace the stored cycle's issues, so the current cycle
    must be finalized first (see the finalize endpoint) to avoid discarding
    unarchived data.
    """


def parse_dt(value: str | None) -> datetime | None:
    """Parse a Linear ISO-8601 timestamp into an aware datetime."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def get_config(db: Session) -> LinearConfig | None:
    return db.get(LinearConfig, 1)


def client_from_config(db: Session) -> LinearClient:
    config = get_config(db)
    if config is None or not config.api_key:
        raise RuntimeError("Linear is not configured yet. Add an API key on the config page.")
    return LinearClient(config.api_key)


def _should_skip_team(remote: dict[str, Any]) -> bool:
    """Whether a Linear team should be left out of the local import.

    Archived (soft-deleted) teams are skipped, as are teams where cycles are
    explicitly disabled. ``cyclesEnabled`` is only treated as a skip when Linear
    reports it as ``False`` so teams from responses that omit the field still
    import.
    """
    if remote.get("archivedAt"):
        return True
    return remote.get("cyclesEnabled") is False


def upsert_teams(db: Session, client: LinearClient) -> list[Team]:
    """Fetch every team from Linear and upsert it locally.

    Archived teams and teams that don't use cycles are skipped. Teams are never
    removed here: a previously imported team that later becomes archived keeps
    its local row until the user deletes it.
    """
    remote_teams = client.teams()
    by_linear_id = {
        team.linear_id: team
        for team in db.scalars(select(Team)).all()
    }

    result: list[Team] = []
    for remote in remote_teams:
        if _should_skip_team(remote):
            continue
        team = by_linear_id.get(remote["id"])
        if team is None:
            team = Team(linear_id=remote["id"])
            db.add(team)
        team.key = remote.get("key") or ""
        team.name = remote.get("name") or remote.get("key") or "Unnamed team"
        team.description = remote.get("description")
        team.color = remote.get("color")
        team.issue_count = remote.get("issueCount") or 0
        result.append(team)

    db.commit()
    for team in result:
        db.refresh(team)
    return result


def _build_issue(team: Team, remote: dict[str, Any], cycle: Cycle) -> Issue:
    issue = Issue(linear_id=remote["id"])

    state = remote.get("state") or {}
    assignee = remote.get("assignee") or {}
    creator = remote.get("creator") or {}
    project = remote.get("project") or {}
    labels = (remote.get("labels") or {}).get("nodes") or []

    issue.team_id = team.id
    issue.cycle_id = cycle.id
    issue.identifier = remote.get("identifier") or ""
    issue.title = remote.get("title") or ""
    issue.description = remote.get("description")
    issue.state_name = state.get("name")
    issue.state_type = state.get("type")
    issue.priority = remote.get("priority")
    issue.estimate = remote.get("estimate")
    issue.assignee_linear_id = assignee.get("id")
    issue.assignee_name = assignee.get("displayName") or assignee.get("name")
    issue.creator_name = creator.get("displayName") or creator.get("name")
    issue.project_name = project.get("name")
    issue.labels = [node.get("name") for node in labels if node.get("name")]
    issue.added_to_cycle_at = parse_dt(remote.get("addedToCycleAt"))
    issue.created_at = parse_dt(remote.get("createdAt"))
    issue.updated_at = parse_dt(remote.get("updatedAt"))
    issue.started_at = parse_dt(remote.get("startedAt"))
    issue.completed_at = parse_dt(remote.get("completedAt"))
    issue.canceled_at = parse_dt(remote.get("canceledAt"))
    issue.archived_at = parse_dt(remote.get("archivedAt"))
    issue.raw = remote
    return issue


def upsert_cycle(db: Session, team: Team, cycle: dict[str, Any]) -> Cycle:
    """Seed/refresh the cycle row, preserving user overrides."""
    linear_id = cycle["id"]
    row = db.scalar(
        select(Cycle).where(Cycle.team_id == team.id, Cycle.linear_id == linear_id)
    )
    if row is None:
        row = Cycle(team_id=team.id, linear_id=linear_id)
        db.add(row)

    row.name = cycle.get("name")
    row.number = _as_int(cycle.get("number"))
    # Only overwrite dates from Linear while the user has not edited them.
    if not row.dates_overridden:
        row.starts_at = parse_dt(cycle.get("startsAt"))
        row.ends_at = parse_dt(cycle.get("endsAt"))
    db.flush()
    return row


def upsert_team_members(
    db: Session, team: Team, remote_members: list[dict[str, Any]]
) -> list[TeamMember]:
    """Upsert the team's Linear membership, keyed by Linear user id.

    Members no longer returned by Linear are removed from the team. Group,
    capacity and leave live on the cycle snapshot, not on this roster row.
    """
    existing = {
        member.linear_id: member
        for member in db.scalars(
            select(TeamMember).where(TeamMember.team_id == team.id)
        ).all()
    }
    now = utcnow()
    result: list[TeamMember] = []
    remote_ids: set[str] = set()
    for remote in remote_members:
        remote_ids.add(remote["id"])
        member = existing.get(remote["id"])
        if member is None:
            member = TeamMember(team_id=team.id, linear_id=remote["id"])
            db.add(member)
        member.name = remote.get("name")
        member.display_name = remote.get("displayName") or remote.get("name")
        member.email = remote.get("email")
        member.avatar_url = remote.get("avatarUrl")
        member.active = bool(remote.get("active", True))
        member.is_assignable = bool(remote.get("isAssignable", True))
        member.last_synced_at = now
        result.append(member)

    # Drop members who are no longer on the team. Guard against an empty
    # response (a transient API issue) wiping the whole roster.
    if remote_members:
        for member in existing.values():
            if member.linear_id not in remote_ids:
                db.delete(member)

    return result


def ensure_cycle_memberships(
    db: Session,
    team: Team,
    cycle: Cycle,
    *,
    source_cycle_id: int | None = None,
    members: list[TeamMember] | None = None,
) -> list[CycleMembership]:
    """Make sure every current team member has a snapshot row for ``cycle``.

    Existing rows are left alone. Missing rows copy group and capacity from
    ``source_cycle_id`` when present (a previous cycle); leave always starts at
    zero. New members with no source default to counting toward capacity when
    they are active and assignable.
    """
    roster = members
    if roster is None:
        roster = list(
            db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all()
        )
    existing = {
        row.member_linear_id: row
        for row in db.scalars(
            select(CycleMembership).where(
                CycleMembership.team_id == team.id,
                CycleMembership.cycle_id == cycle.id,
            )
        ).all()
    }
    source: dict[str, CycleMembership] = {}
    if source_cycle_id is not None and source_cycle_id != cycle.id:
        source = {
            row.member_linear_id: row
            for row in db.scalars(
                select(CycleMembership).where(
                    CycleMembership.team_id == team.id,
                    CycleMembership.cycle_id == source_cycle_id,
                )
            ).all()
        }

    result: list[CycleMembership] = list(existing.values())
    for member in roster:
        row = existing.get(member.linear_id)
        if row is not None:
            if row.member_id is None:
                row.member_id = member.id
            continue
        previous = source.get(member.linear_id)
        counts = (
            previous.counts_toward_capacity
            if previous is not None
            else bool(member.active and member.is_assignable)
        )
        row = CycleMembership(
            team_id=team.id,
            cycle_id=cycle.id,
            member_id=member.id,
            member_linear_id=member.linear_id,
            group_id=previous.group_id if previous is not None else None,
            counts_toward_capacity=counts,
            unavailable_days=0.0,
        )
        db.add(row)
        result.append(row)
    return result


def _cycle_label(cycle: dict[str, Any] | None, cycle_id: str | None) -> str:
    """Human label for a Linear cycle payload."""
    if cycle is not None:
        name = cycle.get("name")
        if name:
            return f"cycle '{name}'"
        number = cycle.get("number")
        if number is not None:
            return f"cycle {number:g}"
    if cycle_id:
        return f"cycle '{cycle_id}'"
    return "no active cycle"


def _stored_cycle(db: Session, team: Team) -> Cycle | None:
    if not team.current_cycle_id:
        return None
    return db.get(Cycle, team.current_cycle_id)


def _stored_cycle_label(db: Session, team: Team) -> str:
    """Human label for the cycle currently stored for a team."""
    stored = _stored_cycle(db, team)
    if stored is None:
        return "no cycle"
    if stored.name:
        return f"cycle '{stored.name}'"
    if stored.number is not None:
        return f"cycle {stored.number}"
    return f"cycle '{stored.linear_id}'"


def sync_team_issues(db: Session, client: LinearClient, team: Team) -> SyncSummary:
    """Download the team's current cycle, its issues and membership.

    Only the active cycle's issues are replaced. Earlier (finalized) cycles are
    kept so the database retains per-team cycle history. Cycle rows and members
    are upserted so user overrides survive refreshes.
    """
    # Fetch everything from Linear first; nothing is committed unless all calls
    # succeed.
    cycle, remote_issues = client.current_cycle_issues(team.linear_id)

    # Guard against silently replacing a cycle that hasn't been finalized: if
    # Linear has moved on, the stored cycle must be finalized first. A finalized
    # (archived) cycle is allowed to give way to the new one.
    remote_cycle_id = cycle["id"] if cycle is not None else None
    stored = _stored_cycle(db, team)
    stored_linear_id = stored.linear_id if stored is not None else None
    if team.current_cycle_id is not None and remote_cycle_id != stored_linear_id:
        finalized = stored is not None and stored.archived_at is not None
        if not finalized:
            raise CycleMismatchError(
                "Linear is now on "
                f"{_cycle_label(cycle, remote_cycle_id)}, but "
                f"{_stored_cycle_label(db, team)} is stored locally. "
                "Finalize the current cycle in Cycle Configuration before refreshing."
            )

    remote_members = client.team_members(team.linear_id)

    # Sub-issues are not tracked separately: their estimates would double-count
    # work that is already represented by the parent issue (and Linear's own
    # per-person totals exclude them).
    issues = [remote for remote in remote_issues if not remote.get("parent")]

    previous_cycle_id = team.current_cycle_id
    if cycle is not None:
        cycle_row = upsert_cycle(db, team, cycle)
        # Replace only this cycle's issues; earlier cycles stay put, including
        # carry-over work that now also belongs to the new cycle.
        db.execute(
            delete(Issue).where(
                Issue.team_id == team.id,
                Issue.cycle_id == cycle_row.id,
            )
        )
        for remote in issues:
            db.add(_build_issue(team, remote, cycle_row))
        team.current_cycle_id = cycle_row.id
        team.issue_count = len(issues)
    else:
        # Linear has no active cycle. Keep historical issues; just clear the
        # current-cycle pointer. Do not insert issues without a cycle row.
        cycle_row = None
        team.current_cycle_id = None
        team.issue_count = 0

    members = upsert_team_members(db, team, remote_members)
    db.flush()
    if cycle_row is not None:
        source_id = (
            previous_cycle_id
            if previous_cycle_id is not None and previous_cycle_id != cycle_row.id
            else None
        )
        ensure_cycle_memberships(
            db, team, cycle_row, source_cycle_id=source_id, members=members
        )

    team.last_synced_at = utcnow()
    db.commit()

    return SyncSummary(
        issues_synced=len(issues) if cycle is not None else 0,
        has_active_cycle=cycle is not None,
        members_synced=len(members),
        cycle_id=(cycle or {}).get("id"),
        cycle_name=(cycle or {}).get("name"),
        cycle_number=_as_int((cycle or {}).get("number")),
        cycle_starts_at=parse_dt((cycle or {}).get("startsAt")),
        cycle_ends_at=parse_dt((cycle or {}).get("endsAt")),
    )


def record_sync_run(
    db: Session,
    *,
    kind: str,
    status: str,
    team_id: int | None = None,
    message: str | None = None,
    issues_synced: int = 0,
    run: SyncRun | None = None,
) -> SyncRun:
    """Create or finalize a SyncRun row."""
    if run is None:
        run = SyncRun(kind=kind, status=status, team_id=team_id, message=message)
        db.add(run)
    else:
        run.status = status
        run.message = message
        run.issues_synced = issues_synced
        run.finished_at = utcnow()
    db.commit()
    db.refresh(run)
    return run

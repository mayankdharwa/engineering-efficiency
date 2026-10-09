"""Sync logic: download from Linear and persist into SQLite."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .linear_client import LinearClient
from .models import (
    CycleSettings,
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
    cycle_number: float | None = None
    cycle_starts_at: datetime | None = None
    cycle_ends_at: datetime | None = None


def parse_dt(value: str | None) -> datetime | None:
    """Parse a Linear ISO-8601 timestamp into an aware datetime."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
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


def _build_issue(
    team: Team, remote: dict[str, Any], cycle: dict[str, Any] | None
) -> Issue:
    issue = Issue(linear_id=remote["id"])

    state = remote.get("state") or {}
    assignee = remote.get("assignee") or {}
    creator = remote.get("creator") or {}
    project = remote.get("project") or {}
    # Prefer the active cycle resolved for the team; fall back to the issue's own.
    cycle = cycle or remote.get("cycle") or {}
    labels = (remote.get("labels") or {}).get("nodes") or []

    issue.team_id = team.id
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
    issue.cycle_id = cycle.get("id")
    issue.cycle_name = cycle.get("name")
    issue.cycle_number = cycle.get("number")
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


def upsert_cycle_settings(
    db: Session, team: Team, cycle: dict[str, Any]
) -> CycleSettings:
    """Seed/refresh the settings row for a cycle, preserving user overrides."""
    cycle_id = cycle["id"]
    settings = db.scalar(
        select(CycleSettings).where(
            CycleSettings.team_id == team.id, CycleSettings.cycle_id == cycle_id
        )
    )
    if settings is None:
        settings = CycleSettings(team_id=team.id, cycle_id=cycle_id)
        db.add(settings)

    settings.cycle_name = cycle.get("name")
    settings.cycle_number = cycle.get("number")
    # Only overwrite dates from Linear while the user has not edited them.
    if not settings.dates_overridden:
        settings.starts_at = parse_dt(cycle.get("startsAt"))
        settings.ends_at = parse_dt(cycle.get("endsAt"))
    return settings


def upsert_team_members(
    db: Session, team: Team, remote_members: list[dict[str, Any]]
) -> list[TeamMember]:
    """Upsert the team's Linear membership, keyed by Linear user id.

    New members default to counting toward capacity unless they are inactive or
    not assignable (guests). The flag is preserved on existing rows so manual
    overrides survive refreshes. Members no longer returned by Linear are
    removed from the team.
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
            member = TeamMember(
                team_id=team.id,
                linear_id=remote["id"],
                counts_toward_capacity=bool(
                    remote.get("active", True) and remote.get("isAssignable", True)
                ),
            )
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


def sync_team_issues(db: Session, client: LinearClient, team: Team) -> SyncSummary:
    """Download the team's current cycle, its issues and membership.

    Only issues from the team's active cycle are kept, so a refresh clears any
    issues from a previously active cycle. Cycle settings and members are
    upserted so user overrides survive refreshes.
    """
    # Fetch everything from Linear first; nothing is committed unless all calls
    # succeed.
    cycle, remote_issues = client.current_cycle_issues(team.linear_id)
    remote_members = client.team_members(team.linear_id)

    # Sub-issues are not tracked separately: their estimates would double-count
    # work that is already represented by the parent issue (and Linear's own
    # per-person totals exclude them).
    issues = [remote for remote in remote_issues if not remote.get("parent")]

    db.execute(delete(Issue).where(Issue.team_id == team.id))
    for remote in issues:
        db.add(_build_issue(team, remote, cycle))

    if cycle is not None:
        upsert_cycle_settings(db, team, cycle)
        team.current_cycle_id = cycle["id"]
    else:
        team.current_cycle_id = None

    members = upsert_team_members(db, team, remote_members)

    team.issue_count = len(issues)
    team.last_synced_at = utcnow()
    db.commit()

    return SyncSummary(
        issues_synced=len(issues),
        has_active_cycle=cycle is not None,
        members_synced=len(members),
        cycle_id=(cycle or {}).get("id"),
        cycle_name=(cycle or {}).get("name"),
        cycle_number=(cycle or {}).get("number"),
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

"""Sync logic: download from Linear and persist into SQLite."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .cycles import CycleMemberKey, format_cycle_label
from .datetime_util import parse_iso_datetime
from .linear_client import LinearClient
from .models import (
    Cycle,
    CycleMembership,
    Issue,
    LinearConfig,
    Project,
    ProjectDueDateChange,
    ProjectIssue,
    SyncKind,
    SyncRun,
    SyncStatus,
    Team,
    TeamMember,
    utcnow,
)
from .project_history import target_date_changes


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


@dataclass
class ProjectSyncSummary:
    """Outcome of a single team project refresh."""

    projects_synced: int
    issues_synced: int


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
        return parse_iso_datetime(value)
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
        row = CycleMemberKey(team.id, cycle.id, member.linear_id).new_membership(
            member_id=member.id,
            group_id=previous.group_id if previous is not None else None,
            counts_toward_capacity=counts,
            unavailable_days=0.0,
        )
        db.add(row)
        result.append(row)
    return result


def _cycle_label(cycle: dict[str, Any] | None, cycle_id: str | None) -> str:
    """Human label for a Linear cycle payload."""
    payload = cycle or {}
    return format_cycle_label(
        payload.get("name"),
        payload.get("number"),
        cycle_id,
        missing="no active cycle",
    )


def _stored_cycle(db: Session, team: Team) -> Cycle | None:
    if not team.current_cycle_id:
        return None
    return db.get(Cycle, team.current_cycle_id)


def _stored_cycle_label(db: Session, team: Team) -> str:
    """Human label for the cycle currently stored for a team."""
    stored = _stored_cycle(db, team)
    if stored is None:
        return format_cycle_label(missing="no cycle")
    return format_cycle_label(stored.name, stored.number, stored.linear_id)


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
        finalized = stored is not None and stored.is_finalized
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


def _apply_project_fields(row: Project, remote: dict[str, Any], *, synced_at: datetime) -> None:
    row.name = remote.get("name") or "Untitled project"
    row.state = remote.get("state")
    row.start_date = remote.get("startDate")
    row.target_date = remote.get("targetDate")
    row.completed_at = parse_dt(remote.get("completedAt"))
    row.canceled_at = parse_dt(remote.get("canceledAt"))
    row.archived_at = parse_dt(remote.get("archivedAt"))
    row.last_synced_at = synced_at


def _is_archived(remote: dict[str, Any]) -> bool:
    return bool(remote.get("archivedAt"))


def _ensure_project(
    db: Session,
    team: Team,
    existing: dict[str, Project],
    linear_id: str,
) -> Project:
    row = existing.get(linear_id)
    if row is None:
        row = Project(team_id=team.id, linear_id=linear_id)
        db.add(row)
        existing[linear_id] = row
    return row


def _build_project_issue(team: Team, project: Project, remote: dict[str, Any]) -> ProjectIssue:
    state = remote.get("state") or {}
    assignee = remote.get("assignee") or {}
    return ProjectIssue(
        team_id=team.id,
        project_id=project.id,
        linear_id=remote["id"],
        identifier=remote.get("identifier") or "",
        title=remote.get("title") or "",
        state_name=state.get("name"),
        state_type=state.get("type"),
        estimate=remote.get("estimate"),
        assignee_name=assignee.get("displayName") or assignee.get("name"),
        created_at=parse_dt(remote.get("createdAt")),
        completed_at=parse_dt(remote.get("completedAt")),
        canceled_at=parse_dt(remote.get("canceledAt")),
        archived_at=parse_dt(remote.get("archivedAt")),
    )


def _history_nodes(
    client: LinearClient, project_linear_id: str, history: Any
) -> list[dict[str, Any]]:
    """Read every activity page, following the cursor when the first page is full."""
    payload = history or {}
    nodes = [node for node in (payload.get("nodes") or []) if isinstance(node, dict)]
    page = payload.get("pageInfo") or {}
    after = page.get("endCursor")
    seen_cursors: set[str] = set()
    while page.get("hasNextPage"):
        if not after or after in seen_cursors:
            break
        seen_cursors.add(after)
        fetch = getattr(client, "project_history", None)
        if fetch is None:
            break
        payload = fetch(project_linear_id, after) or {}
        nodes.extend(node for node in (payload.get("nodes") or []) if isinstance(node, dict))
        page = payload.get("pageInfo") or {}
        after = page.get("endCursor")
    return nodes


def _replace_due_date_history(
    db: Session,
    client: LinearClient,
    team: Team,
    project: Project,
    remote: dict[str, Any],
) -> None:
    """Replace one project's stored due-date changes with the activity log."""
    db.execute(
        delete(ProjectDueDateChange).where(ProjectDueDateChange.project_id == project.id)
    )
    for node in _history_nodes(client, project.linear_id, remote.get("history")):
        fallback_at = parse_dt(node.get("createdAt")) or parse_dt(node.get("updatedAt"))
        history_id = node.get("id")
        if not history_id:
            continue
        entries = node.get("entries")
        changes = target_date_changes(entries)
        if fallback_at is None and all(change.changed_at is None for change in changes):
            continue
        for index, change in enumerate(changes):
            changed_at = change.changed_at or fallback_at
            if changed_at is None:
                continue
            linear_id = str(history_id) if index == 0 else f"{history_id}:{index}"
            db.add(
                ProjectDueDateChange(
                    team_id=team.id,
                    project_id=project.id,
                    linear_id=linear_id,
                    changed_at=changed_at,
                    from_date=change.from_date,
                    to_date=change.to_date,
                    raw=entries if isinstance(entries, dict) else {"entries": entries},
                )
            )


def sync_team_projects(db: Session, client: LinearClient, team: Team) -> ProjectSyncSummary:
    """Download the team's Linear projects and their issues.

    Cycle ``issues`` rows are left alone. Project issues replace the previous
    project snapshot for this team so cost always reflects Linear's current
    project membership, including work that spans cycles.
    """
    remote_projects = client.team_projects(team.linear_id)
    remote_issues = client.team_project_issues(team.linear_id)
    issues = [remote for remote in remote_issues if not remote.get("parent")]

    now = utcnow()
    existing = {
        row.linear_id: row
        for row in db.scalars(select(Project).where(Project.team_id == team.id)).all()
    }
    seen_ids: set[str] = set()

    for remote in remote_projects:
        if _is_archived(remote):
            continue
        linear_id = remote["id"]
        seen_ids.add(linear_id)
        row = _ensure_project(db, team, existing, linear_id)
        _apply_project_fields(row, remote, synced_at=now)

    for remote in issues:
        project = remote.get("project") or {}
        linear_id = project.get("id")
        if not linear_id or linear_id in seen_ids or _is_archived(project):
            continue
        seen_ids.add(linear_id)
        row = _ensure_project(db, team, existing, linear_id)
        row.name = project.get("name") or row.name or "Untitled project"
        row.last_synced_at = now

    db.flush()

    db.execute(delete(ProjectIssue).where(ProjectIssue.team_id == team.id))
    stored = 0
    for remote in issues:
        project_payload = remote.get("project") or {}
        project_linear_id = project_payload.get("id")
        if not project_linear_id or _is_archived(project_payload):
            continue
        project_row = existing.get(project_linear_id)
        if project_row is None:
            continue
        db.add(_build_project_issue(team, project_row, remote))
        stored += 1

    for remote in remote_projects:
        if _is_archived(remote) or "history" not in remote:
            continue
        project_row = existing.get(remote.get("id"))
        if project_row is None:
            continue
        _replace_due_date_history(db, client, team, project_row, remote)

    for linear_id, row in list(existing.items()):
        if linear_id not in seen_ids:
            db.delete(row)

    db.commit()
    return ProjectSyncSummary(projects_synced=len(seen_ids), issues_synced=stored)


def record_sync_run(
    db: Session,
    *,
    kind: SyncKind,
    status: SyncStatus,
    team_id: int | None = None,
    message: str | None = None,
    issues_synced: int = 0,
    run: SyncRun | None = None,
) -> SyncRun:
    """Create or finalize a SyncRun row."""
    kind_value = kind.value
    status_value = status.value
    if run is None:
        run = SyncRun(
            kind=kind_value, status=status_value, team_id=team_id, message=message
        )
        db.add(run)
    else:
        run.status = status_value
        run.message = message
        run.issues_synced = issues_synced
        run.finished_at = utcnow()
    db.commit()
    db.refresh(run)
    return run

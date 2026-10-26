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
    """Outcome of a project refresh."""

    projects_synced: int
    issues_synced: int
    projects_skipped: int = 0
    removed: bool = False


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


def _apply_project_fields(
    row: Project, remote: dict[str, Any], *, synced_at: datetime | None
) -> None:
    row.name = remote.get("name") or "Untitled project"
    row.state = _stored_state(remote)
    row.start_date = remote.get("startDate")
    row.target_date = remote.get("targetDate")
    row.completed_at = parse_dt(remote.get("completedAt"))
    row.canceled_at = parse_dt(remote.get("canceledAt"))
    row.archived_at = parse_dt(remote.get("archivedAt"))
    if synced_at is not None:
        row.last_synced_at = synced_at


def _is_archived(remote: dict[str, Any]) -> bool:
    return bool(remote.get("archivedAt"))


# Status names Linear shows for the projects whose issues and activity we refresh.
# The deprecated ``state`` field still uses ``started`` for In Progress.
_ISSUE_SYNC_STATUS_NAMES = frozenset({"planned", "in progress"})
_ISSUE_SYNC_STATE_TYPES = frozenset({"planned", "started"})


def _status_name(remote: dict[str, Any]) -> str | None:
    status = remote.get("status")
    if not isinstance(status, dict):
        return None
    name = status.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    return name.strip()


def _stored_state(remote: dict[str, Any]) -> str | None:
    """State string to keep locally.

    Prefer Linear's status type (``started`` for In Progress) so the rest of
    the app keeps its existing state keys. Fall back to the status name, then
    the deprecated ``state`` field.
    """
    status = remote.get("status")
    if isinstance(status, dict):
        status_type = status.get("type")
        if isinstance(status_type, str) and status_type.strip():
            return status_type.strip()
    state = remote.get("state")
    if isinstance(state, str) and state.strip():
        return state.strip()
    return _status_name(remote)


def _syncs_project_work(remote: dict[str, Any]) -> bool:
    """Whether this refresh should download the project's issues and activity.

    Linear's status names are Planned and In Progress. Payloads that only
    include the deprecated state field use ``planned`` and ``started``.
    """
    name = _status_name(remote)
    if name is not None:
        return name.casefold() in _ISSUE_SYNC_STATUS_NAMES
    state = remote.get("state")
    if not isinstance(state, str):
        return False
    key = state.strip().casefold()
    return key in _ISSUE_SYNC_STATUS_NAMES or key in _ISSUE_SYNC_STATE_TYPES


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


def _remote_project_issues(
    client: LinearClient,
    team: Team,
    remote_projects: list[dict[str, Any]],
    skip_ids: set[str],
) -> list[dict[str, Any]]:
    """Issues on this team's projects, including ones owned by other teams.

    ``team.issues`` only returns issues whose team is this one. Assigning an
    issue to someone on another team moves it to that team, so it disappears
    from this query while staying on the project. Those issues are loaded
    from each project and merged in. Projects in ``skip_ids`` are omitted.
    """
    issues = [
        issue
        for issue in client.team_project_issues(team.linear_id)
        if (issue.get("project") or {}).get("id") not in skip_ids
    ]
    seen = {issue.get("id") for issue in issues if issue.get("id")}
    fetch = getattr(client, "project_issues", None)
    if fetch is None:
        return issues
    for project in remote_projects:
        if _is_archived(project):
            continue
        project_id = project.get("id")
        if not project_id or project_id in skip_ids:
            continue
        for issue in fetch(project_id) or []:
            issue_id = issue.get("id")
            if not issue_id or issue_id in seen:
                continue
            seen.add(issue_id)
            issues.append(issue)
    return issues


def _attach_history(client: LinearClient, remote: dict[str, Any]) -> None:
    """Load the first activity page when the project payload does not have one."""
    if "history" in remote or not remote.get("id"):
        return
    fetch = getattr(client, "project_history", None)
    if fetch is None:
        return
    remote["history"] = fetch(remote["id"], None) or {}


def _drop_replaced_issues(db: Session, project_ids: set[int]) -> None:
    """Delete stored issues for projects whose snapshot is being replaced.

    The objects are removed from the session first. A bulk delete leaves them
    there, and SQLite can reuse their primary keys for the new rows.
    """
    if not project_ids:
        return
    for obj in list(db):
        if isinstance(obj, ProjectIssue) and obj.project_id in project_ids:
            db.expunge(obj)
    db.execute(delete(ProjectIssue).where(ProjectIssue.project_id.in_(project_ids)))


def sync_team_projects(db: Session, client: LinearClient, team: Team) -> ProjectSyncSummary:
    """Download the team's Linear projects and their issues.

    Cycle ``issues`` rows are left alone. Project issues replace the previous
    snapshot for projects that are synced, so cost reflects Linear's current
    membership, including work that spans cycles and issues owned by other
    teams on the same project.

    Issues and due-date activity are downloaded only for Linear statuses
    Planned and In Progress. Every other non-archived project stays in the
    list and keeps the issues and activity it already has. Sync one project
    to refresh a status outside that pair.
    """
    existing = {
        row.linear_id: row
        for row in db.scalars(select(Project).where(Project.team_id == team.id)).all()
    }
    open_projects = {
        remote["id"]: remote
        for remote in client.team_projects(team.linear_id)
        if remote.get("id")
    }
    remote_projects = list(client.team_project_summaries(team.linear_id))
    for remote in remote_projects:
        detailed = open_projects.get(remote.get("id"))
        if detailed and "history" in detailed:
            remote["history"] = detailed["history"]

    skip_ids: set[str] = set()
    full_ids: set[str] = set()
    for remote in remote_projects:
        if _is_archived(remote) or not remote.get("id"):
            continue
        linear_id = remote["id"]
        if _syncs_project_work(remote):
            full_ids.add(linear_id)
        else:
            skip_ids.add(linear_id)

    remote_issues = _remote_project_issues(client, team, remote_projects, skip_ids)
    issues = [remote for remote in remote_issues if not remote.get("parent")]

    now = utcnow()
    seen_ids: set[str] = set(skip_ids)

    for remote in remote_projects:
        if _is_archived(remote):
            continue
        linear_id = remote["id"]
        seen_ids.add(linear_id)
        row = _ensure_project(db, team, existing, linear_id)
        if linear_id in skip_ids:
            _apply_project_fields(row, remote, synced_at=None)
            continue
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

    replace_ids = {
        existing[linear_id].id
        for linear_id in seen_ids
        if linear_id not in skip_ids and linear_id in existing
    }
    _drop_replaced_issues(db, replace_ids)
    for project in existing.values():
        db.expire(project, ["issues"])

    stored = 0
    for remote in issues:
        project_payload = remote.get("project") or {}
        project_linear_id = project_payload.get("id")
        if (
            not project_linear_id
            or project_linear_id in skip_ids
            or _is_archived(project_payload)
        ):
            continue
        project_row = existing.get(project_linear_id)
        if project_row is None:
            continue
        db.add(_build_project_issue(team, project_row, remote))
        stored += 1

    for remote in remote_projects:
        if remote.get("id") not in full_ids:
            continue
        project_row = existing.get(remote.get("id"))
        if project_row is None:
            continue
        _attach_history(client, remote)
        if "history" not in remote:
            continue
        _replace_due_date_history(db, client, team, project_row, remote)

    for linear_id, row in list(existing.items()):
        if linear_id not in seen_ids:
            db.delete(row)

    db.commit()
    return ProjectSyncSummary(
        projects_synced=len(seen_ids - skip_ids),
        issues_synced=stored,
        projects_skipped=len(skip_ids),
    )


def sync_project(
    db: Session, client: LinearClient, team: Team, project: Project
) -> ProjectSyncSummary:
    """Download one project even when a team refresh would leave it alone."""
    fetch_project = getattr(client, "project", None)
    remote = fetch_project(project.linear_id) if fetch_project is not None else None
    if not isinstance(remote, dict) or _is_archived(remote):
        db.delete(project)
        db.commit()
        return ProjectSyncSummary(projects_synced=0, issues_synced=0, removed=True)

    _apply_project_fields(project, remote, synced_at=utcnow())
    fetch_issues = getattr(client, "project_issues", None)
    issues = []
    if fetch_issues is not None:
        issues = [
            issue
            for issue in (fetch_issues(project.linear_id) or [])
            if not issue.get("parent")
        ]
    db.flush()
    _drop_replaced_issues(db, {project.id})
    db.expire(project, ["issues"])
    for issue in issues:
        db.add(_build_project_issue(team, project, issue))
    _attach_history(client, remote)
    if "history" in remote:
        _replace_due_date_history(db, client, team, project, remote)
    db.commit()
    return ProjectSyncSummary(projects_synced=1, issues_synced=len(issues))


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

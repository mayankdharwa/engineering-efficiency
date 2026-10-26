"""Linear GraphQL API client."""

from __future__ import annotations

from typing import Any

import httpx

from .config import settings

VIEWER_QUERY = """
query Viewer {
  viewer {
    id
    name
    email
    organization { name }
  }
}
"""

TEAMS_QUERY = """
query Teams($after: String) {
  teams(first: 100, after: $after) {
    nodes {
      id
      key
      name
      description
      color
      issueCount
      archivedAt
      cyclesEnabled
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

CURRENT_CYCLE_ISSUES_QUERY = """
query TeamCurrentCycleIssues($teamId: String!, $after: String) {
  team(id: $teamId) {
    activeCycle {
      id
      name
      number
      startsAt
      endsAt
      issues(first: 100, after: $after) {
        nodes {
          id
          identifier
          title
          description
          priority
          estimate
          createdAt
          updatedAt
          startedAt
          completedAt
          canceledAt
          archivedAt
          state { name type }
          assignee { id name displayName }
          creator { name displayName }
          project { name }
          cycle { id name number }
          labels { nodes { name } }
          addedToCycleAt
          parent { id }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
"""

_PROJECT_NODE_FIELDS = """
        id
        name
        state
        status { name type }
        startDate
        targetDate
        completedAt
        canceledAt
        archivedAt
"""

_PROJECT_HISTORY_FIELDS = """
        history(first: 50, includeArchived: true) {
          nodes { id createdAt entries }
          pageInfo { hasNextPage endCursor }
        }
"""

TEAM_PROJECTS_QUERY = f"""
query TeamProjects($teamId: String!, $after: String, $filter: ProjectFilter) {{
  team(id: $teamId) {{
    projects(first: 50, after: $after, includeArchived: false, filter: $filter) {{
      nodes {{
{_PROJECT_NODE_FIELDS}
{_PROJECT_HISTORY_FIELDS}
      }}
      pageInfo {{ hasNextPage endCursor }}
    }}
  }}
}}
"""

TEAM_PROJECTS_WITHOUT_HISTORY_QUERY = f"""
query TeamProjectsWithoutHistory($teamId: String!, $after: String, $filter: ProjectFilter) {{
  team(id: $teamId) {{
    projects(first: 100, after: $after, includeArchived: false, filter: $filter) {{
      nodes {{
{_PROJECT_NODE_FIELDS}
      }}
      pageInfo {{ hasNextPage endCursor }}
    }}
  }}
}}
"""

PROJECT_QUERY = f"""
query Project($projectId: String!) {{
  project(id: $projectId) {{
{_PROJECT_NODE_FIELDS}
{_PROJECT_HISTORY_FIELDS}
  }}
}}
"""

PROJECT_HISTORY_QUERY = """
query ProjectHistory($projectId: String!, $after: String) {
  project(id: $projectId) {
    history(first: 50, after: $after, includeArchived: true) {
      nodes { id createdAt entries }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

_PROJECT_ISSUE_FIELDS = """
        id
        identifier
        title
        estimate
        createdAt
        completedAt
        canceledAt
        archivedAt
        state { name type }
        assignee { id name displayName }
        project { id name archivedAt }
        parent { id }
"""

TEAM_PROJECT_ISSUES_QUERY = f"""
query TeamProjectIssues($teamId: String!, $after: String, $filter: IssueFilter) {{
  team(id: $teamId) {{
    issues(first: 100, after: $after, filter: $filter) {{
      nodes {{
{_PROJECT_ISSUE_FIELDS}
      }}
      pageInfo {{ hasNextPage endCursor }}
    }}
  }}
}}
"""

PROJECT_ISSUES_QUERY = f"""
query ProjectIssues($projectId: String!, $after: String) {{
  project(id: $projectId) {{
    issues(first: 100, after: $after) {{
      nodes {{
{_PROJECT_ISSUE_FIELDS}
      }}
      pageInfo {{ hasNextPage endCursor }}
    }}
  }}
}}
"""

TEAM_MEMBERS_QUERY = """
query TeamMembers($teamId: String!, $after: String) {
  team(id: $teamId) {
    members(first: 100, after: $after) {
      nodes {
        id
        name
        displayName
        email
        avatarUrl
        active
        isAssignable
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""


class LinearError(RuntimeError):
    """Raised when the Linear API returns an error."""


class LinearClient:
    def __init__(self, api_key: str) -> None:
        self._client = httpx.Client(
            base_url=settings.linear_api_url,
            headers={
                # Linear personal API keys are passed verbatim (no "Bearer").
                "Authorization": api_key,
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> LinearClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def _post(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._client.post("", json={"query": query, "variables": variables})
        except httpx.HTTPError as exc:  # network-level failure
            raise LinearError(f"Could not reach Linear: {exc}") from exc

        if response.status_code == 401:
            raise LinearError("Linear rejected the API key (401 Unauthorized).")
        if response.status_code >= 400:
            raise LinearError(f"Linear API error {response.status_code}: {response.text[:300]}")

        payload = response.json()
        if payload.get("errors"):
            messages = "; ".join(e.get("message", "unknown error") for e in payload["errors"])
            raise LinearError(messages)
        return payload.get("data") or {}

    def viewer(self) -> dict[str, Any]:
        return self._post(VIEWER_QUERY, {}).get("viewer") or {}

    def teams(self) -> list[dict[str, Any]]:
        teams: list[dict[str, Any]] = []
        after: str | None = None
        while True:
            data = self._post(TEAMS_QUERY, {"after": after})
            connection = data.get("teams") or {}
            teams.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return teams
            after = page.get("endCursor")

    def current_cycle_issues(
        self, team_linear_id: str
    ) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        """Return the team's active cycle and all of its issues.

        Returns ``(None, [])`` when the team has no active cycle.
        """
        issues: list[dict[str, Any]] = []
        cycle: dict[str, Any] | None = None
        after: str | None = None

        while True:
            data = self._post(
                CURRENT_CYCLE_ISSUES_QUERY,
                {"teamId": team_linear_id, "after": after},
            )
            team = data.get("team") or {}
            active_cycle = team.get("activeCycle")
            if active_cycle is None:
                return None, []

            if cycle is None:
                cycle = {
                    key: active_cycle.get(key)
                    for key in ("id", "name", "number", "startsAt", "endsAt")
                }

            connection = active_cycle.get("issues") or {}
            issues.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return cycle, issues
            after = page.get("endCursor")

    def team_members(self, team_linear_id: str) -> list[dict[str, Any]]:
        """Return every member of a team (active only)."""
        members: list[dict[str, Any]] = []
        after: str | None = None
        while True:
            data = self._post(TEAM_MEMBERS_QUERY, {"teamId": team_linear_id, "after": after})
            team = data.get("team") or {}
            connection = team.get("members") or {}
            members.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return members
            after = page.get("endCursor")

    def team_project_summaries(self, team_linear_id: str) -> list[dict[str, Any]]:
        """Return every non-archived project, without activity history."""
        return self._team_project_pages(
            team_linear_id, TEAM_PROJECTS_WITHOUT_HISTORY_QUERY, None
        )

    def team_projects(self, team_linear_id: str) -> list[dict[str, Any]]:
        """Return Planned and In Progress projects, including due-date activity.

        Other statuses are omitted so their activity logs are not downloaded
        on every refresh. History is nested in the project query. When Linear
        rejects that query as too complex, projects are loaded first and each
        history connection is fetched on its own.
        """
        try:
            return self._team_project_pages(
                team_linear_id, TEAM_PROJECTS_QUERY, _ISSUE_SYNC_PROJECT_FILTER
            )
        except LinearError as exc:
            if not _is_complexity_error(exc):
                raise
        projects = self._team_project_pages(
            team_linear_id,
            TEAM_PROJECTS_WITHOUT_HISTORY_QUERY,
            _ISSUE_SYNC_PROJECT_FILTER,
        )
        for project in projects:
            project_id = project.get("id")
            if not project_id:
                continue
            project["history"] = self.project_history(project_id, None)
        return projects

    def project(self, project_linear_id: str) -> dict[str, Any] | None:
        """Return one project, including the first page of its activity log."""
        data = self._post(PROJECT_QUERY, {"projectId": project_linear_id})
        project = data.get("project")
        if not isinstance(project, dict):
            return None
        return project

    def project_history(
        self, project_linear_id: str, after: str | None = None
    ) -> dict[str, Any]:
        """Return one page of a project's activity log."""
        data = self._post(
            PROJECT_HISTORY_QUERY,
            {"projectId": project_linear_id, "after": after},
        )
        project = data.get("project") or {}
        return project.get("history") or {}

    def _team_project_pages(
        self,
        team_linear_id: str,
        query: str,
        project_filter: dict[str, Any] | None,
    ) -> list[dict[str, Any]]:
        projects: list[dict[str, Any]] = []
        after: str | None = None
        while True:
            data = self._post(
                query,
                {"teamId": team_linear_id, "after": after, "filter": project_filter},
            )
            team = data.get("team") or {}
            connection = team.get("projects") or {}
            projects.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return projects
            after = page.get("endCursor")

    def team_project_issues(self, team_linear_id: str) -> list[dict[str, Any]]:
        """Return this team's issues on Planned and In Progress projects.

        Issues owned by another team on the same project are not included.
        Load those with ``project_issues``. Other project statuses are omitted
        because a team refresh leaves their stored issues in place.
        """
        return self._issue_pages(
            TEAM_PROJECT_ISSUES_QUERY,
            {"teamId": team_linear_id, "filter": _ISSUE_SYNC_ISSUE_FILTER},
            "team",
        )

    def project_issues(self, project_linear_id: str) -> list[dict[str, Any]]:
        """Return every issue on a project, including other teams' issues.

        Linear keeps an issue on the assignee's team. ``team.issues`` therefore
        drops project work assigned to someone on a different team, while the
        project itself still lists it.
        """
        return self._issue_pages(
            PROJECT_ISSUES_QUERY, {"projectId": project_linear_id}, "project"
        )

    def _issue_pages(
        self, query: str, variables: dict[str, Any], root_key: str
    ) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        after: str | None = None
        seen_cursors: set[str] = set()
        while True:
            data = self._post(query, {**variables, "after": after})
            root = data.get(root_key) or {}
            connection = root.get("issues") or {}
            issues.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return issues
            after = page.get("endCursor")
            if not after or after in seen_cursors:
                return issues
            seen_cursors.add(after)


def _is_complexity_error(exc: LinearError) -> bool:
    """True when Linear rejected a query for exceeding its complexity budget."""
    return "complex" in str(exc).lower()


# Linear status names. "In Progress" is the default name for the started type.
_ISSUE_SYNC_STATUS_NAMES = ["Planned", "In Progress"]
_ISSUE_SYNC_PROJECT_FILTER: dict[str, Any] = {
    "status": {"name": {"in": _ISSUE_SYNC_STATUS_NAMES}}
}
_ISSUE_SYNC_ISSUE_FILTER: dict[str, Any] = {
    "project": {"null": False, "status": {"name": {"in": _ISSUE_SYNC_STATUS_NAMES}}}
}

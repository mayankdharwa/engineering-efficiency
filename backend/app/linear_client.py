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
query TeamProjects($teamId: String!, $after: String) {{
  team(id: $teamId) {{
    projects(first: 50, after: $after, includeArchived: false) {{
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
query TeamProjectsWithoutHistory($teamId: String!, $after: String) {{
  team(id: $teamId) {{
    projects(first: 100, after: $after, includeArchived: false) {{
      nodes {{
{_PROJECT_NODE_FIELDS}
      }}
      pageInfo {{ hasNextPage endCursor }}
    }}
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

TEAM_PROJECT_ISSUES_QUERY = """
query TeamProjectIssues($teamId: String!, $after: String) {
  team(id: $teamId) {
    issues(
      first: 100
      after: $after
      filter: { project: { null: false } }
    ) {
      nodes {
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
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
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

    def team_projects(self, team_linear_id: str) -> list[dict[str, Any]]:
        """Return the team's active projects, including due-date activity.

        History is nested in the project query. When Linear rejects that query
        as too complex, projects are loaded first and each history connection
        is fetched on its own.
        """
        try:
            return self._team_project_pages(team_linear_id, TEAM_PROJECTS_QUERY)
        except LinearError as exc:
            if not _is_complexity_error(exc):
                raise
        projects = self._team_project_pages(
            team_linear_id, TEAM_PROJECTS_WITHOUT_HISTORY_QUERY
        )
        for project in projects:
            project_id = project.get("id")
            if not project_id:
                continue
            project["history"] = self.project_history(project_id, None)
        return projects

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

    def _team_project_pages(self, team_linear_id: str, query: str) -> list[dict[str, Any]]:
        projects: list[dict[str, Any]] = []
        after: str | None = None
        while True:
            data = self._post(query, {"teamId": team_linear_id, "after": after})
            team = data.get("team") or {}
            connection = team.get("projects") or {}
            projects.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return projects
            after = page.get("endCursor")

    def team_project_issues(self, team_linear_id: str) -> list[dict[str, Any]]:
        """Return the team's issues that belong to a Linear project."""
        issues: list[dict[str, Any]] = []
        after: str | None = None
        while True:
            data = self._post(
                TEAM_PROJECT_ISSUES_QUERY, {"teamId": team_linear_id, "after": after}
            )
            team = data.get("team") or {}
            connection = team.get("issues") or {}
            issues.extend(connection.get("nodes") or [])
            page = connection.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return issues
            after = page.get("endCursor")


def _is_complexity_error(exc: LinearError) -> bool:
    """True when Linear rejected a query for exceeding its complexity budget."""
    return "complex" in str(exc).lower()

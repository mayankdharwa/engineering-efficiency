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
  teams(first: 100, after: $after, includeArchived: true) {
    nodes {
      id
      key
      name
      description
      color
      issueCount
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
    def __init__(self, api_key: str, endpoint: str | None = None) -> None:
        self._client = httpx.Client(
            base_url=endpoint or settings.linear_api_url,
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

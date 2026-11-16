"""Analytics returns the last six cycles, oldest first, with group and member ratios."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Cycle, CycleMembership, Issue, MemberGroup, Team, TeamMember
from tests.auth_helpers import authenticate

POINTS_PER_DAY = 2.0
WORKING_DAYS = 10.0


def _make_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    authenticate(client)
    return client, testing_session


def _cycle_window(number: int) -> tuple[datetime, datetime]:
    """A past two-week window with exactly ten weekdays, Monday through Friday."""
    start = datetime(2026, 1, 5, 12, tzinfo=UTC) + timedelta(days=(number - 1) * 14)
    return start, start + timedelta(days=11)


def _seed(session_factory) -> tuple[int, int]:
    with session_factory() as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        other = Team(linear_id="t2", key="DES", name="Design")
        db.add_all([team, other])
        db.flush()
        platform = MemberGroup(team_id=team.id, name="Platform", color="#2563eb")
        db.add(platform)
        db.flush()
        ada = TeamMember(team_id=team.id, linear_id="u1", name="Ada")
        grace = TeamMember(team_id=team.id, linear_id="u2", name="Grace")
        db.add_all([ada, grace])
        db.flush()

        cycles: list[Cycle] = []
        for number in range(1, 8):
            starts_at, ends_at = _cycle_window(number)
            cycle = Cycle(
                team_id=team.id,
                linear_id=f"c{number}",
                name=f"Cycle {number}",
                number=number,
                starts_at=starts_at,
                ends_at=ends_at,
                working_days=WORKING_DAYS,
            )
            db.add(cycle)
            cycles.append(cycle)
        db.flush()
        team.current_cycle_id = cycles[-1].id

        for cycle in cycles:
            db.add(
                CycleMembership(
                    team_id=team.id,
                    cycle_id=cycle.id,
                    member_id=ada.id,
                    member_linear_id="u1",
                    group_id=platform.id,
                    counts_toward_capacity=True,
                )
            )
            db.add(
                Issue(
                    linear_id=f"i-ada-{cycle.number}",
                    team_id=team.id,
                    cycle_id=cycle.id,
                    identifier=f"ENG-{cycle.number}",
                    title=f"Ada {cycle.number}",
                    estimate=float(cycle.number or 0),
                    state_type="completed",
                    assignee_linear_id="u1",
                    assignee_name="Ada",
                )
            )

        newest = cycles[-1]
        db.add(
            CycleMembership(
                team_id=team.id,
                cycle_id=newest.id,
                member_id=grace.id,
                member_linear_id="u2",
                counts_toward_capacity=True,
            )
        )
        db.add(
            Issue(
                linear_id="i-grace-7",
                team_id=team.id,
                cycle_id=newest.id,
                identifier="ENG-70",
                title="Grace 7",
                estimate=4.0,
                state_type="completed",
                assignee_linear_id="u2",
                assignee_name="Grace",
            )
        )

        other_start, other_end = _cycle_window(9)
        other_cycle = Cycle(
            team_id=other.id,
            linear_id="c-other",
            name="Cycle 99",
            number=99,
            starts_at=other_start,
            ends_at=other_end,
            working_days=WORKING_DAYS,
        )
        db.add(other_cycle)
        db.commit()
        return team.id, other.id


def test_analytics_keeps_the_last_six_cycles_oldest_first() -> None:
    client, session_factory = _make_client()
    try:
        team_id, other_id = _seed(session_factory)
        response = client.get(f"/api/teams/{team_id}/analytics")
        assert response.status_code == 200
        body = response.json()
        assert body["cycle_limit"] == 6
        cycles = body["cycles"]
        assert [cycle["cycle_number"] for cycle in cycles] == [2, 3, 4, 5, 6, 7]

        capacity = WORKING_DAYS * POINTS_PER_DAY
        first = cycles[0]
        assert first["velocity"] == pytest.approx(2 / capacity)
        assert first["bandwidth_efficiency"] == pytest.approx(2 / capacity)
        assert first["planning_efficiency"] == pytest.approx(1)
        assert [group["label"] for group in first["groups"]] == ["Platform"]
        assert first["groups"][0]["color"] == "#2563eb"
        assert first["groups"][0]["velocity"] == pytest.approx(2 / capacity)
        assert [member["name"] for member in first["members"]] == ["Ada"]

        latest = cycles[-1]
        # Ada finished 7 points and Grace finished 4; both have a full capacity.
        assert latest["velocity"] == pytest.approx(11 / (capacity * 2))
        assert latest["bandwidth_efficiency"] == pytest.approx(11 / (capacity * 2))
        assert latest["planning_efficiency"] == pytest.approx(1)
        by_label = {group["label"]: group for group in latest["groups"]}
        assert by_label["Platform"]["velocity"] == pytest.approx(7 / capacity)
        assert by_label["Unassigned"]["velocity"] == pytest.approx(4 / capacity)
        assert {member["name"] for member in latest["members"]} == {"Ada", "Grace"}

        other = client.get(f"/api/teams/{other_id}/analytics")
        assert other.status_code == 200
        assert [cycle["cycle_number"] for cycle in other.json()["cycles"]] == [99]

        missing = client.get("/api/teams/999/analytics")
        assert missing.status_code == 404
    finally:
        app.dependency_overrides.clear()

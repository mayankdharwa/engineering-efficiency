"""Tests for Linear team import filtering and cycle-aware refresh."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Cycle, CycleMembership, Issue, MemberGroup, Team, TeamMember
from app.sync import CycleMismatchError, sync_team_issues, upsert_teams


class _FakeClient:
    """Minimal stand-in exposing the one method ``upsert_teams`` calls."""

    def __init__(self, teams: list[dict]) -> None:
        self._teams = teams

    def teams(self) -> list[dict]:
        return self._teams


def _add_cycle(db: Session, team: Team, linear_id: str, **kwargs) -> Cycle:
    cycle = Cycle(team_id=team.id, linear_id=linear_id, **kwargs)
    db.add(cycle)
    db.flush()
    return cycle


def test_upsert_teams_skips_archived_and_cycleless_teams() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    client = _FakeClient(
        [
            {"id": "t1", "key": "ENG", "name": "Engineering", "issueCount": 3},
            {
                "id": "t2",
                "key": "OPS",
                "name": "Ops",
                "issueCount": 1,
                "archivedAt": "2026-01-01T00:00:00.000Z",
            },
            {
                "id": "t3",
                "key": "DOC",
                "name": "Docs",
                "issueCount": 0,
                "cyclesEnabled": False,
            },
            {
                "id": "t4",
                "key": "QA",
                "name": "Quality",
                "issueCount": 2,
                "archivedAt": None,
                "cyclesEnabled": True,
            },
        ]
    )

    with Session(engine) as db:
        imported = upsert_teams(db, client)
        assert [team.linear_id for team in imported] == ["t1", "t4"]
        assert {team.linear_id for team in db.scalars(select(Team)).all()} == {
            "t1",
            "t4",
        }


def test_upsert_teams_treats_missing_cycles_flag_as_enabled() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    # A response that omits `cyclesEnabled` must still import the team.
    client = _FakeClient([{"id": "t1", "key": "ENG", "name": "Engineering"}])

    with Session(engine) as db:
        imported = upsert_teams(db, client)
        assert [team.linear_id for team in imported] == ["t1"]


class _FakeSyncClient:
    """Minimal stand-in for the calls ``sync_team_issues`` makes."""

    def __init__(self, cycle: dict | None, issues: list[dict], members: list[dict]):
        self._cycle = cycle
        self._issues = issues
        self._members = members

    def current_cycle_issues(self, team_id: str) -> tuple[dict | None, list[dict]]:
        return self._cycle, self._issues

    def team_members(self, team_id: str) -> list[dict]:
        return self._members


def test_refresh_fails_when_linear_cycle_differs() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        stored = _add_cycle(db, team, "old", name="Cycle 4")
        team.current_cycle_id = stored.id
        db.add(
            Issue(
                linear_id="i1",
                team_id=team.id,
                cycle_id=stored.id,
                identifier="ENG-1",
                title="Existing",
                estimate=2.0,
            )
        )
        db.commit()

        client = _FakeSyncClient({"id": "new", "name": "Cycle 5", "number": 5}, [], [])

        with pytest.raises(CycleMismatchError):
            sync_team_issues(db, client, team)

        # Nothing was cleared and the stored cycle is unchanged.
        assert team.current_cycle_id == stored.id
        assert db.scalar(select(Issue).where(Issue.team_id == team.id)) is not None


def test_refresh_fails_when_linear_has_no_active_cycle() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        stored = _add_cycle(db, team, "old", name="Cycle 4")
        team.current_cycle_id = stored.id
        db.commit()

        client = _FakeSyncClient(None, [], [])
        with pytest.raises(CycleMismatchError):
            sync_team_issues(db, client, team)


def test_refresh_allows_matching_cycle() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        stored = _add_cycle(db, team, "c1", name="Cycle 4", number=4)
        team.current_cycle_id = stored.id
        db.commit()

        cycle = {"id": "c1", "name": "Cycle 4", "number": 4}
        issues = [
            {
                "id": "i1",
                "identifier": "ENG-1",
                "title": "Work",
                "estimate": 2.0,
                "state": {"name": "Done", "type": "completed"},
                "assignee": {"id": "u1", "displayName": "Ada"},
            }
        ]
        members = [{"id": "u1", "name": "Ada", "displayName": "Ada"}]
        client = _FakeSyncClient(cycle, issues, members)

        summary = sync_team_issues(db, client, team)
        assert summary.has_active_cycle is True
        assert summary.cycle_id == "c1"
        assert summary.issues_synced == 1
        assert team.current_cycle_id == stored.id
        assert db.scalar(select(TeamMember).where(TeamMember.linear_id == "u1")) is not None


def test_refresh_without_stored_cycle_is_allowed() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.commit()

        client = _FakeSyncClient({"id": "c1", "name": "Cycle 1", "number": 1}, [], [])
        summary = sync_team_issues(db, client, team)
        assert summary.cycle_id == "c1"
        stored = db.get(Cycle, team.current_cycle_id)
        assert stored is not None
        assert stored.linear_id == "c1"


def test_finalized_cycle_allows_switch_and_keeps_history() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        old = _add_cycle(
            db,
            team,
            "old",
            name="Cycle 4",
            archived_at=datetime(2026, 10, 10, tzinfo=UTC),
        )
        team.current_cycle_id = old.id
        db.add(
            Issue(
                linear_id="i-old",
                team_id=team.id,
                cycle_id=old.id,
                identifier="ENG-1",
                title="Old cycle work",
                estimate=2.0,
            )
        )
        db.commit()

        cycle = {"id": "new", "name": "Cycle 5", "number": 5}
        issues = [
            {
                "id": "i-new",
                "identifier": "ENG-2",
                "title": "New cycle work",
                "estimate": 3.0,
            }
        ]
        client = _FakeSyncClient(cycle, issues, [])

        summary = sync_team_issues(db, client, team)
        assert summary.cycle_id == "new"
        current = db.get(Cycle, team.current_cycle_id)
        assert current is not None and current.linear_id == "new"

        # Both cycles' issues are retained after the switch.
        old_issue = db.scalar(select(Issue).where(Issue.linear_id == "i-old"))
        new_issue = db.scalar(select(Issue).where(Issue.linear_id == "i-new"))
        assert old_issue is not None and old_issue.cycle_id == old.id
        assert new_issue is not None and new_issue.cycle_id == current.id


def test_finalized_cycle_keeps_carryover_issues() -> None:
    """The same Linear issue can exist on consecutive cycles after a rollover."""
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        old = _add_cycle(
            db,
            team,
            "old",
            name="Cycle 4",
            archived_at=datetime(2026, 10, 10, tzinfo=UTC),
        )
        team.current_cycle_id = old.id
        db.add(
            Issue(
                linear_id="i-carry",
                team_id=team.id,
                cycle_id=old.id,
                identifier="ENG-1",
                title="Carry-over work",
                estimate=2.0,
            )
        )
        db.commit()

        client = _FakeSyncClient(
            {"id": "new", "name": "Cycle 5", "number": 5},
            [
                {
                    "id": "i-carry",
                    "identifier": "ENG-1",
                    "title": "Carry-over work",
                    "estimate": 2.0,
                }
            ],
            [],
        )

        sync_team_issues(db, client, team)

        rows = list(db.scalars(select(Issue).where(Issue.linear_id == "i-carry")).all())
        assert len(rows) == 2
        assert {row.cycle_id for row in rows} == {old.id, team.current_cycle_id}


def test_refresh_without_linear_cycle_clears_pointer_keeps_history() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        old = _add_cycle(
            db,
            team,
            "old",
            name="Cycle 4",
            archived_at=datetime(2026, 10, 10, tzinfo=UTC),
        )
        team.current_cycle_id = old.id
        db.add(
            Issue(
                linear_id="i-old",
                team_id=team.id,
                cycle_id=old.id,
                identifier="ENG-1",
                title="Old cycle work",
                estimate=2.0,
            )
        )
        db.commit()

        summary = sync_team_issues(db, _FakeSyncClient(None, [], []), team)
        assert summary.has_active_cycle is False
        assert team.current_cycle_id is None
        assert db.scalar(select(Issue).where(Issue.linear_id == "i-old")) is not None


def test_new_cycle_copies_group_and_capacity_not_leave() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        team = Team(linear_id="t1", key="ENG", name="Engineering")
        db.add(team)
        db.flush()
        group = MemberGroup(team_id=team.id, name="Backend")
        db.add(group)
        db.flush()
        old = _add_cycle(
            db,
            team,
            "old",
            name="Cycle 4",
            archived_at=datetime(2026, 10, 10, tzinfo=UTC),
        )
        team.current_cycle_id = old.id
        member = TeamMember(
            team_id=team.id, linear_id="u1", name="Ada", active=True, is_assignable=True
        )
        db.add(member)
        db.flush()
        db.add(
            CycleMembership(
                team_id=team.id,
                cycle_id=old.id,
                member_id=member.id,
                member_linear_id="u1",
                group_id=group.id,
                counts_toward_capacity=False,
                unavailable_days=2.0,
            )
        )
        db.commit()

        client = _FakeSyncClient(
            {"id": "new", "name": "Cycle 5", "number": 5},
            [],
            [{"id": "u1", "name": "Ada", "displayName": "Ada", "active": True, "isAssignable": True}],
        )
        sync_team_issues(db, client, team)

        snapshot = db.scalar(
            select(CycleMembership).where(
                CycleMembership.cycle_id == team.current_cycle_id,
                CycleMembership.member_linear_id == "u1",
            )
        )
        assert snapshot is not None
        assert snapshot.group_id == group.id
        assert snapshot.counts_toward_capacity is False
        assert snapshot.unavailable_days == 0.0
        old_snapshot = db.scalar(
            select(CycleMembership).where(
                CycleMembership.cycle_id == old.id,
                CycleMembership.member_linear_id == "u1",
            )
        )
        assert old_snapshot is not None
        assert old_snapshot.unavailable_days == 2.0

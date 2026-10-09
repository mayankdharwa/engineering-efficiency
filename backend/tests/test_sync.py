"""Tests for Linear team import filtering."""

from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Team
from app.sync import upsert_teams


class _FakeClient:
    """Minimal stand-in exposing the one method ``upsert_teams`` calls."""

    def __init__(self, teams: list[dict]) -> None:
        self._teams = teams

    def teams(self) -> list[dict]:
        return self._teams


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

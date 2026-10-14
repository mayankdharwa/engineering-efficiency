"""Member group CRUD endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..database import get_db
from ..group_colors import pick_default_color
from ..models import Cycle, CycleMembership, MemberGroup
from ..schemas import GroupIn, GroupOut
from .deps import get_team_or_404

router = APIRouter(prefix="/teams", tags=["groups"])


def _group_or_404(db: Session, team_id: int, group_id: int) -> MemberGroup:
    group = db.get(MemberGroup, group_id)
    if group is None or group.team_id != team_id:
        raise HTTPException(status_code=404, detail=f"Group {group_id} not found.")
    return group


def _normalized_unique_group_name(
    db: Session, team_id: int, raw_name: str, *, exclude_id: int | None = None
) -> str:
    name = raw_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name cannot be blank.")
    stmt = select(MemberGroup).where(
        MemberGroup.team_id == team_id, MemberGroup.name == name
    )
    if exclude_id is not None:
        stmt = stmt.where(MemberGroup.id != exclude_id)
    if db.scalar(stmt) is not None:
        raise HTTPException(
            status_code=400, detail=f"Group '{name}' already exists for this team."
        )
    return name


@router.get("/{team_id}/groups", response_model=list[GroupOut])
def list_groups(team_id: int, db: Session = Depends(get_db)) -> list[MemberGroup]:
    """All groups defined for a team, in creation order."""
    get_team_or_404(db, team_id)
    return list(
        db.scalars(
            select(MemberGroup)
            .where(MemberGroup.team_id == team_id)
            .order_by(MemberGroup.id)
        ).all()
    )


@router.post(
    "/{team_id}/groups",
    response_model=GroupOut,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def create_group(
    team_id: int, payload: GroupIn, db: Session = Depends(get_db)
) -> MemberGroup:
    """Add a group to a team."""
    team = get_team_or_404(db, team_id)
    name = _normalized_unique_group_name(db, team.id, payload.name)

    color = payload.color or pick_default_color(
        [
            row.color
            for row in db.scalars(
                select(MemberGroup).where(MemberGroup.team_id == team.id)
            ).all()
        ]
    )
    group = MemberGroup(team_id=team.id, name=name, color=color)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.put(
    "/{team_id}/groups/{group_id}",
    response_model=GroupOut,
    dependencies=[Depends(require_admin)],
)
def update_group(
    team_id: int,
    group_id: int,
    payload: GroupIn,
    db: Session = Depends(get_db),
) -> MemberGroup:
    """Rename a team's group and/or change its chip colour."""
    get_team_or_404(db, team_id)
    group = _group_or_404(db, team_id, group_id)
    group.name = _normalized_unique_group_name(
        db, team_id, payload.name, exclude_id=group_id
    )
    if payload.color is not None:
        group.color = payload.color
    db.commit()
    db.refresh(group)
    return group


@router.delete(
    "/{team_id}/groups/{group_id}",
    status_code=204,
    dependencies=[Depends(require_admin)],
)
def delete_group(
    team_id: int, group_id: int, db: Session = Depends(get_db)
) -> Response:
    """Remove a group, unassigning any members that belonged to it."""
    get_team_or_404(db, team_id)
    group = _group_or_404(db, team_id, group_id)
    finalized_use = db.scalar(
        select(CycleMembership.id)
        .join(Cycle, Cycle.id == CycleMembership.cycle_id)
        .where(
            CycleMembership.group_id == group.id,
            Cycle.is_finalized,
        )
        .limit(1)
    )
    if finalized_use is not None:
        raise HTTPException(
            status_code=409,
            detail="Group is used by a finalized cycle and cannot be deleted.",
        )
    db.execute(
        update(CycleMembership)
        .where(CycleMembership.group_id == group.id)
        .values(group_id=None)
    )
    db.delete(group)
    db.commit()
    return Response(status_code=204)

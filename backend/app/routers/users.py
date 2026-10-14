"""App-user management. Admins only; never included in export."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    ensure_another_admin,
    hash_password,
    require_admin,
    user_to_out,
)
from ..database import get_db
from ..models import User, UserRole
from ..schemas import UserCreateIn, UserOut, UserUpdateIn

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])


def _user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found.")
    return user


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[UserOut]:
    rows = db.scalars(select(User).order_by(User.username)).all()
    return [user_to_out(row) for row in rows]


@router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserCreateIn, db: Session = Depends(get_db)) -> UserOut:
    existing = db.scalar(select(User).where(User.username == payload.username))
    if existing is not None:
        raise HTTPException(
            status_code=400, detail=f"Username '{payload.username}' is already taken."
        )
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, payload: UserUpdateIn, db: Session = Depends(get_db)
) -> UserOut:
    user = _user_or_404(db, user_id)
    if payload.role is not None and payload.role != user.role:
        if payload.role != UserRole.ADMIN:
            ensure_another_admin(db, user)
        user.role = payload.role
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user_to_out(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
) -> Response:
    user = _user_or_404(db, user_id)
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    ensure_another_admin(db, user)
    db.delete(user)
    db.commit()
    return Response(status_code=204)

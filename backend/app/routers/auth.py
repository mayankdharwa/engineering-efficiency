"""Login, first-run account creation, and the current session."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import (
    clear_session_cookie,
    hash_password,
    require_user,
    set_session_cookie,
    user_count,
    user_from_request,
    verify_password,
)
from ..database import get_db
from ..models import User
from ..schemas import AuthCredentialsIn, AuthStatusOut, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatusOut)
def auth_status(request: Request, db: Session = Depends(get_db)) -> AuthStatusOut:
    user = user_from_request(request, db)
    return AuthStatusOut(
        authenticated=user is not None,
        setup_required=user_count(db) == 0,
        username=user.username if user else None,
    )


@router.post("/setup", response_model=UserOut)
def setup_account(
    payload: AuthCredentialsIn,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    if user_count(db) > 0:
        raise HTTPException(
            status_code=400, detail="An account already exists. Sign in instead."
        )
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, user.id)
    return UserOut(username=user.username)


@router.post("/login", response_model=UserOut)
def login(
    payload: AuthCredentialsIn,
    response: Response,
    db: Session = Depends(get_db),
) -> UserOut:
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    set_session_cookie(response, user.id)
    return UserOut(username=user.username)


@router.post("/logout", status_code=204)
def logout(response: Response) -> None:
    clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(require_user)) -> UserOut:
    return UserOut(username=user.username)

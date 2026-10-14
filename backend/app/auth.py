"""Password hashing, signed session cookies, and the login dependency."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from base64 import urlsafe_b64decode, urlsafe_b64encode
from pathlib import Path

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import DEFAULT_DATA_DIR, settings
from .database import get_db
from .models import User, UserRole
from .schemas import UserOut, UserRoleName

COOKIE_NAME = "ee_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 30
PBKDF2_ITERATIONS = 600_000

_generated_secret: str | None = None


def session_secret() -> str:
    """Return the key used to sign session cookies.

    ``EE_SECRET_KEY`` wins when set. Otherwise a generated key is stored next
    to the SQLite file (or held in memory if the directory is not writable).
    """
    global _generated_secret
    if settings.secret_key:
        return settings.secret_key
    if _generated_secret:
        return _generated_secret
    path = _secret_path()
    try:
        if path.exists():
            stored = path.read_text(encoding="utf-8").strip()
            if stored:
                _generated_secret = stored
                return stored
        generated = secrets.token_hex(32)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(generated, encoding="utf-8")
        _generated_secret = generated
        return generated
    except OSError:
        _generated_secret = secrets.token_hex(32)
        return _generated_secret


def _secret_path() -> Path:
    url = settings.database_url
    prefix = "sqlite:///"
    if url.startswith(prefix):
        db_path = Path(url[len(prefix) :])
        if db_path.is_absolute():
            return db_path.parent / ".session_secret"
    return DEFAULT_DATA_DIR / ".session_secret"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _scheme, iterations, salt, digest = stored.split("$", 3)
        check = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(check.hex(), digest)


def sign_session(user_id: int) -> str:
    payload = urlsafe_b64encode(
        json.dumps(
            {"uid": user_id, "exp": int(time.time()) + SESSION_MAX_AGE},
            separators=(",", ":"),
        ).encode("utf-8")
    ).rstrip(b"=")
    signature = hmac.new(
        session_secret().encode("utf-8"), payload, hashlib.sha256
    ).hexdigest()
    return f"{payload.decode('ascii')}.{signature}"


def read_session(token: str) -> int | None:
    try:
        payload, signature = token.rsplit(".", 1)
        expected = hmac.new(
            session_secret().encode("utf-8"),
            payload.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        padded = payload + "=" * (-len(payload) % 4)
        data = json.loads(urlsafe_b64decode(padded))
        if int(data["exp"]) < int(time.time()):
            return None
        return int(data["uid"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        COOKIE_NAME,
        sign_session(user_id),
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
        secure=settings.session_secure,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def user_count(db: Session) -> int:
    return int(db.scalar(select(func.count()).select_from(User)) or 0)


def user_from_request(request: Request, db: Session) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    user_id = read_session(token)
    if user_id is None:
        return None
    return db.get(User, user_id)


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = user_from_request(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user


def user_to_out(user: User) -> UserOut:
    role: UserRoleName = "admin" if user.role == UserRole.ADMIN else "reader"
    return UserOut(id=user.id, username=user.username, role=role)


def admin_count(db: Session) -> int:
    return int(
        db.scalar(select(func.count()).select_from(User).where(User.role == UserRole.ADMIN))
        or 0
    )


def ensure_another_admin(db: Session, user: User) -> None:
    """Block removing or demoting the last admin."""
    if user.role != UserRole.ADMIN:
        return
    if admin_count(db) <= 1:
        raise HTTPException(
            status_code=400, detail="The last admin cannot be removed."
        )

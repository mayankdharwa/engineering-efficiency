"""Login, first-run setup, and the API/docs auth wall."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import User
from tests.auth_helpers import TEST_PASSWORD, TEST_USERNAME, authenticate


def _make_client() -> tuple[TestClient, sessionmaker]:
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
    return TestClient(app), testing_session


def test_health_is_public() -> None:
    client, _sessions = _make_client()
    try:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    finally:
        app.dependency_overrides.clear()


def test_protected_api_and_docs_require_login() -> None:
    client, _sessions = _make_client()
    try:
        status = client.get("/api/auth/status")
        assert status.status_code == 200
        assert status.json() == {
            "authenticated": False,
            "setup_required": True,
            "username": None,
        }

        assert client.get("/api/teams").status_code == 401
        assert client.get("/api/config").status_code == 401
        assert client.get("/api/settings").status_code == 401
        assert client.get("/docs").status_code == 401
        assert client.get("/redoc").status_code == 401
        assert client.get("/openapi.json").status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_setup_creates_account_and_opens_the_app() -> None:
    client, sessions = _make_client()
    try:
        response = client.post(
            "/api/auth/setup",
            json={"username": "Ada", "password": TEST_PASSWORD},
        )
        assert response.status_code == 200
        assert response.json() == {"username": "ada"}

        status = client.get("/api/auth/status")
        assert status.json() == {
            "authenticated": True,
            "setup_required": False,
            "username": "ada",
        }
        assert client.get("/api/auth/me").json() == {"username": "ada"}
        assert client.get("/api/teams").status_code == 200
        assert client.get("/openapi.json").status_code == 200
        assert client.get("/docs").status_code == 200

        rejected = client.post(
            "/api/auth/setup",
            json={"username": "other", "password": TEST_PASSWORD},
        )
        assert rejected.status_code == 400

        with sessions() as db:
            user = db.query(User).one()
            assert user.username == "ada"
            assert user.password_hash != TEST_PASSWORD
            assert user.password_hash.startswith("pbkdf2_sha256$")
    finally:
        app.dependency_overrides.clear()


def test_login_logout_and_bad_password() -> None:
    client, _sessions = _make_client()
    try:
        authenticate(client)
        client.post("/api/auth/logout")
        assert client.get("/api/teams").status_code == 401

        denied = client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "password": "wrong-password"},
        )
        assert denied.status_code == 401

        ok = client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
        )
        assert ok.status_code == 200
        assert client.get("/api/teams").status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_setup_rejects_short_password() -> None:
    client, _sessions = _make_client()
    try:
        response = client.post(
            "/api/auth/setup",
            json={"username": "admin", "password": "short"},
        )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()

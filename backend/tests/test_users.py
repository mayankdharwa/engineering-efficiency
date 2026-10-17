"""App user management and ADMIN / MANAGER / READER access."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from tests.auth_helpers import TEST_PASSWORD, TEST_USERNAME, authenticate

READER_PASSWORD = "reader-password"
MANAGER_PASSWORD = "manager-password"


def _make_client() -> TestClient:
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
    return TestClient(app)


def _login_as_reader(client: TestClient) -> dict:
    return _create_and_login(
        client, username="reader", password=READER_PASSWORD, role="reader"
    )


def _create_and_login(client: TestClient, *, username: str, password: str, role: str) -> dict:
    created = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": role},
    )
    assert created.status_code == 201, created.text
    client.post("/api/auth/logout")
    login = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert login.status_code == 200, login.text
    return created.json()


def test_admin_can_create_list_update_and_delete_users() -> None:
    client = _make_client()
    try:
        authenticate(client)
        created = client.post(
            "/api/users",
            json={"username": "Pat", "password": READER_PASSWORD, "role": "reader"},
        )
        assert created.status_code == 201
        assert created.json()["username"] == "pat"
        assert created.json()["role"] == "reader"
        user_id = created.json()["id"]

        listed = client.get("/api/users")
        assert listed.status_code == 200
        names = {row["username"] for row in listed.json()}
        assert names == {TEST_USERNAME, "pat"}

        promoted = client.patch(f"/api/users/{user_id}", json={"role": "admin"})
        assert promoted.status_code == 200
        assert promoted.json()["role"] == "admin"

        deleted = client.delete(f"/api/users/{user_id}")
        assert deleted.status_code == 204
        remaining = {row["username"] for row in client.get("/api/users").json()}
        assert remaining == {TEST_USERNAME}
    finally:
        app.dependency_overrides.clear()


def test_cannot_delete_self_or_last_admin() -> None:
    client = _make_client()
    try:
        authenticate(client)
        admin_id = client.get("/api/auth/me").json()["id"]
        assert client.delete(f"/api/users/{admin_id}").status_code == 400
        demote = client.patch(f"/api/users/{admin_id}", json={"role": "reader"})
        assert demote.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_reader_cannot_access_settings() -> None:
    client = _make_client()
    try:
        authenticate(client)
        _login_as_reader(client)

        status = client.get("/api/auth/status")
        assert status.json()["role"] == "reader"

        assert client.get("/api/teams").status_code == 200
        assert client.get("/api/settings").status_code == 200
        assert client.get("/api/users").status_code == 403
        assert client.get("/api/config").status_code == 403
        assert client.put(
            "/api/settings",
            json={"timezone": "UTC", "day_cutoff_hour": 19},
        ).status_code == 403
        assert client.post("/api/teams/import").status_code == 403
        assert client.post("/api/teams/1/refresh").status_code == 403
        assert client.post("/api/teams/1/projects/refresh").status_code == 403
        assert client.post(
            "/api/users",
            json={"username": "other", "password": READER_PASSWORD, "role": "reader"},
        ).status_code == 403
    finally:
        app.dependency_overrides.clear()


def test_manager_can_refresh_but_not_access_settings() -> None:
    client = _make_client()
    try:
        authenticate(client)
        _create_and_login(
            client, username="manager", password=MANAGER_PASSWORD, role="manager"
        )

        status = client.get("/api/auth/status")
        assert status.json()["role"] == "manager"

        # Manager is otherwise a reader: no settings, no user management.
        assert client.get("/api/users").status_code == 403
        assert client.get("/api/config").status_code == 403
        assert client.post("/api/teams/import").status_code == 403

        # Refreshes pass the permission gate. There is no team/Linear config
        # here, so they fail with 400/404 — never 403.
        assert client.post("/api/teams/1/refresh").status_code != 403
        assert client.post("/api/teams/1/projects/refresh").status_code != 403
    finally:
        app.dependency_overrides.clear()


def test_manager_role_round_trips_through_user_api() -> None:
    client = _make_client()
    try:
        authenticate(client)
        created = _create_and_login(
            client, username="mgr", password=MANAGER_PASSWORD, role="manager"
        )
        assert created["role"] == "manager"

        # Log back in as the admin to demote the manager to reader.
        client.post("/api/auth/logout")
        client.post(
            "/api/auth/login",
            json={"username": TEST_USERNAME, "password": TEST_PASSWORD},
        )
        updated = client.patch(f"/api/users/{created['id']}", json={"role": "reader"})
        assert updated.status_code == 200
        assert updated.json()["role"] == "reader"
    finally:
        app.dependency_overrides.clear()


def test_duplicate_username_is_rejected() -> None:
    client = _make_client()
    try:
        authenticate(client)
        response = client.post(
            "/api/users",
            json={"username": TEST_USERNAME, "password": READER_PASSWORD, "role": "reader"},
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.clear()

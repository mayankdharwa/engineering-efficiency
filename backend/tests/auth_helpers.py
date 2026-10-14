"""Shared TestClient helpers that satisfy the login wall."""

from __future__ import annotations

from fastapi.testclient import TestClient

TEST_USERNAME = "admin"
TEST_PASSWORD = "test-password"


def authenticate(client: TestClient) -> TestClient:
    """Create the first account (or sign in) so API tests can call protected routes."""
    status = client.get("/api/auth/status")
    assert status.status_code == 200
    body = status.json()
    payload = {"username": TEST_USERNAME, "password": TEST_PASSWORD}
    if body.get("setup_required"):
        response = client.post("/api/auth/setup", json=payload)
    else:
        response = client.post("/api/auth/login", json=payload)
    assert response.status_code == 200, response.text
    return client

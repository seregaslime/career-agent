import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_liveness_does_not_call_database() -> None:
    def fail() -> None:
        raise AssertionError("Liveness must not access database")

    with TestClient(create_app(database_probe=fail)) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_checks_database() -> None:
    calls = []
    with TestClient(create_app(database_probe=lambda: calls.append(True))) as client:
        response = client.get("/api/ready")
    assert calls == [True]
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ready"}


def test_readiness_failure_is_sanitized() -> None:
    def fail() -> None:
        raise RuntimeError("postgresql://secret-password@private-host")

    with TestClient(create_app(database_probe=fail)) as client:
        response = client.get("/api/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unavailable"}
    assert "secret" not in response.text


@pytest.mark.parametrize(
    "origin,allowed", [("http://localhost:5173", True), ("https://unknown.example", False)]
)
def test_cors_allows_only_configured_frontend(origin: str, allowed: bool) -> None:
    with TestClient(create_app(Settings(), database_probe=lambda: None)) as client:
        response = client.get("/api/health", headers={"Origin": origin})
    assert (response.headers.get("access-control-allow-origin") == origin) is allowed

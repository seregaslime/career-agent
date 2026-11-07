import os
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import AuthLimiter, Credentials
from app.config import Settings
from app.db import make_engine
from app.main import create_app
from app.models import LoginSession, User
from app.security import hash_password, token_hash, verify_password


def test_password_hashing() -> None:
    first = hash_password("example-password-123")
    assert first != hash_password("example-password-123")
    assert verify_password("example-password-123", first)
    assert not verify_password("wrong-password-123", first)
    assert not verify_password("anything", "invalid")


def test_auth_attempts_are_limited() -> None:
    limiter = AuthLimiter()
    for _ in range(10):
        limiter.check("test")
    with pytest.raises(HTTPException) as exc:
        limiter.check("test")
    assert exc.value.status_code == 429


def test_cross_origin_mutations_rejected() -> None:
    with TestClient(create_app(database_probe=lambda: None)) as client:
        response = client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


@pytest.mark.integration
def test_accounts_profile_isolation_and_session_lifecycle() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires dedicated TEST_DATABASE_URL")
    import subprocess
    import sys

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    settings = Settings(database_url=SecretStr(url))
    app = create_app(settings)
    a_email = f"a-{uuid4()}@example.com"
    b_email = f"b-{uuid4()}@example.com"
    password = "Syn!8pwd"
    with (
        TestClient(app, base_url="https://testserver") as a,
        TestClient(app, base_url="https://testserver") as b,
    ):
        assert a.get("/api/profile").status_code == 401
        created = a.post("/api/auth/register", json={"email": a_email, "password": password})
        assert created.status_code == 201, created.text
        assert "password" not in created.text
        cookie = created.headers["set-cookie"].lower()
        assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie
        original_token = a.cookies.get("career_session")
        assert (
            a.post(
                "/api/auth/register", json={"email": a_email.upper(), "password": password}
            ).status_code
            == 409
        )
        assert (
            a.patch(
                "/api/profile", json={"full_name": "Синтетический студент", "target_role": "Python"}
            ).status_code
            == 200
        )
        assert (
            b.post("/api/auth/register", json={"email": b_email, "password": password}).status_code
            == 201
        )
        assert b.get("/api/profile").json()["full_name"] == ""
        assert b.patch("/api/profile", json={"user_id": created.json()["id"]}).status_code == 422
        assert b.get("/api/profile/" + created.json()["id"]).status_code == 404
        assert a.post("/api/auth/logout").status_code == 204
        assert a.get("/api/auth/me").status_code == 401
        a.cookies.set("career_session", original_token)
        assert a.get("/api/auth/me").status_code == 401
        a.cookies.clear()
        assert (
            a.post(
                "/api/auth/login", json={"email": a_email, "password": "incorrect-password"}
            ).status_code
            == 401
        )
        assert (
            a.post("/api/auth/login", json={"email": a_email, "password": password}).status_code
            == 200
        )
        assert a.get("/api/profile").json()["full_name"] == "Синтетический студент"
        raw = a.cookies.get("career_session")
        engine = make_engine(settings)
        try:
            with Session(engine) as session:
                user = session.scalar(select(User).where(User.email == a_email))
                assert user is not None and user.password_hash != password
                record = session.get(LoginSession, token_hash(raw))
                assert record is not None and record.token_hash != raw
                record.expires_at = datetime.now(UTC) - timedelta(minutes=1)
                session.commit()
            assert a.get("/api/auth/me").status_code == 401
        finally:
            engine.dispose()


@pytest.mark.parametrize("length,accepted", [(7, False), (8, True), (128, True), (129, False)])
def test_password_length_boundaries(length: int, accepted: bool) -> None:
    data = {"email": "synthetic@example.com", "password": "x" * length}
    if accepted:
        assert len(Credentials(**data).password) == length
    else:
        with pytest.raises(ValidationError):
            Credentials(**data)

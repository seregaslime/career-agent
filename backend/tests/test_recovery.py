import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.main import create_app
from app.models import RecoveryCode, User
from app.security import token_hash


@pytest.mark.integration
def test_recovery_codes_lifecycle() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires disposable PostgreSQL")
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    app = create_app(Settings(database_url=SecretStr(url)))
    email = f"recovery-{uuid4()}@example.com"
    password = "synthetic-password"
    with TestClient(app, base_url="https://testserver") as client:
        result = client.post("/api/auth/register", json={"email": email, "password": password})
        assert result.status_code == 201
        codes = result.json()["recovery_codes"]
        uid = result.json()["id"]
        assert len(codes) == len(set(codes)) == 8
        assert result.headers["cache-control"] == "no-store"
        assert "recovery_codes" not in client.get("/api/auth/me").json()
        with Session(app.state.engine) as session:
            stored = session.scalars(select(RecoveryCode).where(RecoveryCode.user_id == uid)).all()
            assert len(stored) == 8
            assert {r.code_hash for r in stored} == {token_hash(c.replace("-", "")) for c in codes}
        assert (
            client.post("/api/auth/recovery-codes", json={"password": "incorrect"}).status_code
            == 401
        )
        fresh = client.post("/api/auth/recovery-codes", json={"password": password})
        assert fresh.status_code == 200
        new_codes = fresh.json()["recovery_codes"]
        payload = {"email": email, "password": "new-synthetic-password", "code": codes[0]}
        assert client.post("/api/auth/recover", json=payload).status_code == 400
        payload["code"] = new_codes[0].lower()
        assert (
            client.post(
                "/api/auth/recover", json={**payload, "email": "unknown@example.com"}
            ).status_code
            == 400
        )
        assert (
            client.post("/api/auth/recover", json={**payload, "password": "short"}).status_code
            == 422
        )
        assert (
            client.post(
                "/api/auth/recover", json=payload, headers={"Origin": "https://evil.example"}
            ).status_code
            == 403
        )

        # Parallel use of one code: exactly one password reset succeeds.
        def reset() -> int:
            with TestClient(app, base_url="https://testserver") as other:
                return other.post("/api/auth/recover", json=payload).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(lambda _: reset(), range(2))) == [204, 400]
        assert client.get("/api/auth/me").status_code == 401
        app.state.auth_limiter.events.clear()
        assert (
            client.post("/api/auth/login", json={"email": email, "password": password}).status_code
            == 401
        )
        assert (
            client.post(
                "/api/auth/login", json={"email": email, "password": payload["password"]}
            ).status_code
            == 200
        )
        with Session(app.state.engine) as session:
            user = session.get(User, uid)
            assert user is not None
            user.is_blocked = True
            session.commit()
        assert (
            client.post("/api/auth/recover", json={**payload, "code": new_codes[1]}).status_code
            == 400
        )
        # Recovery does not bypass moderation and does not expose roles/codes.
        with Session(app.state.engine) as session:
            assert session.get(RecoveryCode, token_hash(new_codes[1].replace("-", ""))) is not None

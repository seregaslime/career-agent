import os
import subprocess
import sys
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.main import create_app


@pytest.mark.integration
def test_admin_permissions_blocking_and_audit() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires disposable TEST_DATABASE_URL")
    env = {**os.environ, "DATABASE_URL": url}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=True)
    app = create_app(Settings(database_url=SecretStr(url)))
    password = "synthetic-admin-test-password"
    email = f"admin-{uuid4()}@example.com"
    member_email = f"member-{uuid4()}@example.com"
    with (
        TestClient(app, base_url="https://testserver") as admin,
        TestClient(app, base_url="https://testserver") as member,
        TestClient(app, base_url="https://testserver") as anonymous,
    ):
        assert anonymous.get("/api/admin/users").status_code == 401
        for client, address in [(admin, email), (member, member_email)]:
            result = client.post(
                "/api/auth/register", json={"email": address, "password": password}
            )
            assert result.status_code == 201, result.text
            assert result.json()["is_admin"] is False
        admin_id = admin.get("/api/auth/me").json()["id"]
        member_id = member.get("/api/auth/me").json()["id"]
        assert member.get("/api/admin/users").status_code == 403
        assert member.get(f"/api/admin/users/{admin_id}").status_code == 403
        assert member.get("/api/admin/events").status_code == 403
        assert (
            member.patch(
                f"/api/admin/users/{admin_id}/block", json={"blocked": True, "reason": "test"}
            ).status_code
            == 403
        )
        assert member.patch("/api/profile", json={"is_admin": True}).status_code == 422
        assert (
            member.post(
                "/api/auth/register",
                json={"email": "escalation@example.com", "password": password, "is_admin": True},
            ).status_code
            == 422
        )
        subprocess.run(
            [sys.executable, "-m", "app.manage_admin", "--email", email], env=env, check=True
        )
        assert admin.get("/api/auth/me").status_code == 401
        assert (
            admin.post("/api/auth/login", json={"email": email, "password": password}).status_code
            == 200
        )
        assert admin.get("/api/auth/me").json()["is_admin"] is True
        result = admin.get("/api/admin/users", params={"q": member_email})
        assert result.status_code == 200
        assert result.json()["total"] == 1
        assert result.json()["items"][0]["id"] == member_id
        assert "password_hash" not in result.text and "token_hash" not in result.text
        assert result.headers["cache-control"] == "no-store"
        assert admin.get("/api/admin/users", params={"q": "%"}).json()["total"] == 0
        assert admin.get("/api/admin/users?limit=0").status_code == 422
        detail = admin.get(f"/api/admin/users/{member_id}").json()
        assert detail["active_sessions"] == 1
        assert admin.get("/api/admin/users/missing").status_code == 404
        assert (
            admin.patch(
                f"/api/admin/users/{admin_id}/block", json={"blocked": True, "reason": "test"}
            ).status_code
            == 409
        )
        assert (
            admin.patch(
                f"/api/admin/users/{member_id}/block", json={"blocked": True, "reason": "   "}
            ).status_code
            == 422
        )
        changed = admin.patch(
            f"/api/admin/users/{member_id}/block",
            json={"blocked": True, "reason": "Synthetic moderation test"},
        )
        assert changed.status_code == 200 and changed.json()["is_blocked"]
        assert member.get("/api/profile").status_code == 401
        assert (
            member.post(
                "/api/auth/login", json={"email": member_email, "password": password}
            ).status_code
            == 401
        )
        assert admin.get(f"/api/admin/users/{member_id}").json()["active_sessions"] == 0
        assert (
            admin.patch(
                f"/api/admin/users/{member_id}/block",
                json={"blocked": False, "reason": "Synthetic unblock test"},
            ).status_code
            == 200
        )
        assert member.get("/api/profile").status_code == 401  # old sessions never resurrect
        assert (
            member.post(
                "/api/auth/login", json={"email": member_email, "password": password}
            ).status_code
            == 200
        )
        records = [
            event
            for event in admin.get("/api/admin/events").json()
            if event["target_id"] == member_id
        ]
        assert [record["action"] for record in records] == ["unblock", "block"]
        assert all(record["actor_id"] == admin_id for record in records)
        assert member.get("/api/admin/users").status_code == 403


@pytest.mark.integration
def test_super_admin_delegation_and_protection() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires disposable TEST_DATABASE_URL")
    env = {**os.environ, "DATABASE_URL": url}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=True)
    app = create_app(Settings(database_url=SecretStr(url)))
    password = "synthetic-super-admin-password"
    with (
        TestClient(app, base_url="https://testserver") as owner,
        TestClient(app, base_url="https://testserver") as delegate,
        TestClient(app, base_url="https://testserver") as member,
        TestClient(app, base_url="https://testserver") as anonymous,
    ):
        clients = [owner, delegate, member]
        addresses = [f"super-{uuid4()}@example.com" for _ in clients]
        ids = []
        for client, address in zip(clients, addresses, strict=True):
            result = client.post(
                "/api/auth/register", json={"email": address, "password": password}
            )
            assert result.status_code == 201
            assert result.json()["is_super_admin"] is False
            ids.append(result.json()["id"])
        owner_id, delegate_id, member_id = ids
        endpoint = f"/api/admin/users/{delegate_id}/role"
        body = {"is_admin": True, "reason": "Synthetic delegation"}
        assert anonymous.patch(endpoint, json=body).status_code == 401
        assert member.patch(endpoint, json=body).status_code == 403
        assert member.patch("/api/profile", json={"is_super_admin": True}).status_code == 422
        assert (
            member.post(
                "/api/auth/register",
                json={"email": "raise@example.com", "password": password, "is_super_admin": True},
            ).status_code
            == 422
        )
        subprocess.run(
            [sys.executable, "-m", "app.manage_admin", "--email", addresses[0], "--super-admin"],
            env=env,
            check=True,
        )
        assert owner.get("/api/auth/me").status_code == 401
        result = owner.post("/api/auth/login", json={"email": addresses[0], "password": password})
        assert result.json()["is_super_admin"] is True
        # The invariant also holds for writes outside the HTTP layer.
        for assignment in ["is_blocked = true", "is_admin = false"]:
            with pytest.raises(IntegrityError), app.state.engine.begin() as connection:
                connection.execute(
                    text(f"UPDATE users SET {assignment} WHERE id = :id"), {"id": owner_id}
                )
        assert owner.patch(endpoint, json=body).status_code == 200
        assert delegate.get("/api/auth/me").status_code == 401
        assert (
            delegate.post(
                "/api/auth/login", json={"email": addresses[1], "password": password}
            ).json()["is_admin"]
            is True
        )
        # A delegate has all moderation capabilities, but cannot manage roles or the owner.
        assert delegate.get("/api/admin/users").status_code == 200
        assert delegate.get("/api/admin/events").status_code == 200
        assert delegate.patch(f"/api/admin/users/{member_id}/role", json=body).status_code == 403
        assert (
            delegate.patch(
                f"/api/admin/users/{owner_id}/role", json={"is_admin": False, "reason": "test"}
            ).status_code
            == 403
        )
        for client in [owner, delegate]:
            assert (
                client.patch(
                    f"/api/admin/users/{owner_id}/block", json={"blocked": True, "reason": "test"}
                ).status_code
                == 409
            )
        assert (
            owner.patch(
                f"/api/admin/users/{owner_id}/role", json={"is_admin": False, "reason": "test"}
            ).status_code
            == 409
        )
        assert owner.patch(endpoint, json={**body, "reason": "   "}).status_code == 422
        assert owner.patch(endpoint, json={**body, "is_super_admin": True}).status_code == 422
        assert owner.patch("/api/admin/users/missing/role", json=body).status_code == 404
        # Delegates can moderate members, and the owner can block an ordinary admin.
        assert (
            delegate.patch(
                f"/api/admin/users/{member_id}/block", json={"blocked": True, "reason": "test"}
            ).status_code
            == 200
        )
        assert owner.patch(f"/api/admin/users/{member_id}/role", json=body).status_code == 409
        assert (
            owner.patch(
                f"/api/admin/users/{delegate_id}/block", json={"blocked": True, "reason": "test"}
            ).status_code
            == 200
        )
        assert delegate.get("/api/admin/users").status_code == 401
        assert (
            owner.patch(
                f"/api/admin/users/{delegate_id}/block", json={"blocked": False, "reason": "test"}
            ).status_code
            == 200
        )
        assert (
            delegate.post(
                "/api/auth/login", json={"email": addresses[1], "password": password}
            ).status_code
            == 200
        )
        assert (
            owner.patch(
                endpoint, json={"is_admin": False, "reason": "Synthetic revocation"}
            ).status_code
            == 200
        )
        assert delegate.get("/api/admin/users").status_code == 401
        assert (
            delegate.post(
                "/api/auth/login", json={"email": addresses[1], "password": password}
            ).status_code
            == 200
        )
        assert delegate.get("/api/admin/users").status_code == 403
        # Repeating the same role operation must not duplicate audit records.
        assert (
            owner.patch(endpoint, json={"is_admin": False, "reason": "No operation"}).status_code
            == 200
        )
        events = [
            e
            for e in owner.get("/api/admin/events").json()
            if e["target_id"] == delegate_id and e["action"] in ["grant_admin", "revoke_admin"]
        ]
        assert [e["action"] for e in events] == ["revoke_admin", "grant_admin"]
        assert all(e["actor_id"] == owner_id for e in events)

import os
import subprocess
import sys
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app


@pytest.mark.integration
def test_owned_chat_turns_and_retry() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires disposable PostgreSQL")
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env={**os.environ, "DATABASE_URL": url},
        check=True,
    )
    app = create_app(Settings(database_url=SecretStr(url)))
    with (
        TestClient(app, base_url="https://testserver") as a,
        TestClient(app, base_url="https://testserver") as b,
    ):
        assert a.get("/api/chat").status_code == 401
        for client in [a, b]:
            assert (
                client.post(
                    "/api/auth/register",
                    json={"email": f"chat-{uuid4()}@example.com", "password": "synthetic-password"},
                ).status_code
                == 201
            )
        data = {"id": str(uuid4()), "prompt": "Учусь в вузе, сделал бота на Python"}
        first = a.post("/api/chat", json=data)
        assert first.status_code == 200 and first.json()["reply"] is None
        assert first.headers["cache-control"] == "no-store"
        assert a.post("/api/chat", json=data).json()["id"] == data["id"]
        assert a.post("/api/chat", json={**data, "prompt": "changed"}).status_code == 409
        assert a.post("/api/chat", json={**data, "id": str(uuid4())}).status_code == 409
        assert b.get("/api/chat").json() == []
        assert b.post("/api/chat", json=data).status_code == 404
        path = "/api/chat/" + data["id"]
        assert b.patch(path, json={"reply": "forged"}).status_code == 404
        assert (
            a.patch(path, json={"reply": "Какие задачи решал бот?", "is_admin": True}).status_code
            == 422
        )
        reply = {"reply": "Какие задачи решал бот?"}
        assert a.patch(path, json=reply).status_code == 200
        assert a.patch(path, json=reply).status_code == 200
        assert a.patch(path, json={"reply": "different"}).status_code == 409
        rows = a.get("/api/chat").json()
        assert len(rows) == 1 and rows[0]["reply"] == reply["reply"]
        assert a.get("/api/profile").json()["about"] == ""
        assert a.post("/api/chat", json={"id": str(uuid4()), "prompt": " "}).status_code == 422

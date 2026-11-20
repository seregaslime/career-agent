import os
import subprocess
import sys
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app

MESSAGE = "Учусь в МГТУ на программной инженерии. Сделал Telegram-бота на Python и aiogram."


def skill(name: str, evidence: str) -> dict[str, object]:
    return {"kind": "skill", "evidence": evidence, "data": {"name": name}}


@pytest.mark.integration
def test_grounded_interview_facts_go_straight_to_the_editable_profile() -> None:
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
        assert a.get("/api/profile/items").status_code == 401
        for client in [a, b]:
            email = f"facts-{uuid4()}@example.com"
            response = client.post(
                "/api/auth/register", json={"email": email, "password": "synthetic-password"}
            )
            assert response.status_code == 201
        turn = {"id": str(uuid4()), "prompt": MESSAGE}
        assert a.post("/api/chat", json=turn).status_code == 200
        assert a.get("/api/chat").json()[0]["facts_checked"] is False

        facts = [
            skill("Python", "бота на Python"),
            skill("Docker", "работал с Docker"),  # not said by the user
            skill("python", "на Python"),  # duplicate inside one batch
            {
                "kind": "project",
                "evidence": "Сделал Telegram-бота",
                "data": {"title": "Telegram-бот", "technologies": ["Python", "aiogram"]},
            },
            {
                "kind": "education",
                "evidence": "Учусь в МГТУ на программной инженерии",
                "data": {"institution": "МГТУ", "program": "Программная инженерия"},
            },
        ]
        body = {"turn_id": turn["id"], "facts": facts}
        assert b.post("/api/profile/items/extracted", json=body).status_code == 404
        forged = {**body, "facts": [{**facts[0], "status": "confirmed"}]}
        assert a.post("/api/profile/items/extracted", json=forged).status_code == 422
        result = a.post("/api/profile/items/extracted", json=body)
        assert result.status_code == 200
        assert result.headers["cache-control"] == "no-store"
        saved = result.json()
        assert [item["kind"] for item in saved["items"]] == ["skill", "project", "education"]
        assert {item["status"] for item in saved["items"]} == {"confirmed"}
        assert {item["source"] for item in saved["items"]} == {"interview"}
        assert saved["skipped"] == [
            {"index": 1, "reason": "evidence"},
            {"index": 2, "reason": "duplicate"},
        ]
        assert a.get("/api/chat").json()[0]["facts_checked"] is True
        again = a.post("/api/profile/items/extracted", json=body).json()
        assert again["already_processed"] is True
        assert [i["id"] for i in again["items"]] == [i["id"] for i in saved["items"]]
        assert len(a.get("/api/profile/items").json()) == 3

        python, project, education = (item["id"] for item in saved["items"])
        assert b.get("/api/profile/items").json() == []
        assert b.patch(f"/api/profile/items/{python}", json={"data": {}}).status_code == 404
        assert b.delete(f"/api/profile/items/{python}").status_code == 404
        # The old review endpoints are gone: interview facts need no confirmation.
        assert a.post(f"/api/profile/items/{python}/confirm", json={}).status_code in (404, 405)
        assert a.post(f"/api/profile/items/{python}/reject").status_code in (404, 405)
        bad = {"data": {"name": "Python", "is_admin": True}}
        assert a.patch(f"/api/profile/items/{python}", json=bad).status_code == 422
        edited = a.patch(
            f"/api/profile/items/{python}",
            json={"data": {"name": "Python", "level": "intermediate"}},
        )
        assert edited.status_code == 200
        assert edited.json()["status"] == "confirmed"
        assert edited.json()["data"]["level"] == "intermediate"
        assert edited.json()["evidence"] == "бота на Python"
        assert a.delete(f"/api/profile/items/{project}").status_code == 204

        assert (
            a.post("/api/profile/items", json={"kind": "skill", "data": {"name": " python "}})
        ).status_code == 409
        manual = a.post("/api/profile/items", json={"kind": "skill", "data": {"name": "SQL"}})
        assert manual.status_code == 201
        assert manual.json()["status"] == "confirmed" and manual.json()["source"] == "manual"
        sql = manual.json()["id"]
        rename = {"data": {"name": "Python"}}
        assert a.patch(f"/api/profile/items/{sql}", json=rename).status_code == 409
        level = {"data": {"name": "SQL", "level": "beginner"}}
        assert a.patch(f"/api/profile/items/{sql}", json=level).json()["data"]["level"] == (
            "beginner"
        )
        assert a.patch(f"/api/profile/items/{sql}", json={"data": {}}).status_code == 422
        unknown = {"kind": "hobby", "data": {"name": "x"}}
        assert a.post("/api/profile/items", json=unknown).status_code == 422
        assert a.delete(f"/api/profile/items/{sql}").status_code == 204
        assert a.delete(f"/api/profile/items/{sql}").status_code == 404

        statuses = {i["id"]: i["status"] for i in a.get("/api/profile/items").json()}
        assert statuses == {python: "confirmed", education: "confirmed"}
        confirmed_only = a.get("/api/profile/items?status=confirmed").json()
        assert [item["id"] for item in confirmed_only] == [python, education]
        assert a.get("/api/profile/items?status=suggested").json() == []

        profile = a.patch("/api/profile", json={"work_format": "remote", "location": "Москва"})
        assert profile.status_code == 200
        assert profile.json()["work_format"] == "remote"
        assert a.patch("/api/profile", json={"work_format": "space"}).status_code == 422
        assert a.get("/api/profile").json()["location"] == "Москва"

        other = {"id": str(uuid4()), "prompt": "Пока не знаю, чем хочу заниматься"}
        reply = {"reply": "Что умеет бот?"}
        assert a.patch(f"/api/chat/{turn['id']}", json=reply).status_code == 200
        assert a.post("/api/chat", json=other).status_code == 200
        empty = a.post("/api/profile/items/extracted", json={"turn_id": other["id"], "facts": []})
        assert empty.json() == {"items": [], "skipped": [], "already_processed": False}
        too_many = {"turn_id": other["id"], "facts": [skill("Python", "x y")] * 11}
        assert a.post("/api/profile/items/extracted", json=too_many).status_code == 422

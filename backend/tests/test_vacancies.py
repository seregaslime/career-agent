from typing import Any
from urllib.error import HTTPError

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import vacancies
from app.config import Settings
from app.main import create_app


def client(enabled: bool = False) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                hh_access_token=SecretStr("synthetic-token" if enabled else ""),
                hh_user_agent="SyntheticTest/1" if enabled else "",
            ),
            database_probe=lambda: None,
        )
    )


def sample() -> dict[str, Any]:
    return {
        "id": "123",
        "name": "<b>Python</b> intern",
        "employer": {"name": "Synthetic"},
        "area": {"name": "Москва"},
        "experience": {"id": "noExperience", "name": "Без опыта"},
        "work_format": [{"id": "REMOTE"}],
        "salary_range": {
            "from": 50000,
            "to": None,
            "currency": "RUR",
            "gross": False,
            "frequency": {"name": "За месяц"},
        },
        "key_skills": [{"name": "Python"}],
        "description": "<p>Тестовая задача</p>",
        "published_at": "2026-11-20T12:00:00+03:00",
        "alternate_url": "javascript:alert(1)",
    }


def test_demo_filters_details_and_repeated_reads() -> None:
    with client() as api:
        data = api.get("/api/vacancies").json()
        assert data["source"] == "demo" and data["found"] == 6
        assert data["hh_available"] is False
        assert all(row["source_url"] is None for row in data["items"])
        params = {"q": "python", "experience": "noExperience", "work_format": "REMOTE"}
        first = api.get("/api/vacancies", params=params).json()
        assert len(first["items"]) == 2
        assert api.get("/api/vacancies", params=params).json()["items"] == first["items"]
        assert api.get("/api/vacancies/demo/1").json()["skills"] == ["Python", "PostgreSQL", "Git"]
        assert api.get("/api/vacancies/demo/999").status_code == 404
        assert api.get("/api/vacancies/demo/not-numeric").status_code == 404
        assert api.get("/api/vacancies", params={"q": "does-not-exist"}).json()["found"] == 0
        assert api.get("/api/vacancies", params={"page": -1}).status_code == 422
        assert api.get("/api/vacancies", params={"source": "arbitrary-url"}).status_code == 422
        assert api.get("/api/vacancies", params={"experience": "invalid"}).status_code == 422
        assert api.get("/api/vacancies", params={"q": "x" * 121}).status_code == 422
        failure = api.get("/api/vacancies", params={"source": "hh"})
        assert failure.status_code == 503 and "ещё не подключён" in failure.json()["detail"]


def test_hh_normalization_dedup_and_bounded_query(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    def read(request: Any, path: str, params: dict[str, Any]) -> dict[str, Any]:
        calls.append((path, params))
        return {"items": [sample(), sample()], "found": 1, "pages": 1} if not path else sample()

    monkeypatch.setattr(vacancies, "read_hh", read)
    with client(True) as api:
        data = api.get(
            "/api/vacancies", params={"source": "hh", "q": "Python", "work_format": "REMOTE"}
        ).json()
        assert len(data["items"]) == 1 and data["hh_available"] is True
        row = data["items"][0]
        assert row["title"] == "Python intern" and row["salary"]["gross"] is False
        assert row["source_url"] == "https://hh.ru/vacancy/123"
        assert row["description"] == "Тестовая задача"
        assert calls[0][1] == {"page": 0, "per_page": 20, "text": "Python", "work_format": "REMOTE"}
        assert api.get("/api/vacancies/hh/123").json()["skills"] == ["Python"]
        assert api.get("/api/vacancies/hh/not-a-number").status_code == 404
        assert len(calls) == 2


def test_invalid_upstream_does_not_become_demo_or_server_trace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(vacancies, "read_hh", lambda *args: {"items": "invalid"})
    with client(True) as api:
        response = api.get("/api/vacancies", params={"source": "hh"})
        assert response.status_code == 502 and "формат" in response.json()["detail"]
        assert "synthetic-token" not in response.text


@pytest.mark.parametrize("status", [403, 429, 404])
def test_upstream_errors_do_not_expose_secrets(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    class FailingOpener:
        def open(self, request: Any, timeout: int) -> None:
            assert request.full_url.startswith("https://api.hh.ru/vacancies")
            assert timeout == 8
            raise HTTPError(request.full_url, status, "private provider error", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr(vacancies, "build_opener", lambda *args: FailingOpener())
    with client(True) as api:
        response = api.get("/api/vacancies/hh/123")
        assert response.status_code == (404 if status == 404 else 503)
        assert "private provider error" not in response.text
        assert "synthetic-token" not in response.text


def test_hh_rate_limit_and_no_demo_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: Any) -> Any:
        raise AssertionError("Demo must not request HH")

    monkeypatch.setattr(vacancies, "build_opener", forbidden)
    with client(True) as api:
        assert api.get("/api/vacancies").status_code == 200
        for _ in range(10):
            api.app.state.vacancy_limiter.check("vacancies:testclient")  # type: ignore[union-attr]
        assert api.get("/api/vacancies", params={"source": "hh"}).status_code == 429

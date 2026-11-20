from typing import Any
from urllib.error import HTTPError

import pytest
from fastapi.testclient import TestClient

from app import vacancies
from app.main import create_app


def client() -> TestClient:
    return TestClient(create_app(database_probe=lambda: None))


def sample() -> dict[str, Any]:
    return {
        "id": "abc-def",
        "job-name": "<b>Python</b> intern",
        "company": {"companycode": "12345", "name": "Synthetic", "email": "private@example.com"},
        "region": {"name": "Тестовый регион"},
        "requirement": {"experience": 0},
        "employment": "Дистанционная (удаленная) работа",
        "salary_min": 50000,
        "salary_max": 0,
        "currency": "руб.",
        "skills": ["Python", "Python"],
        "duty": "<p>Тестовая задача</p>",
        "creation-date": "2026-11-20",
        "vac_url": "javascript:alert(1)",
    }


def payload(rows: list[dict[str, Any]], total: int = 1) -> dict[str, Any]:
    return {
        "status": "200",
        "meta": {"total": total},
        "results": {"vacancies": [{"vacancy": row} for row in rows]},
    }


def test_demo_filters_details_and_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: Any) -> Any:
        raise AssertionError("Demo must not request the source")

    monkeypatch.setattr(vacancies, "build_opener", forbidden)
    with client() as api:
        data = api.get("/api/vacancies", params={"source": "demo"}).json()
        assert data["source"] == "demo" and data["found"] == 6
        assert all(row["source_url"] is None for row in data["items"])
        params = {
            "source": "demo",
            "q": "python",
            "experience": "noExperience",
            "work_format": "REMOTE",
        }
        first = api.get("/api/vacancies", params=params).json()
        assert len(first["items"]) == 2 and not first["filtered_on_page"]
        assert api.get("/api/vacancies", params=params).json()["items"] == first["items"]
        assert api.get("/api/vacancies/demo/1").status_code == 200
        assert api.get("/api/vacancies/demo/999").status_code == 404
        assert api.get("/api/vacancies/trudvsem/invalid").status_code == 404
        for params in [{"page": -1}, {"source": "hh"}, {"experience": "invalid"}, {"q": "x" * 121}]:
            assert api.get("/api/vacancies", params=params).status_code == 422


def test_open_data_normalization_cache_filters_and_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    def read(request: Any, path: str, params: dict[str, Any]) -> dict[str, Any]:
        calls.append((path, params))
        return payload([sample(), sample()], 45 if not path else 1)

    monkeypatch.setattr(vacancies, "read_source", read)
    with client() as api:
        params = {"q": "Python", "work_format": "REMOTE", "experience": "noExperience", "page": 1}
        data = api.get("/api/vacancies", params=params).json()
        assert len(data["items"]) == 1 and data["filtered_on_page"]
        assert data["found"] == 45 and data["pages"] == 3
        row = data["items"][0]
        assert row["title"] == "Python intern" and row["skills"] == ["Python"]
        assert row["salary"]["gross"] is None and row["salary"]["maximum"] is None
        assert row["source_url"] == "https://trudvsem.ru/vacancy/card/12345/abc-def"
        assert row["description"].startswith("Тестовая задача\nЗанятость:")
        assert "<p>" not in row["description"]
        assert calls[0][1] == {"offset": 1, "limit": 20, "text": "Python"}
        assert "private@example.com" not in str(data)
        assert api.get("/api/vacancies", params=params).json()["fetched_at"] == data["fetched_at"]
        assert len(calls) == 1
        assert api.get("/api/vacancies/trudvsem/12345~abc-def").json()["id"] == row["id"]
        assert len(calls) == 2
        unknown = sample()
        unknown.pop("requirement")
        unknown["employment"] = "Полная занятость"
        normalized = vacancies.normalize(unknown)
        assert normalized.experience == "" and normalized.work_formats == []


def test_invalid_upstream_is_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vacancies, "read_source", lambda *args: {"results": {"vacancies": "bad"}})
    with client() as api:
        response = api.get("/api/vacancies")
        assert response.status_code == 502 and "формат" in response.json()["detail"]


@pytest.mark.parametrize("status", [403, 429, 404])
def test_source_errors_are_sanitized(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    class FailingOpener:
        def open(self, request: Any, timeout: int) -> None:
            assert request.full_url.startswith("https://opendata.trudvsem.ru/api/v1/vacancies")
            assert request.get_header("Authorization") is None
            assert timeout == 15
            raise HTTPError(request.full_url, status, "private provider error", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr(vacancies, "build_opener", lambda *args: FailingOpener())
    with client() as api:
        response = api.get("/api/vacancies/trudvsem/12345~abc-def")
        assert response.status_code == (404 if status == 404 else 503)
        assert "private provider error" not in response.text


def test_source_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden(*args: Any) -> Any:
        raise AssertionError("Limited request must not reach source")

    monkeypatch.setattr(vacancies, "build_opener", forbidden)
    with client() as api:
        for _ in range(10):
            api.app.state.vacancy_limiter.check("vacancies:testclient")  # type: ignore[union-attr]
        assert api.get("/api/vacancies").status_code == 429


def test_cache_expiry_and_bound(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [100.0]
    monkeypatch.setattr(vacancies, "monotonic", lambda: clock[0])
    cache = vacancies.SourceCache()
    entry = vacancies.SourcePage([], 0, vacancies.datetime.now(vacancies.UTC), 400)
    for i in range(20):
        cache.put(str(i), entry)
    assert len(cache.entries) == 16 and cache.get("19") is entry
    clock[0] = 401
    assert cache.get("19") is None

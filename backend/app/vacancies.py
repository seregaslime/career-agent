"""Independent vacancy catalog: synthetic demo and an explicitly configured HH adapter."""

import json
import re
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Annotated, Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, build_opener
from urllib.request import Request as URLRequest

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

Source = Literal["demo", "hh"]
Experience = Literal["", "noExperience", "between1And3", "between3And6", "moreThan6"]
Format = Literal["", "REMOTE", "HYBRID", "ON_SITE"]
router = APIRouter(prefix="/api/vacancies", tags=["vacancies"])


class Salary(BaseModel):
    minimum: float | None = Field(default=None, ge=0, le=1e12)
    maximum: float | None = Field(default=None, ge=0, le=1e12)
    currency: str
    gross: bool | None = None
    frequency: str | None = None


class Vacancy(BaseModel):
    id: str
    source: Source
    title: str
    company: str
    city: str
    experience: str
    experience_label: str
    work_formats: list[str]
    salary: Salary | None = None
    skills: list[str] = Field(default_factory=list)
    description: str
    published_at: datetime | None = None
    source_url: str | None = None


class Catalog(BaseModel):
    source: Source
    items: list[Vacancy]
    found: int
    page: int
    pages: int
    fetched_at: datetime
    hh_available: bool


class PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def plain(value: Any) -> str:
    parser = PlainText()
    parser.feed(str(value or "")[:50000])
    return " ".join(" ".join(parser.parts).split())


def obj(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def normalize(row: dict[str, Any]) -> Vacancy:
    identity = str(row.get("id", ""))
    if not re.fullmatch(r"\d{1,20}", identity):
        raise ValueError("Invalid vacancy id")
    salary = obj(row.get("salary_range")) or obj(row.get("salary"))
    snippet = obj(row.get("snippet"))
    experience = obj(row.get("experience"))
    formats = row.get("work_format") or []
    skills = row.get("key_skills") or []
    if not isinstance(formats, list) or not isinstance(skills, list):
        raise ValueError("Invalid vacancy fields")
    return Vacancy(
        id=identity,
        source="hh",
        title=plain(row.get("name")) or "Без названия",
        company=plain(obj(row.get("employer")).get("name")) or "Не указана",
        city=plain(obj(row.get("area")).get("name")) or "Не указан",
        experience=plain(experience.get("id")),
        experience_label=plain(experience.get("name")) or "Не указан",
        work_formats=[plain(obj(item).get("id")) for item in formats],
        salary=Salary(
            minimum=salary.get("from"),
            maximum=salary.get("to"),
            currency=plain(salary.get("currency")),
            gross=salary.get("gross"),
            frequency=plain(obj(salary.get("frequency")).get("name")) or None,
        )
        if salary
        else None,
        skills=[plain(obj(item).get("name")) for item in skills if obj(item).get("name")],
        description=plain(
            row.get("description")
            or " ".join(str(snippet.get(key) or "") for key in ("requirement", "responsibility"))
        ),
        published_at=row.get("published_at"),
        source_url=f"https://hh.ru/vacancy/{identity}",
    )


def demo() -> list[Vacancy]:
    rows = [
        (
            "1",
            "Стажёр Python Backend",
            "Учебная команда Альфа",
            "Москва",
            "noExperience",
            "Без опыта",
            ["REMOTE", "HYBRID"],
            ["Python", "PostgreSQL", "Git"],
            40000,
            60000,
        ),
        (
            "2",
            "Junior Backend Developer",
            "Демо Лаборатория",
            "Санкт-Петербург",
            "between1And3",
            "От 1 года до 3 лет",
            ["REMOTE"],
            ["Python", "FastAPI", "Docker"],
            70000,
            100000,
        ),
        (
            "3",
            "Стажёр Frontend React",
            "Учебная команда Бета",
            "Москва",
            "noExperience",
            "Без опыта",
            ["HYBRID"],
            ["JavaScript", "React", "TypeScript"],
            None,
            None,
        ),
        (
            "4",
            "Junior Node.js Developer",
            "Демо Платформа",
            "Казань",
            "between1And3",
            "От 1 года до 3 лет",
            ["ON_SITE"],
            ["JavaScript", "Node.js", "PostgreSQL"],
            65000,
            90000,
        ),
        (
            "5",
            "Стажёр QA Automation",
            "Учебная команда Гамма",
            "Новосибирск",
            "noExperience",
            "Без опыта",
            ["REMOTE"],
            ["Python", "pytest", "Git"],
            35000,
            None,
        ),
        (
            "6",
            "Middle Python Developer",
            "Демо Системы",
            "Москва",
            "between3And6",
            "От 3 до 6 лет",
            ["HYBRID"],
            ["Python", "Django", "Redis"],
            150000,
            200000,
        ),
    ]
    return [
        Vacancy(
            id=identity,
            source="demo",
            title=title,
            company=company,
            city=city,
            experience=experience,
            experience_label=label,
            work_formats=formats,
            skills=skills,
            salary=Salary(
                minimum=low, maximum=high, currency="RUR", gross=True, frequency="За месяц"
            )
            if low is not None or high is not None
            else None,
            description=f"Синтетическая вакансия для демонстрации. Работа с {', '.join(skills)}. "
            "Условия, компания и суммы вымышлены. Отклик недоступен.",
            published_at=datetime(2026, 11, 20, tzinfo=UTC),
        )
        for identity, title, company, city, experience, label, formats, skills, low, high in rows
    ]


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def hh_ready(request: Request) -> bool:
    config = request.app.state.settings
    return bool(config.hh_access_token.get_secret_value() and config.hh_user_agent.strip())


def read_hh(request: Request, path: str, params: dict[str, str | int]) -> dict[str, Any]:
    if not hh_ready(request):
        raise HTTPException(503, "Источник hh.ru ещё не подключён. Пока доступен демокаталог.")
    request.app.state.vacancy_limiter.check(
        "vacancies:" + (request.client.host if request.client else "unknown")
    )
    config = request.app.state.settings
    url = "https://api.hh.ru/vacancies" + path + ("?" + urlencode(params) if params else "")
    query = URLRequest(
        url,
        headers={
            "User-Agent": config.hh_user_agent,
            "Authorization": "Bearer " + config.hh_access_token.get_secret_value(),
            "Accept": "application/json",
        },
    )
    try:
        with build_opener(NoRedirect()).open(query, timeout=8) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("Response too large")
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError("Invalid response")
        return data
    except HTTPError as error:
        if error.code == 404:
            raise HTTPException(404, "Вакансия больше не доступна в источнике") from None
        if error.code == 429:
            raise HTTPException(
                503, "Лимит hh.ru исчерпан. Повторите позже или откройте демокаталог."
            ) from None
        raise HTTPException(
            503, "hh.ru отклонил запрос. Доступ источника требует проверки."
        ) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise HTTPException(503, "Не удалось получить вакансии hh.ru. Повторите позже.") from None


@router.get("", response_model=Catalog)
def catalog(
    request: Request,
    source: Source = "demo",
    q: Annotated[str, Query(max_length=120)] = "",
    experience: Experience = "",
    work_format: Format = "",
    page: Annotated[int, Query(ge=0, le=99)] = 0,
) -> Catalog:
    if source == "demo":
        rows = [
            row
            for row in demo()
            if (
                q.strip().casefold()
                in " ".join([row.title, row.company, row.city, *row.skills]).casefold()
                and (not experience or row.experience == experience)
                and (not work_format or work_format in row.work_formats)
            )
        ]
        found, pages = len(rows), (len(rows) + 19) // 20
        rows = rows[page * 20 : (page + 1) * 20]
    else:
        params: dict[str, str | int] = {"page": page, "per_page": 20}
        for key, value in {
            "text": q.strip(),
            "experience": experience,
            "work_format": work_format,
        }.items():
            if value:
                params[key] = value
        data = read_hh(request, "", params)
        try:
            items = data["items"]
            if not isinstance(items, list):
                raise ValueError("Invalid items")
            unique = {str(item["id"]): normalize(item) for item in items}
            rows = list(unique.values())
            found, pages = max(0, int(data["found"])), min(100, max(0, int(data["pages"])))
        except (ValueError, KeyError, TypeError):
            raise HTTPException(502, "hh.ru вернул неожиданный формат вакансий") from None
    return Catalog(
        source=source,
        items=rows,
        found=found,
        page=page,
        pages=pages,
        fetched_at=datetime.now(UTC),
        hh_available=hh_ready(request),
    )


@router.get("/{source}/{vacancy_id}", response_model=Vacancy)
def detail(request: Request, source: Source, vacancy_id: str) -> Vacancy:
    if not re.fullmatch(r"\d{1,20}", vacancy_id):
        raise HTTPException(404, "Вакансия не найдена")
    if source == "demo":
        for row in demo():
            if row.id == vacancy_id:
                return row
        raise HTTPException(404, "Вакансия не найдена")
    data = read_hh(request, "/" + vacancy_id, {})
    if data.get("archived"):
        raise HTTPException(404, "Вакансия находится в архиве")
    try:
        return normalize(data)
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, "hh.ru вернул неожиданный формат вакансии") from None

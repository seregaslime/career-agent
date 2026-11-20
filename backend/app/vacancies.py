"""Independent vacancy catalog: synthetic demo and the public Russian employment open-data API."""

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from threading import Lock
from time import monotonic
from typing import Annotated, Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, build_opener
from urllib.request import Request as URLRequest

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

Source = Literal["demo", "trudvsem"]
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
    filtered_on_page: bool = False


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


def source_id(value: str) -> tuple[str, str]:
    match = re.fullmatch(r"([A-Za-z0-9-]{1,64})~([A-Za-z0-9-]{1,64})", value)
    if not match:
        raise ValueError("Invalid vacancy identity")
    return match[1], match[2]


def normalize(row: dict[str, Any]) -> Vacancy:
    company = obj(row.get("company"))
    if company.get("companycode") is None or row.get("id") is None:
        raise ValueError("Missing vacancy identity")
    identity = str(company.get("companycode", "")) + "~" + str(row.get("id", ""))
    company_id, vacancy_id = source_id(identity)
    requirement = obj(row.get("requirement"))
    years = requirement.get("experience")
    experience, label = "", "Не указан"
    if isinstance(years, (int, float)) and not isinstance(years, bool) and 0 <= years <= 100:
        experience = (
            "noExperience"
            if years == 0
            else "between1And3"
            if years < 3
            else "between3And6"
            if years <= 6
            else "moreThan6"
        )
        label = "Без опыта" if years == 0 else f"От {years:g} лет"
    employment = plain(row.get("employment"))
    schedule = plain(row.get("schedule"))
    work = (employment + " " + schedule).casefold().replace("ё", "е")
    formats = ["REMOTE"] if "дистанцион" in work or "удален" in work else []
    if "гибрид" in work:
        formats = ["HYBRID"]
    skills = row.get("skills") or []
    if not isinstance(skills, list):
        raise ValueError("Invalid skills")
    low, high = row.get("salary_min"), row.get("salary_max")
    low = low if isinstance(low, (int, float)) and low > 0 else None
    high = high if isinstance(high, (int, float)) and high > 0 else None
    currency = plain(row.get("currency"))
    currency = "RUR" if "руб" in currency.casefold() or currency in ("RUB", "RUR") else currency
    description = "\n".join(
        filter(
            None,
            [
                plain(row.get("duty")),
                plain(row.get("requirements")),
                "Образование: " + plain(requirement["education"])
                if requirement.get("education")
                else "",
                "Занятость: " + employment if employment else "",
                "График: " + schedule if schedule else "",
            ],
        )
    )
    published = row.get("creation-date")
    stamp = datetime.fromisoformat(published) if published else None
    if stamp is not None and stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return Vacancy(
        id=identity,
        source="trudvsem",
        title=plain(row.get("job-name")) or "Без названия",
        company=plain(company.get("name")) or "Не указана",
        city=plain(obj(row.get("region")).get("name")) or "Не указан",
        experience=experience,
        experience_label=label,
        work_formats=formats,
        salary=Salary(minimum=low, maximum=high, currency=currency) if low or high else None,
        skills=list(dict.fromkeys(plain(item) for item in skills if isinstance(item, str))),
        description=description,
        published_at=stamp,
        source_url=f"https://trudvsem.ru/vacancy/card/{company_id}/{vacancy_id}",
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


def read_source(request: Request, path: str, params: dict[str, str | int]) -> dict[str, Any]:
    request.app.state.vacancy_limiter.check(
        "vacancies:" + (request.client.host if request.client else "unknown")
    )
    url = "https://opendata.trudvsem.ru/api/v1/vacancies" + path
    if params:
        url += "?" + urlencode(params)
    query = URLRequest(
        url,
        headers={
            "User-Agent": "CareerAgentStudent/0.1 (https://github.com/seregaslime/career-agent)",
            "Accept": "application/json",
        },
    )
    try:
        with build_opener(NoRedirect()).open(query, timeout=15) as response:
            body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError("Response too large")
        data = json.loads(body)
        if not isinstance(data, dict) or str(data.get("status")) != "200":
            raise ValueError("Invalid source response")
        return data
    except HTTPError as error:
        if error.code == 404:
            raise HTTPException(404, "Вакансия больше не доступна в источнике") from None
        raise HTTPException(
            503, "Источник «Работа России» временно недоступен. Повторите позже."
        ) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise HTTPException(
            503, "Не удалось получить данные «Работы России». Повторите позже."
        ) from None


def normalized_items(data: dict[str, Any]) -> list[Vacancy]:
    items = data["results"]["vacancies"]
    if not isinstance(items, list):
        raise ValueError("Invalid items")
    unique = {row.id: row for row in (normalize(item["vacancy"]) for item in items)}
    return list(unique.values())


@dataclass
class SourcePage:
    items: list[Vacancy]
    found: int
    fetched_at: datetime
    expires: float


class SourceCache:
    """Per-process bounded cache of normalized public vacancies, without contact fields."""

    def __init__(self) -> None:
        self.lock = Lock()
        self.entries: dict[str, SourcePage] = {}

    def get(self, key: str) -> SourcePage | None:
        with self.lock:
            row = self.entries.get(key)
            return row if row and row.expires > monotonic() else None

    def put(self, key: str, value: SourcePage) -> None:
        with self.lock:
            self.entries = {k: v for k, v in self.entries.items() if v.expires > monotonic()}
            if len(self.entries) >= 16:
                self.entries.pop(next(iter(self.entries)))
            self.entries[key] = value


def source_page(request: Request, path: str, params: dict[str, str | int]) -> SourcePage:
    cache: SourceCache = request.app.state.vacancy_cache
    key = path + "?" + urlencode(sorted(params.items()))
    cached = cache.get(key)
    if cached is not None:
        return cached
    data = read_source(request, path, params)
    try:
        rows = normalized_items(data)
        found = max(0, int(obj(data.get("meta")).get("total", len(rows))))
    except (ValueError, KeyError, TypeError, AttributeError):
        raise HTTPException(502, "Источник вернул неожиданный формат вакансий") from None
    result = SourcePage(rows, found, datetime.now(UTC), monotonic() + 300)
    cache.put(key, result)
    return result


@router.get("", response_model=Catalog)
def catalog(
    request: Request,
    source: Source = "trudvsem",
    q: Annotated[str, Query(max_length=120)] = "",
    experience: Experience = "",
    work_format: Format = "",
    page: Annotated[int, Query(ge=0, le=99)] = 0,
) -> Catalog:
    fetched_at = datetime.now(UTC)
    if source == "demo":
        rows = [
            row
            for row in demo()
            if q.strip().casefold()
            in " ".join([row.title, row.company, row.city, *row.skills]).casefold()
        ]
    else:
        params: dict[str, str | int] = {"offset": page, "limit": 20}
        if q.strip():
            params["text"] = q.strip()
        result = source_page(request, "", params)
        rows, found, fetched_at = result.items, result.found, result.fetched_at
    rows = [
        row
        for row in rows
        if (not experience or row.experience == experience)
        and (not work_format or work_format in row.work_formats)
    ]
    if source == "demo":
        found = len(rows)
        rows = rows[page * 20 : (page + 1) * 20]
    pages = min(100, (found + 19) // 20)
    return Catalog(
        source=source,
        items=rows,
        found=found,
        page=page,
        pages=pages,
        fetched_at=fetched_at,
        filtered_on_page=source == "trudvsem" and bool(experience or work_format),
    )


@router.get("/{source}/{vacancy_id}", response_model=Vacancy)
def detail(request: Request, source: Source, vacancy_id: str) -> Vacancy:
    if source == "demo":
        for row in demo():
            if row.id == vacancy_id:
                return row
        raise HTTPException(404, "Вакансия не найдена")
    try:
        company_id, identity = source_id(vacancy_id)
    except ValueError:
        raise HTTPException(404, "Вакансия не найдена") from None
    result = source_page(request, f"/vacancy/{company_id}/{identity}", {})
    for row in result.items:
        if row.id == vacancy_id:
            return row
    raise HTTPException(404, "Вакансия не найдена")

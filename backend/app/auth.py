import secrets
from collections import defaultdict, deque
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from threading import Lock
from time import monotonic
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import LoginSession, Profile, User
from app.security import hash_password, token_hash, verify_password

router = APIRouter(prefix="/api")
COOKIE = "career_session"
DUMMY_HASH = hash_password("not-a-real-password")


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if value.count("@") != 1 or any(c.isspace() for c in value):
            raise ValueError("Некорректный email")
        local, domain = value.split("@")
        if not local or "." not in domain or domain.startswith(".") or domain.endswith("."):
            raise ValueError("Некорректный email")
        return value


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    is_admin: bool
    is_super_admin: bool


class ProfileData(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    full_name: str = Field(default="", max_length=120)
    target_role: str = Field(default="", max_length=120)
    education: str = Field(default="", max_length=3000)
    about: str = Field(default="", max_length=5000)


class AuthLimiter:
    """Single-process limit; replace with shared storage before scaling."""

    def __init__(self) -> None:
        self.lock = Lock()
        self.events: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = monotonic()
        with self.lock:
            # Remove expired keys, bounding memory even for unique login attempts.
            for expired in [k for k, v in self.events.items() if not v or v[-1] < now - 60]:
                del self.events[expired]
            history = self.events[key]
            while history and history[0] < now - 60:
                history.popleft()
            if len(history) >= 10 or len(self.events) > 10000:
                raise HTTPException(429, "Слишком много попыток. Подождите минуту.")
            history.append(now)


def db(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session


DB = Annotated[Session, Depends(db)]


def current_user(request: Request, session: DB) -> User:
    raw = request.cookies.get(COOKIE)
    record = session.get(LoginSession, token_hash(raw)) if raw else None
    if record is None or record.expires_at <= datetime.now(UTC):
        raise HTTPException(401, "Войдите в аккаунт")
    user = session.get(User, record.user_id)
    if user is None or user.is_blocked:
        raise HTTPException(401, "Войдите в аккаунт")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def issue_session(request: Request, response: Response, session: Session, user: User) -> None:
    old = request.cookies.get(COOKIE)
    existing = session.get(LoginSession, token_hash(old)) if old else None
    if existing is not None:
        session.delete(existing)
    raw = secrets.token_urlsafe(32)
    session.add(
        LoginSession(
            token_hash=token_hash(raw),
            user_id=user.id,
            expires_at=datetime.now(UTC) + timedelta(days=7),
        )
    )
    session.commit()
    response.set_cookie(
        COOKIE,
        raw,
        max_age=7 * 86400,
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
        path="/api",
    )
    response.headers["Cache-Control"] = "no-store"


def limit_auth(request: Request, email: str) -> None:
    address = request.client.host if request.client else "unknown"
    request.app.state.auth_limiter.check("ip:" + address)
    request.app.state.auth_limiter.check("email:" + email)


@router.post("/auth/register", response_model=UserOut, status_code=201)
def register(data: Credentials, request: Request, response: Response, session: DB) -> User:
    limit_auth(request, data.email)
    user = User(id=str(uuid4()), email=data.email, password_hash=hash_password(data.password))
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Не удалось создать аккаунт с этим email") from None
    session.add(Profile(user_id=user.id))
    issue_session(request, response, session, user)
    return user


@router.post("/auth/login", response_model=UserOut)
def login(data: Credentials, request: Request, response: Response, session: DB) -> User:
    from sqlalchemy import select

    limit_auth(request, data.email)
    user = session.scalar(select(User).where(User.email == data.email).with_for_update())
    valid = verify_password(data.password, user.password_hash if user else DUMMY_HASH)
    if user is None or not valid or user.is_blocked:
        raise HTTPException(401, "Неверный email или пароль")
    issue_session(request, response, session, user)
    return user


@router.get("/auth/me", response_model=UserOut)
def me(user: CurrentUser, response: Response) -> User:
    response.headers["Cache-Control"] = "no-store"
    return user


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, session: DB) -> None:
    raw = request.cookies.get(COOKIE)
    record = session.get(LoginSession, token_hash(raw)) if raw else None
    if record:
        session.delete(record)
        session.commit()
    response.delete_cookie(
        COOKIE,
        path="/api",
        secure=request.app.state.settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


@router.get("/profile", response_model=ProfileData)
def get_profile(user: CurrentUser, session: DB, response: Response) -> Profile:
    response.headers["Cache-Control"] = "no-store"
    profile = session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(404, "Профиль не найден")
    return profile


@router.patch("/profile", response_model=ProfileData)
def update_profile(
    data: ProfileData, user: CurrentUser, session: DB, response: Response
) -> Profile:
    profile = session.get(Profile, user.id)
    if profile is None:
        raise HTTPException(404, "Профиль не найден")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    session.commit()
    session.refresh(profile)
    response.headers["Cache-Control"] = "no-store"
    return profile

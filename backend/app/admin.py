from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import aliased

from app.auth import DB, CurrentUser, ProfileData
from app.models import AdminEvent, LoginSession, Profile, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(user: CurrentUser) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Требуются права администратора")
    return user


Admin = Annotated[User, Depends(require_admin)]


class AdminUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    is_admin: bool
    is_blocked: bool


class UserList(BaseModel):
    items: list[AdminUser]
    total: int
    offset: int
    limit: int


class UserDetail(BaseModel):
    user: AdminUser
    profile: ProfileData | None
    active_sessions: int


class BlockChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    blocked: bool
    reason: str = Field(min_length=3, max_length=500)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    actor_id: str
    target_id: str
    action: str
    reason: str
    created_at: datetime
    actor_email: str = ""
    target_email: str = ""


@router.get("/users", response_model=UserList)
def list_users(
    admin: Admin,
    session: DB,
    response: Response,
    q: str = Query(default="", max_length=120),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> UserList:
    response.headers["Cache-Control"] = "no-store"
    query = select(User)
    if q.strip():
        query = query.where(User.email.icontains(q.strip(), autoescape=True))
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = session.scalars(query.order_by(User.email, User.id).offset(offset).limit(limit)).all()
    return UserList(
        items=[AdminUser.model_validate(u) for u in users], total=total, offset=offset, limit=limit
    )


@router.get("/users/{user_id}", response_model=UserDetail)
def get_user(user_id: str, admin: Admin, session: DB, response: Response) -> UserDetail:
    response.headers["Cache-Control"] = "no-store"
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    profile = session.get(Profile, user_id)
    count = (
        session.scalar(
            select(func.count())
            .select_from(LoginSession)
            .where(LoginSession.user_id == user_id, LoginSession.expires_at > datetime.now(UTC))
        )
        or 0
    )
    return UserDetail(
        user=AdminUser.model_validate(user),
        profile=ProfileData.model_validate(profile) if profile else None,
        active_sessions=count,
    )


@router.patch("/users/{user_id}/block", response_model=AdminUser)
def change_block(
    user_id: str,
    data: BlockChange,
    admin: Admin,
    session: DB,
    response: Response,
) -> User:
    response.headers["Cache-Control"] = "no-store"
    if len(data.reason.strip()) < 3:
        raise HTTPException(422, "Укажите причину изменения")
    # Serializes status changes with login to prevent sessions minted after a block.
    user = session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    if data.blocked and user.is_admin:
        raise HTTPException(409, "Нельзя заблокировать администратора")
    if user.is_blocked != data.blocked:
        user.is_blocked = data.blocked
        if data.blocked:
            session.execute(delete(LoginSession).where(LoginSession.user_id == user_id))
        session.add(
            AdminEvent(
                id=str(uuid4()),
                actor_id=admin.id,
                target_id=user_id,
                action="block" if data.blocked else "unblock",
                reason=data.reason.strip(),
                created_at=datetime.now(UTC),
            )
        )
        session.commit()
        session.refresh(user)
    return user


@router.get("/events", response_model=list[EventOut])
def events(
    admin: Admin, session: DB, response: Response, limit: int = Query(default=50, ge=1, le=100)
) -> list[EventOut]:
    response.headers["Cache-Control"] = "no-store"
    actor, target = aliased(User), aliased(User)
    rows = session.execute(
        select(AdminEvent, actor.email, target.email)
        .join(actor, AdminEvent.actor_id == actor.id)
        .join(target, AdminEvent.target_id == target.id)
        .order_by(AdminEvent.created_at.desc(), AdminEvent.id.desc())
        .limit(limit)
    ).all()
    return [
        EventOut.model_validate(event).model_copy(
            update={"actor_email": actor_email, "target_email": target_email}
        )
        for event, actor_email, target_email in rows
    ]

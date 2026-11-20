"""Structured profile items owned by one user; grounded interview facts are saved directly."""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import DB, CurrentUser
from app.facts import (
    MAX_FACTS_PER_TURN,
    MAX_ITEMS_PER_USER,
    FactIn,
    Kind,
    PreferenceFact,
    evidence_found,
    item_key,
    validate_data,
)
from app.models import ChatTurn, Profile, ProfileItem, User

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    kind: str
    status: str
    source: str
    data: dict[str, Any]
    evidence: str | None
    turn_id: str | None
    created_at: datetime
    updated_at: datetime


class NewItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Kind
    data: dict[str, Any]


class DataIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: dict[str, Any]


class ExtractedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    facts: list[FactIn] = Field(max_length=MAX_FACTS_PER_TURN)


class Skipped(BaseModel):
    index: int
    reason: Literal["evidence", "duplicate", "limit"]


class ExtractedOut(BaseModel):
    items: list[ItemOut]
    skipped: list[Skipped]
    already_processed: bool
    profile_fields: list[str] = []


def lock_user(session: Session, user: User) -> None:
    # Serializes duplicate checks and limits for one user's concurrent requests.
    session.scalar(select(User).where(User.id == user.id).with_for_update())


def owned_item(session: Session, user: User, item_id: str) -> ProfileItem:
    item = session.scalar(
        select(ProfileItem)
        .where(ProfileItem.id == item_id, ProfileItem.user_id == user.id)
        .with_for_update()
    )
    if item is None:
        raise HTTPException(404, "Запись профиля не найдена")
    return item


def checked_data(kind: str, data: Any) -> dict[str, Any]:
    try:
        return validate_data(kind, data)
    except ValidationError as error:
        fields = sorted({str(e["loc"][0]) for e in error.errors() if e["loc"]})
        detail = "Проверьте поля: " + ", ".join(fields) if fields else "Проверьте поля записи"
        raise HTTPException(422, detail) from None


def duplicate(session: Session, user: User, kind: str, key: str, exclude: str = "") -> bool:
    return (
        session.scalar(
            select(ProfileItem.id)
            .where(
                ProfileItem.user_id == user.id,
                ProfileItem.kind == kind,
                ProfileItem.item_key == key,
                ProfileItem.status != "rejected",
                ProfileItem.id != exclude,
            )
            .limit(1)
        )
        is not None
    )


def item_count(session: Session, user: User) -> int:
    return (
        session.scalar(
            select(func.count()).select_from(ProfileItem).where(ProfileItem.user_id == user.id)
        )
        or 0
    )


def new_item(
    user: User,
    kind: str,
    data: dict[str, Any],
    status: str,
    source: str,
    evidence: str | None = None,
    turn_id: str | None = None,
) -> ProfileItem:
    now = datetime.now(UTC)
    return ProfileItem(
        id=str(uuid4()),
        user_id=user.id,
        kind=kind,
        status=status,
        source=source,
        data=data,
        item_key=item_key(kind, data),
        evidence=evidence,
        turn_id=turn_id,
        created_at=now,
        updated_at=now,
    )


@router.get("/items", response_model=list[ItemOut])
def list_items(
    user: CurrentUser,
    session: DB,
    response: Response,
    status: Literal["suggested", "confirmed", "rejected"] | None = None,
) -> list[ProfileItem]:
    response.headers["Cache-Control"] = "no-store"
    query = select(ProfileItem).where(ProfileItem.user_id == user.id)
    query = query.where(
        ProfileItem.status == status if status else ProfileItem.status != "rejected"
    )
    return list(session.scalars(query.order_by(ProfileItem.created_at, ProfileItem.id)))


@router.post("/items", response_model=ItemOut, status_code=201)
def add_item(data: NewItem, user: CurrentUser, session: DB, response: Response) -> ProfileItem:
    response.headers["Cache-Control"] = "no-store"
    values = checked_data(data.kind, data.data)
    lock_user(session, user)
    if duplicate(session, user, data.kind, item_key(data.kind, values)):
        raise HTTPException(409, "Такая запись уже есть в профиле")
    if item_count(session, user) >= MAX_ITEMS_PER_USER:
        raise HTTPException(409, "Достигнут лимит записей профиля")
    item = new_item(user, data.kind, values, "confirmed", "manual")
    session.add(item)
    session.commit()
    return item


@router.patch("/items/{item_id}", response_model=ItemOut)
def edit_item(
    item_id: str, data: DataIn, user: CurrentUser, session: DB, response: Response
) -> ProfileItem:
    response.headers["Cache-Control"] = "no-store"
    lock_user(session, user)
    item = owned_item(session, user, item_id)
    if item.status == "rejected":
        raise HTTPException(409, "Эта запись удалена из профиля")
    values = checked_data(item.kind, data.data)
    key = item_key(item.kind, values)
    if duplicate(session, user, item.kind, key, exclude=item.id):
        raise HTTPException(409, "Такая запись уже есть в профиле")
    item.data, item.item_key, item.updated_at = values, key, datetime.now(UTC)
    session.commit()
    return item


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: str, user: CurrentUser, session: DB) -> None:
    item = owned_item(session, user, item_id)
    session.delete(item)
    session.commit()


@router.post("/items/extracted", response_model=ExtractedOut)
def save_extracted(
    data: ExtractedIn, user: CurrentUser, session: DB, response: Response
) -> ExtractedOut:
    """Add facts grounded in the user's own message straight to the profile."""
    response.headers["Cache-Control"] = "no-store"
    lock_user(session, user)
    turn = session.scalar(
        select(ChatTurn).where(ChatTurn.id == data.turn_id, ChatTurn.user_id == user.id)
    )
    if turn is None:
        raise HTTPException(404, "Сообщение не найдено")
    if turn.facts_checked_at is not None:
        existing = session.scalars(
            select(ProfileItem)
            .where(ProfileItem.user_id == user.id, ProfileItem.turn_id == turn.id)
            .order_by(ProfileItem.created_at, ProfileItem.id)
        )
        return ExtractedOut(
            items=[ItemOut.model_validate(item) for item in existing],
            skipped=[],
            already_processed=True,
        )
    created: list[ProfileItem] = []
    skipped: list[Skipped] = []
    seen: set[tuple[str, str]] = set()
    profile_fields: list[str] = []
    profile = session.get(Profile, user.id)
    room = MAX_ITEMS_PER_USER - item_count(session, user)
    for index, fact in enumerate(data.facts):
        if isinstance(fact, PreferenceFact):
            # The latest grounded statement wins; the user can still edit the field.
            if not evidence_found(fact.evidence, turn.prompt):
                skipped.append(Skipped(index=index, reason="evidence"))
            elif profile is not None and getattr(profile, fact.data.field) != fact.data.value:
                setattr(profile, fact.data.field, fact.data.value)
                if fact.data.field not in profile_fields:
                    profile_fields.append(fact.data.field)
            continue
        values = fact.data.model_dump()
        key = item_key(fact.kind, values)
        if not evidence_found(fact.evidence, turn.prompt):
            skipped.append(Skipped(index=index, reason="evidence"))
        elif (fact.kind, key) in seen or duplicate(session, user, fact.kind, key):
            skipped.append(Skipped(index=index, reason="duplicate"))
        elif len(created) >= room:
            skipped.append(Skipped(index=index, reason="limit"))
        else:
            seen.add((fact.kind, key))
            item = new_item(
                user, fact.kind, values, "confirmed", "interview", fact.evidence, turn.id
            )
            session.add(item)
            created.append(item)
    turn.facts_checked_at = datetime.now(UTC)
    session.commit()
    return ExtractedOut(
        items=[ItemOut.model_validate(item) for item in created],
        skipped=skipped,
        already_processed=False,
        profile_fields=profile_fields,
    )

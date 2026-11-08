"""Persist user-owned turns. Inference runs in the browser; replies are untrusted text."""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.auth import DB, CurrentUser
from app.models import ChatTurn, User

router = APIRouter(prefix="/api/chat", tags=["chat"])


class TurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    prompt: str
    reply: str | None
    created_at: datetime


class NewTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    prompt: str = Field(min_length=1, max_length=4000)


class Reply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reply: str = Field(min_length=1, max_length=16000)


@router.get("", response_model=list[TurnOut])
def history(user: CurrentUser, session: DB, response: Response) -> list[ChatTurn]:
    response.headers["Cache-Control"] = "no-store"
    return list(
        session.scalars(
            select(ChatTurn)
            .where(ChatTurn.user_id == user.id)
            .order_by(ChatTurn.created_at, ChatTurn.id)
        )
    )


@router.post("", response_model=TurnOut)
def add_turn(data: NewTurn, user: CurrentUser, session: DB, response: Response) -> ChatTurn:
    response.headers["Cache-Control"] = "no-store"
    session.scalar(select(User).where(User.id == user.id).with_for_update())
    existing = session.get(ChatTurn, data.id)
    if existing:
        if existing.user_id != user.id:
            raise HTTPException(404, "Сообщение не найдено")
        if existing.prompt != data.prompt.strip():
            raise HTTPException(409, "Сообщение с этим идентификатором уже сохранено")
        return existing
    if not data.prompt.strip():
        raise HTTPException(422, "Введите сообщение")
    if session.scalar(
        select(ChatTurn.id).where(ChatTurn.user_id == user.id, ChatTurn.reply.is_(None)).limit(1)
    ):
        raise HTTPException(409, "Сначала повторите получение ответа на последнее сообщение")
    count = (
        session.scalar(
            select(func.count()).select_from(ChatTurn).where(ChatTurn.user_id == user.id)
        )
        or 0
    )
    if count >= 200:
        raise HTTPException(409, "Достигнут лимит 200 сообщений интервью")
    turn = ChatTurn(
        id=data.id, user_id=user.id, prompt=data.prompt.strip(), created_at=datetime.now(UTC)
    )
    session.add(turn)
    session.commit()
    return turn


@router.patch("/{turn_id}", response_model=TurnOut)
def save_reply(
    turn_id: str, data: Reply, user: CurrentUser, session: DB, response: Response
) -> ChatTurn:
    response.headers["Cache-Control"] = "no-store"
    turn = session.scalar(
        select(ChatTurn)
        .where(ChatTurn.id == turn_id, ChatTurn.user_id == user.id)
        .with_for_update()
    )
    if turn is None:
        raise HTTPException(404, "Сообщение не найдено")
    if not data.reply.strip():
        raise HTTPException(422, "Ответ модели пуст")
    if turn.reply is None:
        turn.reply = data.reply.strip()
        session.commit()
    elif turn.reply != data.reply.strip():
        raise HTTPException(409, "Ответ уже сохранён. Обновите историю")
    return turn

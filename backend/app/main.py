from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import Settings
from app.db import check_database, make_engine


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "career-agent-api"
    version: str = "0.1.0"


class Readiness(BaseModel):
    status: Literal["ready", "unavailable"]
    database: Literal["ready", "unavailable"]


def create_app(
    settings: Settings | None = None, database_probe: Callable[[], None] | None = None
) -> FastAPI:
    config = settings or Settings()
    engine = make_engine(config) if database_probe is None else None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if engine is not None:
            engine.dispose()

    api = FastAPI(title="Career Agent API", version="0.1.0", lifespan=lifespan)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )

    @api.get("/api/health", response_model=Health)
    def health() -> Health:
        return Health()

    @api.get("/api/ready", response_model=Readiness, responses={503: {"model": Readiness}})
    def ready() -> Readiness | JSONResponse:
        try:
            if database_probe is not None:
                database_probe()
            else:
                assert engine is not None
                check_database(engine)
        except Exception:
            # Never return database errors/credentials to a public health endpoint.
            return JSONResponse(
                status_code=503, content={"status": "unavailable", "database": "unavailable"}
            )
        return Readiness(status="ready", database="ready")

    return api


app = create_app()

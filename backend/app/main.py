from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import RequestResponseEndpoint

from app.admin import router as admin_router
from app.auth import AuthLimiter, router
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
    api.state.engine = engine
    api.state.settings = config
    api.state.auth_limiter = AuthLimiter()
    api.include_router(router)
    api.include_router(admin_router)

    @api.middleware("http")
    async def protect_origin(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in ("POST", "PATCH", "PUT", "DELETE"):
            origin = request.headers.get("origin")
            if origin is not None and origin not in config.cors_origins:
                return JSONResponse(
                    status_code=403, content={"detail": "Недопустимый источник запроса"}
                )
        return await call_next(request)

    api.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST", "PATCH"],
        allow_credentials=True,
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

from sqlalchemy import Engine, create_engine, text

from app.config import Settings

SCHEMA_VERSION = "0001_baseline"


def make_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        connect_args={"connect_timeout": 3, "options": "-c statement_timeout=3000"},
    )


def check_database(engine: Engine) -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        if version != SCHEMA_VERSION:
            raise RuntimeError("Database schema is not up to date")

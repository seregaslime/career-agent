from sqlalchemy import Engine, create_engine, text

from app.config import Settings

SCHEMA_VERSION = "0005_recovery_codes"


def make_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_size=3,
        max_overflow=2,
        connect_args={"connect_timeout": 5},
    )


def check_database(engine: Engine) -> None:
    with engine.connect() as connection:
        connection.execute(text("SET LOCAL statement_timeout = 3000"))
        connection.execute(text("SELECT 1"))
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        if version != SCHEMA_VERSION:
            raise RuntimeError("Database schema is not up to date")

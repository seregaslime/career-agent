import os
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.config import Settings
from app.db import check_database, make_engine


@pytest.mark.integration
def test_migration_upgrade_and_readiness() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration")
    env = {**os.environ, "DATABASE_URL": url}
    root = Path(__file__).resolve().parents[1]
    # Only forward migrations, against a dedicated disposable database supplied by caller.
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, env=env, check=True
    )
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, env=env, check=True
    )
    engine = make_engine(Settings(database_url=SecretStr(url)))
    try:
        check_database(engine)
        with engine.connect() as connection:
            assert connection.execute(text("SELECT 1")).scalar_one() == 1
    finally:
        engine.dispose()

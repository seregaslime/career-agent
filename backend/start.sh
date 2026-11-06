#!/bin/sh
set -eu
cd "$(dirname "$0")"
.venv/bin/python -m alembic upgrade head
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"

"""Trusted operator command; never exposed as an HTTP endpoint."""

import argparse
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import make_engine
from app.models import AdminEvent, LoginSession, User


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Grant admin to an explicitly selected existing account"
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--super-admin", action="store_true")
    args = parser.parse_args()
    engine = make_engine(Settings())
    try:
        with Session(engine) as session:
            user = session.scalar(
                select(User).where(User.email == args.email.strip().lower()).with_for_update()
            )
            if user is None:
                raise SystemExit("Account not found. Register the intended account first.")
            if user.is_blocked:
                raise SystemExit("Cannot grant admin to a blocked account.")
            if not user.is_admin or (args.super_admin and not user.is_super_admin):
                user.is_admin = True
                if args.super_admin:
                    user.is_super_admin = True
                session.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
                session.add(
                    AdminEvent(
                        id=str(uuid4()),
                        actor_id=user.id,
                        target_id=user.id,
                        action="operator_grant_super_admin"
                        if args.super_admin
                        else "operator_grant_admin",
                        reason="Trusted operator command",
                        created_at=datetime.now(UTC),
                    )
                )
                session.commit()
            print("Admin role granted to the explicitly selected account.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

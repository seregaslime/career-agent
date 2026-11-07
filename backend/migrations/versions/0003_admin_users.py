"""Add explicit admin role, reversible user blocking and audit events."""

import sqlalchemy as sa
from alembic import op

revision = "0003_admin_users"
down_revision = "0002_auth_profile"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column(
        "users", sa.Column("is_blocked", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.create_table(
        "admin_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("target_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("admin_events")
    op.drop_column("users", "is_blocked")
    op.drop_column("users", "is_admin")

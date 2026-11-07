"""Add users, server-side sessions, and owner-scoped profiles."""

import sqlalchemy as sa
from alembic import op

revision = "0002_auth_profile"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text, nullable=False),
    )
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "profiles",
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("full_name", sa.String(120), nullable=False, server_default=""),
        sa.Column("target_role", sa.String(120), nullable=False, server_default=""),
        sa.Column("education", sa.Text, nullable=False, server_default=""),
        sa.Column("about", sa.Text, nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("profiles")
    op.drop_table("sessions")
    op.drop_table("users")

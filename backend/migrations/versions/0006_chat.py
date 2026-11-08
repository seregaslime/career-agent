"""Persist interview turns without model credentials."""

import sqlalchemy as sa
from alembic import op

revision = "0006_chat"
down_revision = "0005_recovery_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_turns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("reply", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_chat_turns_user_id", "chat_turns", ["user_id"])


def downgrade() -> None:
    op.drop_table("chat_turns")

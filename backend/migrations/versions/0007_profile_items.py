"""Structured profile items, work preferences and interview fact extraction state."""

import sqlalchemy as sa
from alembic import op

revision = "0007_profile_items"
down_revision = "0006_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profiles", sa.Column("work_format", sa.String(20), nullable=False, server_default="")
    )
    op.add_column(
        "profiles", sa.Column("location", sa.String(120), nullable=False, server_default="")
    )
    op.create_check_constraint(
        "profile_work_format",
        "profiles",
        "work_format IN ('', 'office', 'remote', 'hybrid', 'any')",
    )
    op.add_column(
        "chat_turns", sa.Column("facts_checked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_table(
        "profile_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("item_key", sa.String(400), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column(
            "turn_id",
            sa.String(36),
            sa.ForeignKey("chat_turns.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('skill', 'project', 'experience', 'education')", name="profile_item_kind"
        ),
        sa.CheckConstraint(
            "status IN ('suggested', 'confirmed', 'rejected')", name="profile_item_status"
        ),
        sa.CheckConstraint("source IN ('manual', 'interview')", name="profile_item_source"),
    )
    op.create_index("ix_profile_items_user_id", "profile_items", ["user_id"])
    op.create_index("ix_profile_items_turn_id", "profile_items", ["turn_id"])
    op.create_index(
        "ix_profile_items_user_kind_key", "profile_items", ["user_id", "kind", "item_key"]
    )


def downgrade() -> None:
    op.drop_table("profile_items")
    op.drop_column("chat_turns", "facts_checked_at")
    op.drop_constraint("profile_work_format", "profiles", type_="check")
    op.drop_column("profiles", "location")
    op.drop_column("profiles", "work_format")

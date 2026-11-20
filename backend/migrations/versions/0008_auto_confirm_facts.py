"""Interview facts are now saved without confirmation; confirm pending suggestions."""

from alembic import op

revision = "0008_auto_confirm_facts"
down_revision = "0007_profile_items"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Suggestions never duplicate a confirmed item: duplicates were skipped on creation.
    op.execute("UPDATE profile_items SET status = 'confirmed' WHERE status = 'suggested'")


def downgrade() -> None:
    # Which items were once suggestions is not recorded; confirmed items stay confirmed.
    pass

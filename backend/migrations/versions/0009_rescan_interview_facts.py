"""Re-run fact extraction for saved interview messages with the improved extractor."""

from alembic import op

revision = "0009_rescan_interview_facts"
down_revision = "0008_auto_confirm_facts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Safe to repeat: the server skips facts that already exist in the profile.
    op.execute("UPDATE chat_turns SET facts_checked_at = NULL WHERE reply IS NOT NULL")


def downgrade() -> None:
    # Which messages were processed before is not recorded.
    pass

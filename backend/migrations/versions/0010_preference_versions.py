"""Order interview preferences per field and preserve existing profile values."""

import sqlalchemy as sa
from alembic import op

revision = "0010_preference_versions"
down_revision = "0009_rescan_interview_facts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profiles", sa.Column("preference_versions", sa.JSON(), nullable=False, server_default="{}")
    )
    # Existing nonempty fields have no provenance. Preserve them against old backlog;
    # messages created after this migration can still update them.
    pairs = ", ".join(
        f"'{field}', CASE WHEN {field} <> '' "
        "THEN jsonb_build_object('at', CURRENT_TIMESTAMP, 'id', '') END"
        for field in ("full_name", "target_role", "work_format", "location")
    )
    op.execute(
        f"UPDATE profiles SET preference_versions = jsonb_strip_nulls(jsonb_build_object({pairs}))"
    )


def downgrade() -> None:
    op.drop_column("profiles", "preference_versions")

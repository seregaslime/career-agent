"""Store hashed single-use account recovery codes."""

import sqlalchemy as sa
from alembic import op

revision = "0005_recovery_codes"
down_revision = "0004_super_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recovery_codes",
        sa.Column("code_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
    )
    op.create_index("ix_recovery_codes_user_id", "recovery_codes", ["user_id"])


def downgrade() -> None:
    op.drop_table("recovery_codes")

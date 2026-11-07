"""Protect superadmins and allow audited admin delegation."""

import sqlalchemy as sa
from alembic import op

revision = "0004_super_admin"
down_revision = "0003_admin_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_super_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_check_constraint(
        "super_admin_protected", "users", "NOT is_super_admin OR (is_admin AND NOT is_blocked)"
    )


def downgrade() -> None:
    op.drop_constraint("super_admin_protected", "users", type_="check")
    op.drop_column("users", "is_super_admin")

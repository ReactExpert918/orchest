"""empty message

Revision ID: 69aa6e1d358a
Revises: ee3a1e407f0c
Create Date: 2022-01-12 13:35:04.957353

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "69aa6e1d358a"
down_revision = "ee3a1e407f0c"
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "scheduler_jobs",
        sa.Column(
            "type",
            sa.String(length=50),
            nullable=False,
        ),
        sa.Column(
            "timestamp",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("type", name=op.f("pk_scheduler_jobs")),
    )
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table("scheduler_jobs")
    # ### end Alembic commands ###

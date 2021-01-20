"""Extend Job and NonInteractiveRun for scheduling

Revision ID: 0941a7d07939
Revises: 96f304f85ee5
Create Date: 2021-01-20 12:08:40.763579

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0941a7d07939"
down_revision = "96f304f85ee5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "jobs",
        sa.Column(
            "job_parameters",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
    )
    op.add_column(
        "jobs", sa.Column("next_scheduled_time", sa.DateTime(), nullable=True)
    )
    op.add_column(
        "jobs",
        sa.Column(
            "pipeline_definition",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "pipeline_run_spec",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )
    op.add_column("jobs", sa.Column("schedule", sa.String(length=100), nullable=True))
    op.add_column(
        "jobs",
        sa.Column(
            "total_scheduled_executions",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_jobs_next_scheduled_time"),
        "jobs",
        ["next_scheduled_time"],
        unique=False,
    )
    op.drop_column("jobs", "scheduled_start")
    op.add_column(
        "pipeline_runs",
        sa.Column(
            "job_schedule_number",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "pipeline_runs",
        sa.Column(
            "pipeline_parameters",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
    )


def downgrade():
    op.drop_column("pipeline_runs", "pipeline_parameters")
    op.drop_column("pipeline_runs", "job_schedule_number")
    op.add_column(
        "jobs",
        sa.Column(
            "scheduled_start",
            postgresql.TIMESTAMP(),
            autoincrement=False,
            nullable=False,
        ),
    )
    op.drop_index(op.f("ix_jobs_next_scheduled_time"), table_name="jobs")
    op.drop_column("jobs", "total_scheduled_executions")
    op.drop_column("jobs", "schedule")
    op.drop_column("jobs", "pipeline_run_spec")
    op.drop_column("jobs", "pipeline_definition")
    op.drop_column("jobs", "next_scheduled_time")
    op.drop_column("jobs", "job_parameters")

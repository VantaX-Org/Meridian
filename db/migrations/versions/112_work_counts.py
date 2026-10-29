"""work_counts: open work pre-aggregated per run, object, work status, system, severity and assignee

Revision ID: 112
Revises: 111
Create Date: 2026-10-29

The load test on 400k work records (scripts/loadtest_v2.py) found /landscape and /work/summary each counting every
work record of the current state on request (GROUP BY version_id, module, status): 180 to 380 ms idle, seconds under
50 users. work_counts holds those counts:

  work_counts   one row per (tenant, run, object, work status, system, severity, assignee): count of work records,
                sum of their issues, how many have a machine-proposed value, and their value at risk

kept exact in the same transaction as every write to work_records by three AFTER ... FOR EACH STATEMENT triggers that
read the statement's transition tables (insert, update, delete; the worklist build, decisions, batches, reassignment,
undo, re-score and purge all write work_records). A delete only decrements (never inserts), so a run deleted with
ON DELETE CASCADE never writes a row for a run that is gone. Slices that reach zero are removed.

ix_work_records_due (partial, due_at IS NOT NULL) answers the one time-dependent figure, overdue records, without a
scan of the run.

Backfilled per tenant from the current rows under a SHARE lock on work_records (no write slips in between).
Tenant-scoped: ENABLE + FORCE row-level security with the tenant policy. Independent of 106 and 107.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "112"
down_revision: str | None = "111"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SEV = "CASE {c} WHEN 0 THEN 'critical' WHEN 1 THEN 'high' WHEN 2 THEN 'medium' WHEN 3 THEN 'low' ELSE 'info' END"
# Frozen copy of api/services/work_counts.py DELTA_SQL: the signed slices of the rows ``r`` (sgn +1 / -1).
_DELTA = """
    WITH r AS ({rows}),
    cnt AS (SELECT tenant_id, version_id, module, status, scope AS system_id, {sev} AS severity, assigned_to,
                   sum(sgn) AS n, sum(sgn * issues) AS i, sum(sgn * (proposed > 0)::int) AS p
              FROM r GROUP BY 1, 2, 3, 4, 5, 6, 7),
    val AS (SELECT r.tenant_id, r.version_id, r.module, r.status, r.scope AS system_id, {rsev} AS severity,
                   r.assigned_to, sum(r.sgn * f.cost_at_risk / f.affected_count) AS v
              FROM r CROSS JOIN LATERAL unnest(r.checks) AS c(check_id)
              JOIN findings f ON f.version_id = r.version_id AND f.check_id = c.check_id AND f.tenant_id = r.tenant_id
             WHERE f.cost_at_risk IS NOT NULL AND f.affected_count > 0
             GROUP BY 1, 2, 3, 4, 5, 6, 7)
    SELECT cnt.tenant_id, cnt.version_id, cnt.module, cnt.status, cnt.system_id, cnt.severity, cnt.assigned_to,
           cnt.n, cnt.i, cnt.p, COALESCE(val.v, 0) AS v
      FROM cnt LEFT JOIN val ON val.tenant_id = cnt.tenant_id AND val.version_id = cnt.version_id
                            AND val.module = cnt.module AND val.status = cnt.status AND val.system_id = cnt.system_id
                            AND val.severity = cnt.severity AND val.assigned_to IS NOT DISTINCT FROM cnt.assigned_to
""".replace("{sev}", _SEV.format(c="sev_rank")).replace("{rsev}", _SEV.format(c="r.sev_rank"))

_KEYS = "tenant_id, version_id, module, status, system_id, severity, assigned_to"
_UPSERT = f"""
    INSERT INTO work_counts AS wc ({_KEYS}, count, issues_sum, proposed_count, value_at_risk_sum, updated_at)
    SELECT {_KEYS}, n, i, p, v, now() FROM ({{delta}}) d
     WHERE d.n <> 0 OR d.i <> 0 OR d.p <> 0 OR d.v <> 0
     ORDER BY version_id, module, status, system_id, severity, assigned_to
    ON CONFLICT ({_KEYS}) DO UPDATE
       SET count = wc.count + EXCLUDED.count, issues_sum = wc.issues_sum + EXCLUDED.issues_sum,
           proposed_count = wc.proposed_count + EXCLUDED.proposed_count,
           value_at_risk_sum = wc.value_at_risk_sum + EXCLUDED.value_at_risk_sum, updated_at = now()"""
_DECREMENT = """
    UPDATE work_counts wc SET count = wc.count + d.n, issues_sum = wc.issues_sum + d.i,
           proposed_count = wc.proposed_count + d.p, value_at_risk_sum = wc.value_at_risk_sum + d.v, updated_at = now()
      FROM ({delta}) d
     WHERE wc.tenant_id = d.tenant_id AND wc.version_id = d.version_id AND wc.module = d.module
       AND wc.status = d.status AND wc.system_id = d.system_id AND wc.severity = d.severity
       AND wc.assigned_to IS NOT DISTINCT FROM d.assigned_to"""
_DROP_ZERO = """
    DELETE FROM work_counts wc
     WHERE wc.version_id IN (SELECT DISTINCT version_id FROM {table}) AND wc.count = 0 AND wc.issues_sum = 0
       AND wc.proposed_count = 0 AND wc.value_at_risk_sum = 0"""

_NEW = "SELECT *, 1 AS sgn FROM wc_new"
_OLD = "SELECT *, -1 AS sgn FROM wc_old"


def _function() -> str:
    ins = _UPSERT.replace("{delta}", _DELTA.replace("{rows}", _NEW))
    upd = _UPSERT.replace("{delta}", _DELTA.replace("{rows}", f"{_NEW} UNION ALL {_OLD}"))
    dele = _DECREMENT.replace("{delta}", _DELTA.replace("{rows}", _OLD))
    return f"""
CREATE OR REPLACE FUNCTION work_counts_apply() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'INSERT' THEN
        {ins};
    ELSIF TG_OP = 'UPDATE' THEN
        {upd};
        {_DROP_ZERO.format(table="wc_new")};
    ELSE
        {dele};
        {_DROP_ZERO.format(table="wc_old")};
    END IF;
    RETURN NULL;
END
$fn$"""


def upgrade() -> None:
    op.create_table(
        "work_counts",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), primary_key=True),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("system_id", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("assigned_to", UUID(as_uuid=True), nullable=True),
        sa.Column("count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("issues_sum", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("proposed_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("value_at_risk_sum", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.execute(f"CREATE UNIQUE INDEX uq_work_counts_slice ON work_counts ({_KEYS}) NULLS NOT DISTINCT")
    op.execute("CREATE INDEX ix_work_counts_status ON work_counts (tenant_id, version_id, status, module)")
    op.execute("ALTER TABLE work_counts ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE work_counts FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS work_counts_rls ON work_counts")
    op.execute("CREATE POLICY work_counts_rls ON work_counts USING (tenant_id = current_setting('app.tenant_id')::uuid)")
    # overdue records (due_at < now()) without reading the run's other rows
    op.execute("CREATE INDEX ix_work_records_due ON work_records (tenant_id, version_id, module, due_at) "
               "INCLUDE (status, scope, sev_rank, assigned_to) WHERE due_at IS NOT NULL")

    # no write to work_records between the trigger and the backfill
    op.execute("LOCK TABLE work_records IN SHARE MODE")
    op.execute(_function())
    for event, ref in (("INSERT", "NEW TABLE AS wc_new"), ("UPDATE", "OLD TABLE AS wc_old NEW TABLE AS wc_new"),
                       ("DELETE", "OLD TABLE AS wc_old")):
        op.execute(f"CREATE TRIGGER work_counts_{event.lower()} AFTER {event} ON work_records "
                   f"REFERENCING {ref} FOR EACH STATEMENT EXECUTE FUNCTION work_counts_apply()")
    bind = op.get_bind()
    live = _DELTA.replace("{rows}", "SELECT *, 1 AS sgn FROM work_records WHERE tenant_id = CAST(:t AS uuid)")
    for tid in _tenants(bind):
        bind.execute(sa.text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        bind.execute(sa.text(
            f"INSERT INTO work_counts ({_KEYS}, count, issues_sum, proposed_count, value_at_risk_sum) "
            f"SELECT {_KEYS}, n, i, p, v FROM ({live}) d WHERE d.n <> 0"), {"t": tid})


def _tenants(bind) -> list[str]:
    """The tenants to backfill: every tenant with work rows when this role reads past row-level security (a superuser
    or BYPASSRLS role), else every tenant (each is then read with its own app.tenant_id)."""
    bypass = bind.execute(sa.text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")).scalar()
    sql = "SELECT DISTINCT tenant_id::text FROM work_records" if bypass else "SELECT id::text FROM tenants"
    return [r[0] for r in bind.execute(sa.text(sql)).fetchall()]


def downgrade() -> None:
    for event in ("insert", "update", "delete"):
        op.execute(f"DROP TRIGGER IF EXISTS work_counts_{event} ON work_records")
    op.execute("DROP FUNCTION IF EXISTS work_counts_apply()")
    op.execute("DROP INDEX IF EXISTS ix_work_records_due")
    op.drop_table("work_counts")

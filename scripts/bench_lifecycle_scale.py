"""Scale benchmark for the issue lifecycle (debt D-24): runs the real ``record_issues.track`` against a
throwaway Postgres seeded with synthetic issues, and times each stage.

    DATABASE_URL_SYNC=postgresql://u:p@localhost:55432/bench python scripts/bench_lifecycle_scale.py --issues 1000000

Scenario: a prior run left ISSUES issues; the newest run re-checks them. Per 100 issues of a check: 65 keep
failing, 30 are fixed (present in the extract, no longer failing, so resolved), 5 were resolved and fail
again (reopened); plus 5 new failing records (created). One check owns each record. Synthetic keys only.
Needs the migrated schema (`alembic upgrade head`). The target database name must contain "bench" because
the script TRUNCATEs the lifecycle tables. The connecting role owns the tables, so RLS is not exercised (the
same as tests/test_worklist_scale_pg.py).
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import resource
import sys
import time
import uuid
from types import SimpleNamespace

import pandas as pd
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from api.services import record_issues, remediation  # noqa: E402

PER_CHECK = 50_000  # records per check, under the real 100k cap on a check's failing-key list


def seed(eng, per: int, checks: int, tid: str, v1: str, v2: str, scope: str) -> None:
    ids = "SELECT 'C' || lpad(g::text, 4, '0') AS cid, g FROM generate_series(1, :c) g"
    key = f"'MATNR=' || lpad((i * {checks} + g)::text, 18, '0')"
    with eng.begin() as c:
        c.execute(text("TRUNCATE tenants, analysis_versions, findings, finding_records, record_issues, "
                       "record_issue_events CASCADE"))
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": tid})
        for v, ago in ((v1, "2 days"), (v2, "0 days")):
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, metadata) VALUES "
                           f"(:v, :t, 'complete', now() - interval '{ago}', CAST(:m AS jsonb))"),
                      {"v": v, "t": tid, "m": json.dumps({"system_id": scope, "modules": ["material_master"]})})
        c.execute(text(f"""
            INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                  total_count, details)
            SELECT CAST(:v AS uuid), CAST(:t AS uuid), 'material_master', cid,
                   (ARRAY['critical','high','medium','low'])[1 + g % 4], 'completeness', {per}, {per}, '{{}}'::jsonb
              FROM ({ids}) s"""), {"v": v2, "t": tid, "c": checks})
        # issues left by the prior run: i%100 < 95 open, the rest already resolved
        c.execute(text(f"""
            INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity, status,
                                       resolution, first_seen_version, last_seen_version)
            SELECT CAST(:t AS uuid), :s, 'material_master', cid, {key}, 'MARA', 'medium',
                   CASE WHEN i % 100 < 95 THEN 'open' ELSE 'resolved' END,
                   CASE WHEN i % 100 < 95 THEN NULL ELSE 'verified_fixed' END, CAST(:v AS uuid), CAST(:v AS uuid)
              FROM ({ids}) s, generate_series(0, {per} - 1) i"""), {"t": tid, "s": scope, "v": v1, "c": checks})
        # failing in the new run: 65 still failing, 5 that come back, and per/20 new ones
        c.execute(text(f"""
            INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key)
            SELECT CAST(:t AS uuid), CAST(:v AS uuid), cid, 'material_master', 'MARA', {key}
              FROM ({ids}) s, generate_series(0, {per + per // 20 - 1}) i
             WHERE i >= {per} OR i % 100 < 65 OR i % 100 >= 95"""), {"t": tid, "v": v2, "c": checks})
        c.execute(text("ANALYZE"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--issues", type=int, default=100_000)
    ap.add_argument("--url", default=os.environ.get("DATABASE_URL_SYNC"))
    a = ap.parse_args()
    if not a.url or "bench" not in a.url.rsplit("/", 1)[-1]:
        sys.exit("refusing to run: pass --url / DATABASE_URL_SYNC for a throwaway database whose name contains 'bench'")
    checks = max(1, round(a.issues / PER_CHECK))
    per = a.issues // checks // 100 * 100
    tid, v1, v2 = (str(uuid.uuid4()) for _ in range(3))
    scope = f"bench-{uuid.uuid4().hex[:8]}"
    eng = create_engine(a.url)

    t0 = time.perf_counter()
    seed(eng, per, checks, tid, v1, v2, scope)
    seed_s = time.perf_counter() - t0

    # the extract: every record of the grain, failing or not (the layout's key column is MATNR)
    present = pd.DataFrame({"MATNR": [str(i * checks + g).zfill(18) for g in range(1, checks + 1)
                                      for i in range(per + per // 20)]})
    results = [SimpleNamespace(check_id=f"C{g:04d}", grain="MARA", details={"record_key_fields": ["MATNR"]})
               for g in range(1, checks + 1)]
    frames = SimpleNamespace(frame_for=lambda keys, grain=None: (present, None), frames={}, flat=None)

    stages: dict[str, float] = collections.defaultdict(float)
    calls: dict[str, int] = collections.defaultdict(int)

    def timed(name, fn):
        def w(*args, **kw):
            t = time.perf_counter()
            try:
                return fn(*args, **kw)
            finally:
                stages[name] += time.perf_counter() - t
                calls[name] += 1
        return w

    # instrument the real functions and statements; nothing is reimplemented
    record_issues._copy = timed("copy tmp_present", record_issues._copy)
    remediation.reconcile = timed("remediation reconcile", remediation.reconcile)
    starts: list[float] = []

    def stage_of(sql: str) -> str:
        s = " ".join(sql.split())
        for needle, name in (("SELECT COALESCE(grain", "load open issue keys"),
                             ("SELECT check_id, count(*)", "batch plan"),
                             ("CREATE INDEX ON tmp_present", "index tmp_present"),
                             ("SET status = 'open'", "reopened sweep"), ("INSERT INTO record_issues", "upsert"),
                             ("SET status = 'resolved'", "resolve sweep")):
            if needle in s:
                return name
        return ""

    @event.listens_for(eng, "before_cursor_execute")
    def _b(conn, cur, stmt, params, ctx, many):
        starts.append(time.perf_counter())

    @event.listens_for(eng, "after_cursor_execute")
    def _a(conn, cur, stmt, params, ctx, many):
        d = time.perf_counter() - starts.pop()
        if name := stage_of(stmt):
            stages[name] += d
            calls[name] += 1

    with Session(eng) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": tid})
        t0 = time.perf_counter()
        out = record_issues.track(s, tid, v2, scope, results, frames, store=False)
        total = time.perf_counter() - t0
        s.commit()

    with eng.connect() as c:
        counts = dict(c.execute(text("SELECT status, count(*) FROM record_issues GROUP BY 1")).all())
        events = c.execute(text("SELECT count(*) FROM record_issue_events")).scalar()
        dead = c.execute(text("SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'record_issues'")).scalar()
        size = c.execute(text("SELECT pg_size_pretty(pg_total_relation_size('record_issues'))")).scalar()

    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 ** 3 if sys.platform == "darwin" else 1024 ** 2)  # bytes on macOS, KiB on Linux
    exp = {"created": per // 20 * checks, "reopened": per // 20 * checks, "auto_resolved": per * 30 // 100 * checks}
    print(json.dumps({
        "issues_seeded": per * checks, "checks": checks, "batches": calls["upsert"], "seed_s": round(seed_s, 1),
        "track_total_s": round(total, 1), "stages_s": {k: round(v, 1) for k, v in sorted(stages.items())},
        "result": out, "expected": exp, "ok": all(out[k] == v for k, v in exp.items()),
        "issues_by_status": counts, "events": events, "dead_tuples_record_issues": dead,
        "record_issues_size": size, "client_peak_rss_gb": round(rss, 2)}, indent=2, default=str))


if __name__ == "__main__":
    main()

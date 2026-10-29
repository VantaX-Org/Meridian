#!/usr/bin/env python3
"""Seed a load-test tenant: 3 systems, a history of runs each, and 400k work records across them.

Usage:
    python scripts/seed_loadtest.py --db-url postgresql://user@host/meridian_loadtest [--records 400000]

Writes into the local-auth tenant (00000000-0000-0000-0000-000000000001), the one the API serves with
AUTH_MODE=local, so scripts/loadtest_v2.py can sign requests with that tenant's jwt_secret. Run it against a
dedicated, migrated database (``alembic upgrade head``), never a customer database: it replaces that tenant's runs.

Shapes follow tests/landscape_seed.py and tests/m2_seed.py (dqs_summary per object, findings per rule, work_groups
per (run, rule), work_records per (run, object, record), record_issues, owners, SLA policies, run steps), scaled
with generate_series so 400k rows load in seconds. Deterministic: the same arguments give the same data.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.landscape_seed import FI_GL, MATERIAL

TENANT = "00000000-0000-0000-0000-000000000001"
NS = uuid.UUID("6f1d3c52-7d1e-4b0e-9a55-0a1b2c3d4e5f")
SYSTEMS = (  # name, type, release, modules
    ("ECC production", "ecc", "ECC 6.0 EHP8", ("material_master", "business_partner", "fi_gl")),
    ("S/4HANA finance", "s4hana_onprem", "S/4HANA 2023", ("material_master", "accounts_payable", "sd_customer_master")),
    ("SuccessFactors", "successfactors", "SF 2H 2026", ("employee_central", "compensation", "time_attendance")),
)
CHECKS_PER_MODULE = 6
HISTORY_RUNS = 6
STEWARDS = 12
SEVERITIES = ("critical", "high", "medium", "low")
DIMENSIONS = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")


def uid(*parts: object) -> str:
    return str(uuid.uuid5(NS, "/".join(str(p) for p in parts)))


def summary(module: str, score: float, records: int) -> dict:
    base = FI_GL if module == "fi_gl" else MATERIAL
    return {**base, "composite_score": score, "raw_score": score, "capped": False, "critical_breaches": [],
            "critical_count": 0,
            "clean_records": {"driving_object": "KEY", "records": records, "failing_records": records // 3,
                              "reason": None}}


def seed(db_url: str, total: int) -> dict:
    eng = create_engine(db_url)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    n_modules = sum(len(m) for *_, m in SYSTEMS)
    per_module = total // n_modules
    remainder = total - per_module * n_modules  # goes to the first object, so the total is exact
    started = time.perf_counter()
    with eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": TENANT})
        c.execute(text("INSERT INTO tenants (id, name, licensed_modules) VALUES (:t, 'Load test', ARRAY[]::text[]) "
                       "ON CONFLICT (id) DO NOTHING"), {"t": TENANT})
        c.execute(text("UPDATE tenants SET jwt_secret = COALESCE(jwt_secret, md5(random()::text) || md5(random()::text)) "
                       "WHERE id = :t"), {"t": TENANT})
        for table in ("work_records", "work_groups", "record_issues", "findings", "analysis_run_steps"):
            c.execute(text(f"DELETE FROM {table} WHERE tenant_id = :t"), {"t": TENANT})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": TENANT})
        admin = uid("user", "admin")
        users = [admin] + [uid("user", n) for n in range(STEWARDS)]
        for n, u in enumerate(users):
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, :r) "
                           "ON CONFLICT (id) DO NOTHING"),
                      {"u": u, "t": TENANT, "e": f"loadtest-{n}@example.invalid", "n": f"Load user {n}",
                       "r": "platform_admin" if n == 0 else "data_steward"})
            c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key) VALUES (:t, :u, :r) "
                           "ON CONFLICT DO NOTHING"), {"t": TENANT, "u": u, "r": "platform_admin" if n == 0 else
                                                       "data_steward"})
        c.execute(text("DELETE FROM sla_policies WHERE tenant_id = :t"), {"t": TENANT})
        for sev, minutes in (("critical", 1440), ("high", 4320), ("medium", 10080)):
            c.execute(text("INSERT INTO sla_policies (tenant_id, severity, resolve_minutes) VALUES (:t, :s, :m)"),
                      {"t": TENANT, "s": sev, "m": minutes})
        latest: dict[str, str] = {}
        for si, (name, stype, release, modules) in enumerate(SYSTEMS):
            sid = uid("system", si)
            c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, sap_release, health_status) "
                           "VALUES (:s, :t, :n, :ty, :r, 'healthy') ON CONFLICT (id) DO NOTHING"),
                      {"s": sid, "t": TENANT, "n": name, "ty": stype, "r": release})
            for mod in modules:
                c.execute(text("DELETE FROM data_owners WHERE tenant_id = :t AND kind = 'object' AND ref = :m"),
                          {"t": TENANT, "m": mod})
                c.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id, steward_user_id) "
                               "VALUES (:t, 'object', :m, :o, :s)"),
                          {"t": TENANT, "m": mod, "o": admin, "s": users[1 + (si * 3 + modules.index(mod)) % STEWARDS]})
            for h in range(HISTORY_RUNS):
                vid = uid("run", si, h)
                at = now - timedelta(days=7 * (HISTORY_RUNS - 1 - h), hours=si)
                last = h == HISTORY_RUNS - 1
                meta = {"system_id": sid, "modules": list(modules), "trigger": "scheduled"}
                if last:
                    meta["worklist_built_at"] = at.isoformat()
                if h == 0:
                    meta["baseline"] = True
                dqs = {m: summary(m, 70.0 + h * 2 + mi, per_module) for mi, m in enumerate(modules)}
                c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, label, metadata, "
                               "dqs_summary, run_number) VALUES (:v, :t, 'complete', :at, :l, CAST(:m AS jsonb), "
                               "CAST(:d AS jsonb), :n)"),
                          {"v": vid, "t": TENANT, "at": at, "l": f"{name} run {h + 1}", "m": json.dumps(meta),
                           "d": json.dumps(dqs), "n": h + 1})
                c.execute(text("INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status, "
                               "started_at, finished_at) VALUES (:t, :v, 1, 'checks', 'complete', :a, :b)"),
                          {"t": TENANT, "v": vid, "a": at, "b": at + timedelta(minutes=12)})
                for mi, mod in enumerate(modules):
                    for k in range(CHECKS_PER_MODULE):
                        chk = f"{mod[:2].upper()}{100 + k}"
                        sev = SEVERITIES[k % 4]
                        failing = per_module // (k + 1) if last else per_module // (k + 2)
                        c.execute(text(
                            "INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                            "affected_count, total_count, cost_at_risk, details) VALUES (:v, :t, :m, :c, :s, :d, :n, "
                            ":tot, :cost, CAST(:det AS jsonb))"),
                            {"v": vid, "t": TENANT, "m": mod, "c": chk, "s": sev, "d": DIMENSIONS[k % 6], "n": failing,
                             "tot": per_module * 3, "cost": failing * 12.5,
                             "det": json.dumps({"field_checked": f"T{mi}.F{k}"})})
                        if last:
                            c.execute(text(
                                "INSERT INTO work_groups (tenant_id, version_id, check_id, module, severity, sev_rank, "
                                "dimension, message, field, records, population) VALUES (:t, :v, :c, :m, :s, :r, :d, "
                                ":msg, :f, :n, :p)"),
                                {"t": TENANT, "v": vid, "c": chk, "m": mod, "s": sev, "r": k % 4, "d": DIMENSIONS[k % 6],
                                 "msg": f"{chk} fails", "f": f"T{mi}.F{k}", "n": failing, "p": per_module * 3})
                latest[sid] = vid
            vid = latest[sid]
            for mi, mod in enumerate(modules):
                pre = f"{mod[:2].upper()}"
                # one work record per failing record: the first check always, a second on every third record
                c.execute(text(f"""
                    INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, name, issues, sev_rank,
                                              checks, proposed, status, assigned_to, due_at)
                    SELECT :t, :v, :s, :m, 'KEY=' || lpad(g::text, 10, '0'), 'Record ' || g,
                           1 + (g % 3 = 0)::int, (g % 4)::smallint,
                           CASE WHEN g % 3 = 0 THEN ARRAY['{pre}' || (100 + g % 4), '{pre}' || (104 + g % 2)]
                                ELSE ARRAY['{pre}' || (100 + g % 4)] END,
                           (g % 7 = 0)::int,
                           CASE WHEN g % 50 = 0 THEN 'fixed' WHEN g % 23 = 0 THEN 'proposed' ELSE 'to_fix' END,
                           CASE WHEN g % 5 = 0 THEN (CAST(:users AS uuid[]))[1 + (g / 5) % {STEWARDS}] END,
                           CASE WHEN g % 5 = 0 THEN now() + ((g % 11) - 3) * interval '1 day' END
                      FROM generate_series(1, :n) g"""),
                          {"t": TENANT, "v": vid, "s": sid, "m": mod, "users": users[1:],
                           "n": per_module + (remainder if si == 0 and mi == 0 else 0)})
                # the record issues behind one record in ten (age, history and the people page read them)
                c.execute(text(f"""
                    INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status,
                                               assigned_to, first_seen_version, last_seen_version, first_seen_at)
                    SELECT :t, :s, :m, '{pre}' || (100 + g % 4), 'KEY=' || lpad(g::text, 10, '0'),
                           (ARRAY['critical','high','medium','low'])[1 + g % 4], 'open',
                           CASE WHEN g % 5 = 0 THEN (CAST(:users AS uuid[]))[1 + (g / 5) % {STEWARDS}] END,
                           :v0, :v, now() - (g % 60) * interval '1 day'
                      FROM generate_series(10, :n, 10) g"""),
                          {"t": TENANT, "s": sid, "m": mod, "n": per_module, "users": users[1:], "v": vid,
                           "v0": uid("run", si, 0)})
    with eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": TENANT})
        counts = {t: c.execute(text(f"SELECT count(*) FROM {t} WHERE tenant_id = :t"), {"t": TENANT}).scalar()
                  for t in ("analysis_versions", "findings", "work_groups", "work_records", "record_issues")}
    for t in ("work_records", "record_issues", "findings", "analysis_versions", "work_groups"):
        with eng.connect() as c:
            c.execution_options(isolation_level="AUTOCOMMIT").execute(text(f"VACUUM ANALYZE {t}"))
    eng.dispose()
    return {"tenant": TENANT, "seconds": round(time.perf_counter() - started, 1), "rows": counts,
            "modules": {name: list(m) for name, _, _, m in SYSTEMS}}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db-url", required=True, help="sync SQLAlchemy URL of a dedicated, migrated database")
    ap.add_argument("--records", type=int, default=400_000)
    args = ap.parse_args()
    print(json.dumps(seed(args.db_url, args.records), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

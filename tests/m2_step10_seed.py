"""Seed for the step 10 Postgres tests (policy packs, digests, sandbox, record history, run prediction, NL query).

``seed_tenant`` makes a tenant with four users (a lead, a steward, an approver, a viewer), one ECC system and ``seed_run``
adds a finished run of that system whose dqs_summary is what api/services/scoring.score_module makes of its findings,
with work_records, finding_records and analysis_run_steps so the run's duration and records are stored. Names and
keys are invented; no customer data.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

RUN_AT = datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)

# accounts_payable: AP039 (LFBK.BANKN, critical) evidences SOX vendor_bank; AP016 (LFB1.ZTERM, high) payment_terms
AP_FINDINGS = (("AP039", "critical", "validity", 4), ("AP016", "high", "completeness", 2),
               ("AP018", "high", "completeness", 0))


def summary_of(module: str, findings, total: int) -> dict:
    from api.services.scoring import score_module
    from checks.base import CheckResult, pass_rate_of

    results = [CheckResult(check_id=c, module=module, field="LFBK.BANKN", severity=s, dimension=d, passed=n == 0,
                           affected_count=n, total_count=total, pass_rate=pass_rate_of(total, n), message="",
                           details={}, grain="LFBK") for c, s, d, n in findings]
    return score_module(results, {}, module=module).model_dump()


def seed_tenant(owner) -> dict:
    tid, ecc = str(uuid.uuid4()), str(uuid.uuid4())
    ann, bob, cara, dan = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'Step ten')"), {"id": tid})
        for uid, name, role in ((ann, "Ann Lead", "programme_lead"), (bob, "Bob Steward", "data_steward"),
                                (cara, "Cara Owner", "approver"), (dan, "Dan Viewer", "viewer")):
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, :r)"),
                      {"u": uid, "t": tid, "e": f"{name.split()[0].lower()}-{tid[:8]}@example.com", "n": name, "r": role})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, health_status) "
                       "VALUES (:s, :t, 'ECC production', 'ecc', 'healthy')"), {"s": ecc, "t": tid})
    return {"tid": tid, "ecc": ecc, "ann": ann, "bob": bob, "cara": cara, "dan": dan}


def seed_run(owner, tid: str, ecc: str, *, module: str = "accounts_payable", findings=AP_FINDINGS, total: int = 200,
             run_at: datetime = RUN_AT, seconds: float = 100.0, keys: dict[str, list[str]] | None = None,
             values: dict[str, str] | None = None, assignee: str | None = None, due_at: datetime | None = None,
             metadata: dict | None = None) -> str:
    """One finished run of ``module`` with its findings; ``keys`` maps a check to its failing record keys (written to
    finding_records and work_records), ``values`` the failing field's value per record key. Returns the run id."""
    run = str(uuid.uuid4())
    meta = {"system_id": ecc, "modules": [module], "worklist_built_at": run_at.isoformat(), **(metadata or {})}
    keys = keys or {}
    with owner.begin() as c:
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, label, metadata, dqs_summary) "
                       "VALUES (:v, :t, 'complete', :at, 'ECC run', CAST(:m AS jsonb), CAST(:s AS jsonb))"),
                  {"v": run, "t": tid, "at": run_at, "m": json.dumps(meta),
                   "s": json.dumps({module: summary_of(module, findings, total)})})
        c.execute(text("INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status, "
                       "started_at, finished_at) VALUES (:t, :v, 1, 'checks', 'done', :a, :b)"),
                  {"t": tid, "v": run, "a": run_at, "b": run_at + timedelta(seconds=seconds)})
        for chk, sev, dim, n in findings:
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count, pass_rate, details) VALUES (:v, :t, :m, :c, :s, :d, :n, :tot, "
                           ":pr, CAST(:det AS jsonb))"),
                      {"v": run, "t": tid, "m": module, "c": chk, "s": sev, "d": dim, "n": n, "tot": total,
                       "pr": round((total - n) / total * 100, 2), "det": json.dumps({"field_checked": "LFBK.BANKN"})})
        by_key: dict[str, list[str]] = {}
        for chk, ks in keys.items():
            for k in ks:
                by_key.setdefault(k, []).append(chk)
                c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                               "field_values) VALUES (:t, :v, :c, :m, 'LFBK', :k, CAST(:fv AS jsonb))"),
                          {"t": tid, "v": run, "c": chk, "m": module, "k": k,
                           "fv": json.dumps({"LFBK.BANKN": (values or {}).get(k)})})
        sev_of = {f[0]: f[1] for f in findings}
        rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        for k, checks in by_key.items():
            c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, name, issues, "
                           "sev_rank, checks, status, assigned_to, due_at) VALUES (:t, :v, :s, :m, :k, NULL, :n, :r, "
                           ":c, 'to_fix', CAST(:a AS uuid), :due)"),
                      {"t": tid, "v": run, "s": ecc, "m": module, "k": k, "n": len(checks),
                       "r": min(rank.get(sev_of.get(x, "low"), 4) for x in checks), "c": sorted(checks),
                       "a": assignee, "due": due_at})
    return run

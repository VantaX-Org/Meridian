"""Seed for the step 9 Postgres tests (simulate, certificate, money, drift alerts, contracts): one tenant, one ECC
system and one finished run of material_master whose dqs_summary is what api/services/scoring.score_module makes of
its findings, so every number reconciles by hand:

  MM001  critical  validity      100 of 1000 failing  r = 90  r' = 100 - 5*10 = 50   blocks  Material Creation
  MM005  critical  accuracy       30 of 1000 failing  r = 97  r' = 100 - 5*3  = 85   blocks  MRP Planning
  MM015  low       completeness   50 of 1000 failing  r = 95  r' = 95  (weight 1)    degrades Account Determination
  MM200  medium    completeness    0 of 1000          r = 100          (weight 2)

  completeness = (95*1 + 100*2) / 3 = 98.333;  raw = (98.333*.25 + 85*.25 + 50*.10) / .60 = 84.72
  MM001 and MM005 are both over tolerance -> held at 70.

MM005's 30 failing records are K01..K30 in finding_records. Cara owns material_master, Bob stewards it. A wave
"Wave 1" holds material_master with a minimum DQS of 80.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

RUN_AT = datetime(2026, 10, 20, 6, 0, tzinfo=timezone.utc)
FINDINGS = (("MM001", "critical", "validity", 100), ("MM005", "critical", "accuracy", 30),
            ("MM015", "low", "completeness", 50), ("MM200", "medium", "completeness", 0))
KEYS = [f"MATNR=0000000000000000{n:02d}" for n in range(1, 31)]


def summary_of(findings=FINDINGS, total: int = 1000) -> dict:
    from api.services.scoring import score_module
    from checks.base import CheckResult, pass_rate_of

    results = [CheckResult(check_id=c, module="material_master", field="MARA.X", severity=s, dimension=d,
                           passed=n == 0, affected_count=n, total_count=total, pass_rate=pass_rate_of(total, n),
                           message="", details={}, grain="MARA") for c, s, d, n in findings]
    return score_module(results, {}, module="material_master").model_dump()


def seed_step9(owner, *, findings=FINDINGS, run_at: datetime = RUN_AT, tid: str | None = None,
               ecc: str | None = None) -> dict:
    """A tenant (or another run of ``tid``/``ecc``) with the run above. Returns the ids."""
    new = tid is None
    tid = tid or str(uuid.uuid4())
    ecc = ecc or str(uuid.uuid4())
    ann, bob, cara, dan, run, wave = (str(uuid.uuid4()) for _ in range(6))
    out = {"tid": tid, "ecc": ecc, "run": run}
    with owner.begin() as c:
        if new:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, 'Step nine')"), {"id": tid})
            for uid, name, role in ((ann, "Ann Lead", "programme_lead"), (bob, "Bob Steward", "steward"),
                                    (cara, "Cara Owner", "approver"), (dan, "Dan Viewer", "viewer")):
                c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, :r)"),
                          {"u": uid, "t": tid, "e": f"{name.split()[0].lower()}-{tid[:8]}@example.com", "n": name,
                           "r": role})
            c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, health_status) "
                           "VALUES (:s, :t, 'ECC production', 'ecc', 'healthy')"), {"s": ecc, "t": tid})
            c.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id, steward_user_id) "
                           "VALUES (:t, 'object', 'material_master', :o, :s)"), {"t": tid, "o": cara, "s": bob})
            c.execute(text("INSERT INTO migration_waves (id, tenant_id, name, source_system_id, modules, min_dqs) "
                           "VALUES (:w, :t, 'Wave 1', :s, ARRAY['material_master'], 80)"), {"w": wave, "t": tid, "s": ecc})
            out.update(ann=ann, bob=bob, cara=cara, dan=dan, wave=wave)
        meta = {"system_id": ecc, "modules": ["material_master"], "dataset_path": f"staging/{tid}/{run}/"}
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, label, metadata, dqs_summary) "
                       "VALUES (:v, :t, 'complete', :at, 'ECC run', CAST(:m AS jsonb), CAST(:s AS jsonb))"),
                  {"v": run, "t": tid, "at": run_at, "m": json.dumps(meta),
                   "s": json.dumps({"material_master": summary_of(findings)})})
        for chk, sev, dim, n in findings:
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count, pass_rate, details) VALUES (:v, :t, 'material_master', :c, :s, "
                           ":d, :n, 1000, :pr, CAST(:det AS jsonb))"),
                      {"v": run, "t": tid, "c": chk, "s": sev, "d": dim, "n": n, "pr": (1000 - n) / 10,
                       "det": json.dumps({"field_checked": "MARA.MEINS"})})
        if any(c_ == "MM005" and n for c_, _s, _d, n in findings):
            for k in KEYS[:{f[0]: f[3] for f in findings}["MM005"]]:
                c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, "
                               "field_values) VALUES (:t, :v, 'MM005', 'material_master', 'MARA', :k, CAST('{}' AS jsonb))"),
                          {"t": tid, "v": run, "k": k})
        for feature, status, blocking in (("Material Creation", "blocked", ["MM001"]),
                                          ("MRP Planning", "blocked", ["MM005"]),
                                          ("Account Determination", "degraded", ["MM015"])):
            c.execute(text("INSERT INTO config_impact_results (version_id, tenant_id, feature, system, status, "
                           "blocking_findings, total_affected_records) VALUES (:v, :t, :f, 'ecc', :st, CAST(:b AS jsonb), :n)"),
                      {"v": run, "t": tid, "f": feature, "st": status, "b": json.dumps(blocking),
                       "n": {"Material Creation": 100, "MRP Planning": 30, "Account Determination": 50}[feature]})
    return out


def days_before(n: int) -> datetime:
    return RUN_AT - timedelta(days=n)

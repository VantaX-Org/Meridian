"""Shared seed for tests/test_landscape_pg.py and tests/test_command_pg.py (a real Postgres, MERIDIAN_TEST_DB_URL).

One tenant, two systems, one finished run of the first with a dqs_summary for two objects:

  material_master  completeness 62, accuracy 72, consistency 70, timeliness 88, uniqueness 90, validity 65
                   -> 71.8 before the cap; MM014 and MM031 are critical and over tolerance -> held at 70
  fi_gl            completeness 95, accuracy 90 (the other four dimensions have no rules)
                   -> 92.5, nothing over tolerance -> go

"ECC production" has the run; "Spare system" has nothing extracted yet.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

RUN_AT = datetime(2026, 10, 16, 5, 17, tzinfo=timezone.utc)

MATERIAL = {
    "composite_score": 70.0, "raw_score": 71.8, "capped": True, "cap_reason": "2 critical failures over tolerance",
    "dimension_scores": {"completeness": 62.0, "accuracy": 72.0, "consistency": 70.0, "timeliness": 88.0,
                         "uniqueness": 90.0, "validity": 65.0},
    "dimension_coverage": {"completeness": 310, "accuracy": 200, "consistency": 150, "timeliness": 60,
                           "uniqueness": 93, "validity": 100},
    "weights": {"completeness": 0.25, "accuracy": 0.25, "consistency": 0.2, "timeliness": 0.1, "uniqueness": 0.1,
                "validity": 0.1},
    "critical_count": 2, "critical_breaches": ["MM014: 5.9% of MARA rows", "MM031: 1.6% of MARA rows"],
    "total_checks": 913, "coverage": 0.974, "low_confidence": False,
    "clean_records": {"driving_object": "MARA", "records": 61816, "failing_records": 9000, "reason": None},
}
FI_GL = {
    "composite_score": 92.5, "raw_score": 92.5, "capped": False, "cap_reason": None,
    "dimension_scores": {"completeness": 95.0, "accuracy": 90.0, "consistency": None, "timeliness": None,
                         "uniqueness": None, "validity": None},
    "dimension_coverage": {"completeness": 20, "accuracy": 20, "consistency": 0, "timeliness": 0, "uniqueness": 0,
                           "validity": 0},
    "weights": {"completeness": 0.5, "accuracy": 0.5},
    "critical_count": 0, "critical_breaches": [], "total_checks": 40, "coverage": 1.0, "low_confidence": False,
    "clean_records": {"driving_object": "SKA1", "records": 5000, "failing_records": 100, "reason": None},
}


def seed(owner, *, with_run: bool = True) -> dict:
    """Insert the tenant and return its ids. ``with_run=False`` leaves a tenant with a system but no run."""
    tid, ecc, spare, run, user = (str(uuid.uuid4()) for _ in range(5))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
        c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, 'Ann Steward', 'admin')"),
                  {"u": user, "t": tid, "e": f"ann-{tid[:8]}@example.com"})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type, sap_release, client, health_status) "
                       "VALUES (:s, :t, 'ECC production', 'ecc', 'ECC 6.0 EHP8', '100', 'healthy')"), {"s": ecc, "t": tid})
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'Spare system', 'ecc')"),
                  {"s": spare, "t": tid})
        out = {"tid": tid, "ecc": ecc, "spare": spare, "run": run, "user": user}
        if not with_run:
            return out
        prof = c.execute(text("INSERT INTO sync_profiles (tenant_id, system_id, domain) VALUES (:t, :s, 'mm') RETURNING id"),
                         {"t": tid, "s": ecc}).scalar()
        c.execute(text("INSERT INTO sync_runs (tenant_id, profile_id, started_at, completed_at, rows_extracted, status) "
                       "VALUES (:t, :p, :a, :b, 400662, 'completed')"),
                  {"t": tid, "p": prof, "a": RUN_AT - timedelta(hours=1), "b": RUN_AT - timedelta(minutes=30)})
        summary = {"material_master": MATERIAL, "fi_gl": FI_GL}
        meta = {"system_id": ecc, "modules": ["material_master", "fi_gl"], "worklist_built_at": "now"}
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, label, metadata, dqs_summary) "
                       "VALUES (:v, :t, 'complete', :at, 'ECC production run', CAST(:m AS jsonb), CAST(:s AS jsonb))"),
                  {"v": run, "t": tid, "at": RUN_AT, "m": json.dumps(meta), "s": json.dumps(summary)})
        for n, (a, b) in enumerate(((0, 300), (300, 702)), start=1):
            c.execute(text("INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status, "
                           "started_at, finished_at) VALUES (:t, :v, :n, 'step', 'complete', :a, :b)"),
                      {"t": tid, "v": run, "n": n, "a": RUN_AT + timedelta(seconds=a), "b": RUN_AT + timedelta(seconds=b)})
        findings = [  # module, check, severity, dimension, failing, total, cost
            ("material_master", "MM014", "critical", "validity", 3640, 61816, 4_000_000),
            ("material_master", "MM031", "critical", "accuracy", 1000, 61816, 200_000),
            ("material_master", "MM100", "low", "completeness", 0, 60000, None),
            ("fi_gl", "GL001", "medium", "completeness", 12, 5000, None),
        ]
        for mod, chk, sev, dim, n, total, cost in findings:
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                           "affected_count, total_count, cost_at_risk, details) VALUES (:v, :t, :m, :c, :s, :d, :n, :tot, "
                           ":cost, CAST('{}' AS jsonb))"),
                      {"v": run, "t": tid, "m": mod, "c": chk, "s": sev, "d": dim, "n": n, "tot": total, "cost": cost})
        for chk, title, mod, sev in (("MM014", "Base unit of measure not valid", "material_master", "critical"),
                                     ("MM031", "Material group missing", "material_master", "critical"),
                                     ("GL001", "Account without group", "fi_gl", "medium")):
            c.execute(text("INSERT INTO rules (tenant_id, name, module, category, severity) VALUES (:t, :n, :m, 'validity', :s)"),
                      {"t": tid, "n": f"{chk}: {title}", "m": mod, "s": sev})
        for feature, status, blocking in (("Goods receipt", "blocked", ["MM014"]), ("Pricing", "degraded", ["MM031"]),
                                          ("Period close", "degraded", ["GL001"]), ("Reporting", "ok", [])):
            c.execute(text("INSERT INTO config_impact_results (version_id, tenant_id, feature, system, status, blocking_findings) "
                           "VALUES (:v, :t, :f, 'ecc', :st, CAST(:b AS jsonb))"),
                      {"v": run, "t": tid, "f": feature, "st": status, "b": json.dumps(blocking)})
        for mod, key, name, status in (
                ("material_master", "MATNR=000000000000000101|WERKS=3000", "Hex bolt M8 zinc", "to_fix"),
                ("material_master", "MATNR=000000000000000102|WERKS=3000", "Hex nut M8", "proposed"),
                ("material_master", "MATNR=000000000000000103|WERKS=3000", "Washer M8", "to_fix"),
                ("material_master", "MATNR=000000000000000104|WERKS=3000", "Spring washer", "fixed"),
                ("fi_gl", "BUKRS=1000|SAKNR=0000400000", "Revenue domestic", "fixed")):
            c.execute(text("INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, name, issues, "
                           "sev_rank, checks, status) VALUES (:t, :v, :s, :m, :k, :n, 1, 0, ARRAY['MM014'], :st)"),
                      {"t": tid, "v": run, "s": ecc, "m": mod, "k": key, "n": name, "st": status})
        batch = c.execute(text("INSERT INTO remediation_batches (tenant_id, name, status) VALUES (:t, 'B', 'draft') RETURNING id"),
                          {"t": tid}).scalar()
        c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, accepted) "
                       "VALUES (:t, :b, :s, 'material_master', 'MM014', 'MATNR=1', true)"), {"t": tid, "b": batch, "s": ecc})
    return out

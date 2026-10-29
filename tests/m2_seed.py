"""Seed for the Meridian 2 endpoint tests (tests/test_m2_*_pg.py, a real Postgres, MERIDIAN_TEST_DB_URL).

Builds on tests/landscape_seed.py (one tenant: ECC production with one finished run, "Spare system" with none) and adds

  runs      run0 (12 days before, pinned as the baseline, trigger 'scheduled', 120 s of steps), run_mid (5 days before),
            the landscape run (``run``), a run of the spare system a day before it, an archived run and a failed run
            (the last two never show in the timeline). run0 -> run: MM014 100 -> 3640 failing (worse), MM031 0 -> 1000
            (newly failing), MM100 5 -> 0 (fixed), GL001 20 -> 12 (not material); MM200 exists only in ``run`` (added).
  records   finding_records of ``run``:
              R1  MATNR=...101|WERKS=3000  fails MM014 and MM031 (critical, critical); history of 3 events; hash stored
              R1b MATNR=...101|WERKS=1000  fails MM014 (same material, another plant)
              R1h MATNR=...101             fails MM031 (the material header)
              R2  MATNR=...102|WERKS=3000  fails MM014
              R3  MATNR=...103|WERKS=3000  fails MM014
            record_issues for R1 (both rules), R2 and R3 (MM014), all open; MM014 carries machine-proposed values for R1
            and R2 in findings.record_fixes
  people    Bob (steward, owns/stewards material_master with Cara), Cara (approver), Dan (viewer); work records of the
            landscape run assigned to Bob (two, one overdue) and to Ann; SLA policies; a draft batch by Bob awaiting approval
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from tests.landscape_seed import MATERIAL, RUN_AT, FI_GL, seed

R1 = "MATNR=000000000000000101|WERKS=3000"
R1B = "MATNR=000000000000000101|WERKS=1000"
R1H = "MATNR=000000000000000101"
R2 = "MATNR=000000000000000102|WERKS=3000"
R3 = "MATNR=000000000000000103|WERKS=3000"


def _summary(mm_score: float, mm_raw: float, capped: bool, gl_score: float, records: int, breaches: list[str]) -> dict:
    mm = {**MATERIAL, "composite_score": mm_score, "raw_score": mm_raw, "capped": capped,
          "critical_breaches": breaches, "critical_count": len(breaches),
          "clean_records": {"driving_object": "MARA", "records": records, "failing_records": 100, "reason": None}}
    gl = {**FI_GL, "composite_score": gl_score, "raw_score": gl_score}
    return {"material_master": mm, "fi_gl": gl}


def seed_m2(owner) -> dict:
    s = seed(owner)
    tid, ecc, spare, run, ann = s["tid"], s["ecc"], s["spare"], s["run"], s["user"]
    bob, cara, dan = (str(uuid.uuid4()) for _ in range(3))
    run0, run_mid, run_spare, run_arch, run_failed = (str(uuid.uuid4()) for _ in range(5))
    s.update(bob=bob, cara=cara, dan=dan, run0=run0, run_mid=run_mid, run_spare=run_spare, run_arch=run_arch,
             run_failed=run_failed)
    with owner.begin() as c:
        for uid, name, role in ((bob, "Bob Steward", "steward"), (cara, "Cara Owner", "approver"), (dan, "Dan Viewer", "viewer")):
            c.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, :r)"),
                      {"u": uid, "t": tid, "e": f"{name.split()[0].lower()}-{tid[:8]}@example.com", "n": name, "r": role})

        def version(vid, system, at, status, summary, trigger=None, baseline=False, archived=False, label="ECC production run"):
            meta = {"system_id": system, "modules": list(summary), "worklist_built_at": "now"}
            if trigger:
                meta["trigger"] = trigger
            if baseline:
                meta["baseline"] = True
            if archived:
                meta["archived"] = "true"
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, run_at, label, metadata, dqs_summary) "
                           "VALUES (:v, :t, :st, :at, :l, CAST(:m AS jsonb), CAST(:s AS jsonb))"),
                      {"v": vid, "t": tid, "st": status, "at": at, "l": label, "m": json.dumps(meta), "s": json.dumps(summary)})

        version(run0, ecc, RUN_AT - timedelta(days=12), "complete", _summary(78.0, 78.0, False, 88.0, 60000, []),
                trigger="scheduled", baseline=True, label="ECC production baseline")
        version(run_mid, ecc, RUN_AT - timedelta(days=5), "agents_complete", _summary(74.0, 76.0, True, 90.0, 61000, ["MM014: 1.0% of MARA rows"]),
                trigger="manual", label="ECC production mid")
        version(run_spare, spare, RUN_AT - timedelta(days=1), "complete", {"material_master": {**MATERIAL, "composite_score": 91.0, "raw_score": 91.0, "capped": False, "critical_breaches": [], "critical_count": 0}},
                label="Spare run")
        version(run_arch, ecc, RUN_AT - timedelta(days=3), "complete", _summary(70.0, 70.0, False, 80.0, 1, []), archived=True, label="Archived")
        version(run_failed, ecc, RUN_AT - timedelta(days=2), "failed", {}, label="Failed")
        for n, (a, b) in enumerate(((0, 50), (50, 120)), start=1):
            c.execute(text("INSERT INTO analysis_run_steps (tenant_id, version_id, step_number, step_name, status, started_at, finished_at) "
                           "VALUES (:t, :v, :n, 'step', 'complete', :a, :b)"),
                      {"t": tid, "v": run0, "n": n, "a": RUN_AT - timedelta(days=12) + timedelta(seconds=a),
                       "b": RUN_AT - timedelta(days=12) + timedelta(seconds=b)})
        # run0 findings: the same rules at other counts, no MM200
        for mod, chk, sev, dim, n, total in (("material_master", "MM014", "critical", "validity", 100, 60000),
                                              ("material_master", "MM031", "critical", "accuracy", 0, 60000),
                                              ("material_master", "MM100", "low", "completeness", 5, 60000),
                                              ("fi_gl", "GL001", "medium", "completeness", 20, 5000)):
            c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
                           "total_count, details) VALUES (:v, :t, :m, :c, :s, :d, :n, :tot, CAST('{}' AS jsonb))"),
                      {"v": run0, "t": tid, "m": mod, "c": chk, "s": sev, "d": dim, "n": n, "tot": total})
        # the landscape run gains a rule run0 did not have, a field for MM014 and machine-proposed values
        c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count, "
                       "total_count, details) VALUES (:v, :t, 'material_master', 'MM200', 'low', 'completeness', 3, 100, CAST('{}' AS jsonb))"),
                  {"v": run, "t": tid})
        fixes = [{"record_key": R1, "proposed_value": "EA", "confidence": "high", "fix_instruction": "Use EA"},
                 {"record_key": R2, "proposed_value": "EA", "confidence": "high", "fix_instruction": "Use EA"}]
        c.execute(text("UPDATE findings SET details = CAST(:d AS jsonb), record_fixes = CAST(:f AS jsonb) "
                       "WHERE version_id = :v AND check_id = 'MM014'"),
                  {"d": json.dumps({"field_checked": "MARA.MEINS"}), "f": json.dumps(fixes), "v": run})
        for key, checks in ((R1, ("MM014", "MM031")), (R1B, ("MM014",)), (R1H, ("MM031",)), (R2, ("MM014",)), (R3, ("MM014",))):
            for chk in checks:
                c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, field_values) "
                               "VALUES (:t, :v, :c, 'material_master', 'MARA', :k, CAST(:fv AS jsonb))"),
                          {"t": tid, "v": run, "c": chk, "k": key, "fv": json.dumps({"MEINS": "XX", "MATKL": None})})
        c.execute(text("INSERT INTO record_hashes (tenant_id, module, record_key, row_hash, version_id) "
                       "VALUES (:t, 'material_master', :k, 'abcdef0123456789abcdef', :v)"), {"t": tid, "k": R1, "v": run})
        # one record per rule has no work row yet: R1b/R1h are variants only
        issue = {}
        for key, chk, sev in ((R1, "MM014", "critical"), (R1, "MM031", "critical"), (R2, "MM014", "critical"), (R3, "MM014", "critical")):
            issue[(key, chk)] = c.execute(text(
                "INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, first_seen_version, "
                "last_seen_version, first_seen_at) VALUES (:t, :sc, 'material_master', :c, :k, :sev, 'open', :v0, :v, :at) RETURNING id::text"),
                {"t": tid, "sc": ecc, "c": chk, "k": key, "sev": sev, "v0": run0, "v": run, "at": RUN_AT - timedelta(days=12)}).scalar()
        s["issue"] = {f"{k[0]}#{k[1]}": v for k, v in issue.items()}
        for n, (action, frm, to, note, who) in enumerate((("status", "open", "in_progress", "Fix proposed", "bob"),
                                                          ("assign", None, bob, None, "ann"),
                                                          ("comment", None, None, "Check the unit with purchasing", "bob"))):
            c.execute(text("INSERT INTO record_issue_events (tenant_id, issue_id, user_label, action, from_value, to_value, note, created_at) "
                           "VALUES (:t, :i, :u, :a, :f, :to, :note, :at)"),
                      {"t": tid, "i": issue[(R1, "MM014")], "u": who, "a": action, "f": frm, "to": to, "note": note,
                       "at": RUN_AT + timedelta(hours=n + 1)})
        # a work record per decision target, with the work list's check list
        c.execute(text("UPDATE work_records SET checks = ARRAY['MM014', 'MM031'], issues = 2 WHERE version_id = :v AND record_key = :k"),
                  {"v": run, "k": R1})
        # owners and work
        c.execute(text("INSERT INTO data_owners (tenant_id, kind, ref, owner_user_id, steward_user_id) VALUES (:t, 'object', 'material_master', :o, :s)"),
                  {"t": tid, "o": cara, "s": bob})
        k102, k103 = "MATNR=000000000000000102|WERKS=3000", "MATNR=000000000000000103|WERKS=3000"
        c.execute(text("UPDATE work_records SET assigned_to = :b, due_at = :d WHERE version_id = :v AND record_key = :k"),
                  {"b": bob, "d": datetime.now(timezone.utc) - timedelta(days=2), "v": run, "k": R1})
        c.execute(text("UPDATE work_records SET assigned_to = :b WHERE version_id = :v AND record_key = :k"), {"b": bob, "v": run, "k": k102})
        c.execute(text("UPDATE work_records SET assigned_to = :a WHERE version_id = :v AND record_key = :k"), {"a": ann, "v": run, "k": k103})
        for sev, minutes in (("critical", 1440), ("high", 4320)):
            c.execute(text("INSERT INTO sla_policies (tenant_id, severity, resolve_minutes) VALUES (:t, :s, :m)"), {"t": tid, "s": sev, "m": minutes})
        for chk in ("MM900", "MM901"):
            c.execute(text("INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, severity, status, assigned_to, "
                           "first_seen_version, last_seen_version, sla_state, due_at) VALUES (:t, :sc, 'material_master', :c, 'MATNR=9', "
                           "'high', 'open', :b, :v, :v, 'breached', date_trunc('month', now()) + interval '1 hour')"),
                      {"t": tid, "sc": ecc, "c": chk, "b": bob, "v": run})
        c.execute(text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, method, path, status_code, created_at) "
                       "VALUES (:t, :u, 'bob', 'update', 'POST', '/x', 200, :at)"), {"t": tid, "u": bob, "at": RUN_AT})
        # a draft batch by Bob awaiting a second person; the base seed's batch has no human creator
        batch = c.execute(text("INSERT INTO remediation_batches (tenant_id, name, status, created_by, created_by_label) "
                               "VALUES (:t, 'Bob batch', 'draft', :b, 'bob') RETURNING id::text"), {"t": tid, "b": bob}).scalar()
        c.execute(text("INSERT INTO remediation_items (tenant_id, batch_id, scope, module, check_id, record_key, proposed_value, proposal_source) "
                       "VALUES (:t, :b, :s, 'material_master', 'MM014', 'MATNR=000000000000000104|WERKS=3000', 'EA', 'steward')"),
                  {"t": tid, "b": batch, "s": ecc})
        s["bob_batch"] = batch
    return s

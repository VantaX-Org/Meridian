"""Policy packs (GxP, SOX, GDPR): field classes with an authority reference and the catalogue rules that evidence them.

The packs are sap/policy_packs.yaml (static, shipped with the release). A tenant applies a pack (POST
/policy-packs/{id}/apply): its classes are materialised into policy_field_classes (migration 113) with the rules the
YAML lists. Everything else here is read from the run's stored findings:

  failing records   a class's (or a pack's) findings with records failing, summed over its rules: the records each
                    evidencing rule fails on, so a record failing two rules of the class counts twice
  pass rate         the mean of the class's measured rules' pass rates (record-level pass rates, as the DQS averages)
  policy breach     an applied class with at least one evidencing rule of severity critical failing on a record, per
                    (run, object): the ``policy_breaches`` count of a landscape cell and of the object receipt

Deterministic SQL only; every query carries the tenant id and runs after ``app.tenant_id`` is set (RLS).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import yaml
from sqlalchemy import text

PACKS_FILE = Path(__file__).resolve().parents[2] / "sap" / "policy_packs.yaml"


@lru_cache(maxsize=1)
def catalogue() -> tuple[dict, ...]:
    """Every pack of sap/policy_packs.yaml: {id, name, authority, description, classes: [{id, label, authority,
    fields, rules}]}."""
    doc = yaml.safe_load(PACKS_FILE.read_text(encoding="utf-8")) or {}
    out = []
    for p in doc.get("packs") or []:
        classes = [{"id": str(c["id"]), "label": str(c["label"]), "authority": str(c["authority"]),
                    "fields": [str(f) for f in c.get("fields") or []], "rules": [str(r) for r in c.get("rules") or []]}
                   for c in p.get("classes") or []]
        out.append({"id": str(p["id"]), "name": str(p["name"]), "authority": str(p.get("authority") or ""),
                    "description": str(p.get("description") or "").strip(), "classes": classes})
    return tuple(out)


def pack(pack_id: str) -> Optional[dict]:
    return next((p for p in catalogue() if p["id"] == pack_id), None)


def pack_rules(p: dict) -> list[str]:
    return sorted({r for c in p["classes"] for r in c["rules"]})


def class_of_field(field: str) -> list[tuple[str, str]]:
    """(pack id, class id) of every class naming ``TABLE.FIELD``."""
    f = field.upper()
    return [(p["id"], c["id"]) for p in catalogue() for c in p["classes"] if f in c["fields"]]


# ── apply / unapply (async; the caller set app.tenant_id, audits and commits) ───────────────────────────────────

async def apply(db, tenant_id: str, p: dict, user_id: Optional[str], user_label: str) -> None:
    t = str(tenant_id)
    await db.execute(text("""
        INSERT INTO policy_packs (tenant_id, pack_id, applied, applied_at, applied_by, applied_by_label)
        VALUES (CAST(:t AS uuid), :p, true, now(), CAST(:u AS uuid), :l)
        ON CONFLICT (tenant_id, pack_id) DO UPDATE SET applied = true, applied_at = now(),
               applied_by = EXCLUDED.applied_by, applied_by_label = EXCLUDED.applied_by_label"""),
        {"t": t, "p": p["id"], "u": user_id, "l": user_label})
    await db.execute(text("DELETE FROM policy_field_classes WHERE tenant_id = CAST(:t AS uuid) AND pack_id = :p"),
                     {"t": t, "p": p["id"]})
    for c in p["classes"]:
        await db.execute(text("""
            INSERT INTO policy_field_classes (tenant_id, pack_id, class_id, label, authority, fields, rules)
            VALUES (CAST(:t AS uuid), :p, :c, :l, :a, CAST(:f AS text[]), CAST(:r AS text[]))"""),
            {"t": t, "p": p["id"], "c": c["id"], "l": c["label"], "a": c["authority"], "f": c["fields"],
             "r": c["rules"]})


async def unapply(db, tenant_id: str, pack_id: str, user_id: Optional[str], user_label: str) -> bool:
    t = str(tenant_id)
    row = (await db.execute(text("""
        UPDATE policy_packs SET applied = false, unapplied_at = now(), unapplied_by = CAST(:u AS uuid),
               unapplied_by_label = :l
         WHERE tenant_id = CAST(:t AS uuid) AND pack_id = :p AND applied RETURNING id"""),
        {"t": t, "p": pack_id, "u": user_id, "l": user_label})).fetchone()
    await db.execute(text("DELETE FROM policy_field_classes WHERE tenant_id = CAST(:t AS uuid) AND pack_id = :p"),
                     {"t": t, "p": pack_id})
    return row is not None


async def applied_state(db, tenant_id: str) -> dict[str, dict]:
    rows = (await db.execute(text(
        "SELECT pack_id, applied, applied_at, applied_by_label, unapplied_at, unapplied_by_label FROM policy_packs "
        "WHERE tenant_id = CAST(:t AS uuid)"), {"t": str(tenant_id)})).mappings().all()
    return {r["pack_id"]: dict(r) for r in rows}


# ── reading findings ───────────────────────────────────────────────────────────────────────────────────────────

_FINDINGS_SQL = """
    SELECT f.version_id::text AS version_id, f.module, f.check_id, f.severity, f.affected_count, f.total_count,
           f.pass_rate
      FROM findings f
     WHERE f.tenant_id = CAST(:t AS uuid) AND f.check_id = ANY(CAST(:rules AS text[]))
       AND (f.details IS NULL OR f.details->>'error' IS NULL) AND {runs}"""


async def findings_for(db, tenant_id: str, rules: list[str], pairs: list[dict] | None, run_id: str | None) -> list[dict]:
    """The stored findings of ``rules``: of one run (``run_id``), else of the current state (``pairs``: each object
    from its own run)."""
    if not rules:
        return []
    p: dict[str, Any] = {"t": str(tenant_id), "rules": rules}
    if run_id is not None:
        runs = "f.version_id = CAST(:v AS uuid)"
        p["v"] = run_id
    else:
        if not pairs:
            return []
        from api.services.current_state import pairs_clause
        runs = pairs_clause("f", pairs, p)
    rows = (await db.execute(text(_FINDINGS_SQL.format(runs=runs)), p)).mappings().all()
    return [dict(r) for r in rows]


def class_evidence(c: dict, findings: list[dict]) -> dict:
    """One class over the findings of its rules: per rule its pass rate and failing records, the class pass rate (the
    mean of the measured rules' pass rates), failing records (summed over rules) and whether a critical rule fails."""
    mine = [f for f in findings if f["check_id"] in set(c["rules"])]
    by_rule: dict[str, list[dict]] = {}
    for f in mine:
        by_rule.setdefault(f["check_id"], []).append(f)
    rules = []
    for rid in c["rules"]:
        fs = by_rule.get(rid)
        if not fs:
            rules.append({"check_id": rid, "measured": False, "module": None, "severity": None, "pass_rate": None,
                          "failing_records": 0, "total_records": 0})
            continue
        failing = sum(int(f["affected_count"] or 0) for f in fs)
        total = sum(int(f["total_count"] or 0) for f in fs)
        rates = [float(f["pass_rate"]) for f in fs if f["pass_rate"] is not None]
        sev = fs[0]["severity"]
        rules.append({"check_id": rid, "measured": True, "module": fs[0]["module"], "severity": sev,
                      "pass_rate": round(sum(rates) / len(rates), 2) if rates else None,
                      "failing_records": failing, "total_records": total})
    measured = [r for r in rules if r["measured"]]
    rates = [r["pass_rate"] for r in measured if r["pass_rate"] is not None]
    return {
        "id": c["id"], "label": c["label"], "authority": c["authority"], "fields": c["fields"],
        "rules": rules, "rules_count": len(c["rules"]), "rules_measured": len(measured),
        "pass_rate": round(sum(rates) / len(rates), 2) if rates else None,
        "failing_records": sum(r["failing_records"] for r in measured),
        "breached": any(r["severity"] == "critical" and r["failing_records"] > 0 for r in measured),
    }


# ── policy breaches per (run, object) ──────────────────────────────────────────────────────────────────────────

_BREACH_SQL = """
    SELECT f.version_id::text AS version_id, f.module, c.pack_id, c.class_id, c.label, c.authority,
           array_agg(DISTINCT f.check_id ORDER BY f.check_id) AS rules
      FROM findings f
      JOIN policy_field_classes c ON c.tenant_id = f.tenant_id AND f.check_id = ANY(c.rules)
     WHERE f.tenant_id = CAST(:t AS uuid) AND f.version_id = ANY(CAST(:ids AS uuid[]))
       AND f.severity = 'critical' AND f.affected_count > 0
       AND (f.details IS NULL OR f.details->>'error' IS NULL)
       AND (CAST(:m AS text) IS NULL OR f.module = CAST(:m AS text))
     GROUP BY 1, 2, 3, 4, 5, 6
     ORDER BY 1, 2, 3, 4"""


async def breaches(db, tenant_id: str, run_ids: list[str], module: str | None = None) -> dict[tuple[str, str], list[dict]]:
    """{(run id, object): [{pack_id, class_id, label, authority, rules}]}: the applied classes with a failing critical
    rule, per run and object."""
    if not run_ids:
        return {}
    rows = (await db.execute(text(_BREACH_SQL), {"t": str(tenant_id), "ids": list(run_ids), "m": module})).mappings().all()
    out: dict[tuple[str, str], list[dict]] = {}
    for r in rows:
        out.setdefault((r["version_id"], r["module"]), []).append(
            {"pack_id": r["pack_id"], "class_id": r["class_id"], "label": r["label"], "authority": r["authority"],
             "rules": list(r["rules"] or [])})
    return out


def breaches_sync(session, tenant_id: str, run_ids: list[str]) -> dict[tuple[str, str], int]:
    """``breaches`` counted, for the workers (sync session, app.tenant_id set)."""
    if not run_ids:
        return {}
    out: dict[tuple[str, str], int] = {}
    for r in session.execute(text(_BREACH_SQL), {"t": str(tenant_id), "ids": list(run_ids), "m": None}).mappings():
        out[(r["version_id"], r["module"])] = out.get((r["version_id"], r["module"]), 0) + 1
    return out

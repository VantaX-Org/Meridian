"""Rule mining from fixes: when stewards keep entering the same value for the same field, propose the rule.

The values stewards type through POST /work/decide (action ``edit``) land as remediation items with
``proposal_source = 'steward'``, the field, the record's value at the time and the new value (an undo deletes them
again). ``mine`` groups them by object, field and new value; a group of at least ``min_records`` records (the tenant's
automation setting ``rule_mining.min_records``, default 25) whose old values share one pattern becomes a learned-rule
proposal in the existing review flow (api/routes/learned_rules.py):

  every old value blank             -> kind ``null``: a null_check on the field
  every old value the same value X  -> kind ``invalid_value``: a regex_check that rejects exactly X

Either proposal carries the new value as its ``fix_value`` (a steward-authored default, medium confidence in
checks/auto_fix.py) and the evidence: the record count, up to five sample record keys, the first and last fix and who
made them. Mixed old values are no pattern and propose nothing. Proposals are always ``pending``: a person approves
them; nothing is enabled here. Deterministic; no LLM.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict

from sqlalchemy import text

SAMPLE_KEYS = 5
MIN_SHARE = 1.0  # every old value must share the pattern

_EDITS_SQL = """
    SELECT i.module, i.field, i.proposed_value, i.current_value, i.record_key, i.updated_at,
           COALESCE(b.created_by_label, 'unknown') AS who
      FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id AND b.tenant_id = i.tenant_id
     WHERE i.tenant_id = :t AND i.proposal_source = 'steward' AND i.field IS NOT NULL AND i.proposed_value IS NOT NULL
       AND i.field LIKE '%.%'
     ORDER BY i.module, i.field, i.proposed_value, i.updated_at"""


def _blank(v: str | None) -> bool:
    return v is None or str(v).strip() == ""


def pattern_of(old_values: list[str | None]) -> tuple[str, str | None] | None:
    """('null', None) when every old value is blank, ('invalid_value', X) when every one is X, else None."""
    if not old_values:
        return None
    if all(_blank(v) for v in old_values):
        return "null", None
    stripped = {str(v).strip() for v in old_values if not _blank(v)}
    if len(stripped) == 1 and not any(_blank(v) for v in old_values):
        return "invalid_value", stripped.pop()
    return None


def fingerprint(kind: str, field: str, bad: str | None) -> str:
    return hashlib.sha1(f"fixes|{kind}|{field}|{bad or ''}".encode()).hexdigest()[:16]


def body_of(kind: str, field: str, bad: str | None, new: str) -> dict:
    """The rule body a reviewer approves (api/routes/learned_rules.approve_sync adds the module and severity)."""
    if kind == "null":
        return {"check_class": "null_check", "field": field, "dimension": "completeness", "fix_value": new,
                "message": f"{field} is blank; stewards fill it with a standard value"}
    return {"check_class": "regex_check", "field": field, "dimension": "validity", "pattern": f"^(?!{re.escape(bad or '')}$)",
            "fix_value": new, "message": f"{field} holds a value stewards always correct"}


def candidates(edits: list[dict], min_records: int) -> list[dict]:
    """The proposals the edits support: one per (object, field, new value) group with a shared pattern and at least
    ``min_records`` distinct records."""
    groups: dict[tuple, dict[str, dict]] = defaultdict(dict)
    for e in edits:
        groups[(e["module"], e["field"], e["proposed_value"])].setdefault(e["record_key"], e)  # first fix per record
    out = []
    for (module, field, new), by_key in sorted(groups.items()):
        if len(by_key) < min_records:
            continue
        found = pattern_of([e["current_value"] for e in by_key.values()])
        if found is None:
            continue
        kind, bad = found
        rows = sorted(by_key.values(), key=lambda e: (e["updated_at"], e["record_key"]))
        out.append({
            "module": module, "field": field, "kind": kind, "table_name": field.split(".", 1)[0],
            "fingerprint": fingerprint(kind, field, bad), "body": body_of(kind, field, bad, new),
            "support_rows": len(by_key), "confidence": MIN_SHARE,
            "sample_keys": [e["record_key"] for e in rows[:SAMPLE_KEYS]],
            "evidence": {"count": len(by_key), "sample_keys": [e["record_key"] for e in rows[:SAMPLE_KEYS]],
                         "first_at": rows[0]["updated_at"].isoformat() if rows[0]["updated_at"] else None,
                         "last_at": rows[-1]["updated_at"].isoformat() if rows[-1]["updated_at"] else None,
                         "who": sorted({e["who"] for e in rows}), "fix_value": new,
                         "pattern": "blank" if kind == "null" else "same invalid value",
                         "invalid_value": bad},
        })
    return out


def mine(session, tenant_id: str, min_records: int | None = None) -> dict:
    """Write (or refresh, while still pending) one proposal per candidate. Returns the counts and the proposals.
    A proposal someone already approved or rejected is left as decided. The caller commits."""
    from api.services import automation_settings

    n = int(min_records or automation_settings.load_sync(session, tenant_id)["rule_mining"]["min_records"])
    edits = [dict(r) for r in session.execute(text(_EDITS_SQL), {"t": tenant_id}).mappings().all()]
    found = candidates(edits, n)
    created = refreshed = 0
    ids = []
    for c in found:
        row = session.execute(text("""
            INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, field, fingerprint, body, confidence,
                                                support_rows, violations, sample_keys, source, evidence)
            VALUES (:t, :m, :k, :tbl, :f, :fp, CAST(:b AS jsonb), :c, :n, 0, CAST(:sk AS jsonb), 'fixes', CAST(:ev AS jsonb))
            ON CONFLICT (tenant_id, module, fingerprint) DO UPDATE
               SET body = EXCLUDED.body, support_rows = EXCLUDED.support_rows, sample_keys = EXCLUDED.sample_keys,
                   evidence = EXCLUDED.evidence, updated_at = now()
             WHERE learned_rule_proposals.status = 'pending'
            RETURNING id::text, (xmax = 0) AS inserted"""),
            {"t": tenant_id, "m": c["module"], "k": c["kind"], "tbl": c["table_name"], "f": c["field"],
             "fp": c["fingerprint"], "b": json.dumps(c["body"]), "c": c["confidence"], "n": c["support_rows"],
             "sk": json.dumps(c["sample_keys"]), "ev": json.dumps(c["evidence"])}).fetchone()
        if row is None:
            continue  # already decided
        ids.append(row[0])
        created, refreshed = created + bool(row[1]), refreshed + (not row[1])
    return {"source": "fixes", "min_records": n, "edits": len(edits), "proposed": created, "refreshed": refreshed,
            "proposal_ids": ids}

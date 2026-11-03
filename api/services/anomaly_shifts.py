"""Null spikes and unexpected codes, found by comparing a run's field profile with the runs before it.

Deterministic and aggregate-only: the input is ``field_profiles.stats`` (row and blank counts, distinct count, top
values of non-sensitive code fields), never a record, and nothing here calls an LLM. Written by
``profile_and_store`` after each module's profile; read by api/routes/aletheia_anomaly_rules.py.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

MIN_ROWS = 100       # a run or a field smaller than this has no stable blank rate
SPIKE_POINTS = 10.0  # blank share must rise by at least this many percentage points
PRIOR_RUNS = 5       # earlier runs whose codes count as "seen"
SHARE_HIGH = 5.0     # new codes on at least this share of filled rows are high severity


def _exhaustive(s: dict) -> bool:
    """The profile lists every value of the field: unmasked and no more distinct values than it lists."""
    tv = s.get("top_values")
    return not s.get("masked", True) and tv is not None and int(s.get("distinct", 0)) <= len(tv)


def detect(cur: dict, prior: list[dict]) -> list[dict]:
    """Shifts of one field. ``prior``: its stats in earlier runs, newest first. Each shift: kind, severity,
    codes (unexpected_code only: [{value, count}])."""
    if not prior or int(cur.get("rows", 0)) < MIN_ROWS:
        return []
    out: list[dict] = []
    last = prior[0]
    if int(last.get("rows", 0)) >= MIN_ROWS:
        rise = float(cur.get("blank_pct", 0)) - float(last.get("blank_pct", 0))
        if rise >= SPIKE_POINTS:
            out.append({"kind": "null_spike", "codes": [],
                        "severity": "critical" if rise >= 50 else "high" if rise >= 25 else "medium"})
    # a code is new only when the newest earlier run listed every value of the field
    if _exhaustive(cur) and _exhaustive(last):
        seen = {str(v["value"]) for p in prior if _exhaustive(p) for v in p["top_values"]}
        new = [v for v in cur["top_values"] if str(v["value"]) not in seen]
        if new:
            filled = int(cur["rows"]) - int(cur.get("blank", 0))
            share = sum(int(v["count"]) for v in new) / filled * 100 if filled else 0.0
            out.append({"kind": "unexpected_code",
                        "codes": [{"value": str(v["value"]), "count": int(v["count"])} for v in new],
                        "severity": "high" if share >= SHARE_HIGH else "medium"})
    return out


def shift_rule(kind: str, field: str, severity: str, prev: Optional[dict]) -> tuple[Optional[dict], Optional[str]]:
    """The draft rule for a shift, as (rule, reason it cannot be built). ``field`` is TABLE.FIELD, ``prev`` the field's
    stats in the run before. Null spike: null_check. Unexpected code: domain_value_check on the values that run
    listed, only when it listed every value (never raw records, never an LLM)."""
    from api.services import anomaly_rules as ar
    a = {"kind": kind, "field": field, "severity": severity}
    if kind == "unexpected_code":
        if not prev or not _exhaustive(prev):
            return None, "The earlier run did not list every value of this field."
        a["known_values"] = [str(v["value"]) for v in prev["top_values"]]
    rule = ar.template_rule(a)
    return (rule, None) if rule else (None, "No rule fits this shift.")


def _summary(s: dict) -> dict:
    return {k: s.get(k) for k in ("rows", "blank", "blank_pct", "distinct")}


def detect_and_store(session: Session, tenant_id: str, version_id: str, module: str) -> int:
    """Compare the run's stored profile of ``module`` with its earlier runs of the same system and replace the run's
    shifts. The caller set ``app.tenant_id``. Returns the number of shifts."""
    p = {"tid": str(tenant_id), "vid": str(version_id), "m": module}
    session.execute(text("DELETE FROM field_shift_anomalies WHERE tenant_id = :tid AND version_id = :vid AND module = :m"), p)
    runs = [r[0] for r in session.execute(text("""
        SELECT fp.version_id FROM field_profiles fp JOIN analysis_versions av ON av.id = fp.version_id
         WHERE fp.tenant_id = :tid AND fp.module = :m AND fp.version_id <> :vid
           AND av.run_at < (SELECT run_at FROM analysis_versions WHERE id = :vid)
           AND av.metadata->>'system_id' IS NOT DISTINCT FROM
               (SELECT metadata->>'system_id' FROM analysis_versions WHERE id = :vid)
         GROUP BY fp.version_id ORDER BY max(av.run_at) DESC LIMIT :n"""), {**p, "n": PRIOR_RUNS})]
    if not runs:
        return 0
    prior: dict[tuple[str, str], list[dict]] = {}
    for rid in runs:  # newest first
        for r in session.execute(text("SELECT table_name, field, stats FROM field_profiles "
                                      "WHERE tenant_id = :tid AND version_id = :r AND module = :m"), {**p, "r": rid}):
            prior.setdefault((r.table_name, r.field), []).append(r.stats or {})
    rows = []
    for r in session.execute(text("SELECT table_name, field, stats FROM field_profiles "
                                  "WHERE tenant_id = :tid AND version_id = :vid AND module = :m"), p):
        before = prior.get((r.table_name, r.field), [])
        for s in detect(r.stats or {}, before):
            rows.append({**p, "prev": str(runs[0]), "t": r.table_name, "f": r.field, "k": s["kind"],
                         "sev": s["severity"], "cur": json.dumps(_summary(r.stats)),
                         "old": json.dumps(_summary(before[0])), "codes": json.dumps(s["codes"])})
    if rows:
        session.execute(text("""
            INSERT INTO field_shift_anomalies (tenant_id, version_id, prev_version_id, module, table_name, field, kind,
                                               severity, current, previous, codes)
            VALUES (:tid, :vid, :prev, :m, :t, :f, :k, :sev, CAST(:cur AS jsonb), CAST(:old AS jsonb),
                    CAST(:codes AS jsonb))
        """), rows)
    return len(rows)

"""Aletheia cleaning plan for one object in one run: why each failing rule fails, the fix Meridian can suggest with
its confidence and evidence, the fix batches a steward works through, the instruction text for each batch, and what
changed since the object's previous run.

Two layers, as Foresight and Reason. The deterministic layer always answers and is computed here from the run's
findings, the YAML rules, the stored failing records and the tenant's fix drafts. Failing values are read locally and
only ever reduced to pattern counts (fix_drafter.build_shape); no value is returned in an explanation or sent anywhere.
The engine layer is the Aletheia sidecar's ``POST /api/{tenant}/learn`` over the per-rule failure counts of this
object's runs: it learns each rule's normal range and says when the latest count sits outside it. Sent: rule ids
mapped to counts, nothing else (``engine_series``).
"""
from __future__ import annotations

import json
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import aletheia_engine as engine
from api.services import cleaning_workbook as wb
from api.services.fix_drafter import KEY_PREFIX, build_shape
from api.services.pdf_reports import _all

HISTORY = 12
VALUE_CAP = 5000  # failing values kept per rule for the pattern counts; build_shape caps again
LEARN_MIN_RUNS = 3
_CONF = {"high": 90, "medium": 60, "low": 30}
KINDS = ("auto", "fill", "pick", "review")

_HISTORY_SQL = """
SELECT v.id, v.label, v.run_at FROM analysis_versions v
 WHERE v.tenant_id = :t
   AND v.run_at <= (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t)
   AND EXISTS (SELECT 1 FROM findings f WHERE f.tenant_id = :t AND f.version_id = v.id AND f.module = :m)
 ORDER BY v.run_at DESC LIMIT :n"""

_COUNTS_SQL = """
SELECT version_id, check_id, affected_count FROM findings
 WHERE tenant_id = :t AND module = :m AND version_id = ANY(CAST(:ids AS uuid[])) AND COALESCE(affected_count, 0) > 0"""


# ── loader ───────────────────────────────────────────────────────────────────

def load(s: Session, tid: str, vid: str, module: str) -> Optional[dict]:
    """Findings, rules, failing values per rule, the object's run history and the tenant's fix drafts."""
    data = wb.load(s, tid, vid, module)
    if data is None:
        return None
    fields = {f["check_id"]: f.get("field") for f in data["findings"]}
    values: dict[str, list[str]] = {}
    for r in data["records"]:
        cid = r["check_id"]
        fv = r["field_values"] or {}
        field = fields.get(cid)
        if cid not in fields or not (field in fv or len(fv) == 1):
            continue  # a multi-field record has no single value to describe
        bucket = values.setdefault(cid, [])
        if len(bucket) < VALUE_CAP:
            bucket.append(wb.current_value(field, fv))
    runs = list(reversed(_all(s, _HISTORY_SQL, t=tid, v=vid, m=module, n=HISTORY)))
    counts: dict[str, dict[str, int]] = {str(r["id"]): {} for r in runs}
    for f in _all(s, _COUNTS_SQL, t=tid, m=module, ids=list(counts)):
        d = counts[str(f["version_id"])]
        d[f["check_id"]] = d.get(f["check_id"], 0) + int(f["affected_count"])
    rows = s.execute(text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key LIKE :p"),
                     {"t": tid, "p": KEY_PREFIX.replace("_", r"\_") + "%"}).fetchall()
    drafts = {}
    for (v,) in rows:
        d = json.loads(v) if isinstance(v, str) else v
        if isinstance(d, dict) and d.get("rule_id"):
            drafts[str(d["rule_id"])] = d
    history = [{"version_id": str(r["id"]), "label": r.get("label"),
                "run_at": r["run_at"].isoformat() if hasattr(r.get("run_at"), "isoformat") else r.get("run_at"),
                "rules": counts[str(r["id"])]} for r in runs]
    return {"run": data["run"], "module": module, "findings": data["findings"], "rules": wb.rule_meta(module),
            "values": values, "history": history, "drafts": drafts}


# ── deterministic layer (pure) ───────────────────────────────────────────────

def kind_of(cid: str, rule: dict, has_value: bool) -> str:
    """auto: a rule pipeline or verified draft sets the value; fill: a mandatory field is empty; pick: the value
    must come from a list or a reference table; review: a person decides."""
    from checks import auto_fix

    if has_value or auto_fix.enabled(rule):
        return "auto"
    if wb.is_required_rule(cid, rule):
        return "fill"
    if rule.get("check_class") in ("domain_value_check", "referential_check"):
        return "pick"
    return "review"


def pattern(values: list[str]) -> Optional[dict]:
    """Pattern counts of the failing values (masks, blanks, spaces, case); never a value."""
    if not values:
        return None
    sh = build_shape(pd.Series(values, dtype="object"))
    return {"listed": sh["total_failing"], "blank": sh["blank"], "masks": sh["masks"][:3],
            "leading_ws": sh["leading_ws"], "trailing_ws": sh["trailing_ws"], "inner_ws": sh["inner_ws"],
            "case": sh["case"]}


_CLASS_WHY = {
    "null_check": "the field is empty and the rule makes it mandatory",
    "exists_check": "the field or record the rule expects is missing",
    "domain_value_check": "the value is not one of the values the rule allows",
    "referential_check": "the value does not exist in the table it must point to",
    "regex_check": "the value does not match the format the rule requires",
    "format_check": "the value does not match the format the rule requires",
    "cross_field_check": "the value does not agree with another field on the same record",
    "uniqueness_check": "the value repeats where it must be unique",
    "freshness_check": "the record has not been updated within the period the rule allows",
    "interval_check": "the value falls outside the range the rule allows",
    "value_placement_check": "the value sits in a field meant for something else",
    "group_sum_check": "the values of a group do not add up as the rule requires",
}


def explain(cid: str, rule: dict, f: dict, pat: Optional[dict]) -> str:
    affected, total = int(f.get("affected_count") or 0), int(f.get("total_count") or 0)
    why = _CLASS_WHY.get(str(rule.get("check_class")), "the value fails the rule")
    out = f"{affected:,} of {total:,} records fail {cid} because {why}."
    if pat:
        bits = []
        if pat["blank"]:
            bits.append(f"{pat['blank']:,} are blank")
        if pat["masks"]:
            m = pat["masks"][0]
            bits.append(f"the most common shape is {m['mask']} ({m['count']:,})")
        ws = pat["leading_ws"] + pat["trailing_ws"]
        if ws:
            bits.append(f"{ws:,} carry leading or trailing spaces")
        if pat["case"]["lower"] or pat["case"]["mixed"]:
            bits.append(f"{pat['case']['lower'] + pat['case']['mixed']:,} are not in upper case")
        if bits:
            out += f" Of the {pat['listed']:,} listed, " + ", ".join(bits) + "."
    return out


def suggest(cid: str, rule: dict, f: dict, values: list[str], draft: Optional[dict]) -> Optional[dict]:
    """The fix Meridian can stand behind, with confidence (0..100) and what it rests on; None when only a person
    can decide. Every figure is computed here; nothing is guessed."""
    affected = int(f.get("affected_count") or 0)
    v = (draft or {}).get("verification") or {}
    if draft and draft.get("status") in ("pending", "approved") and v.get("fixed"):
        failing = int(v.get("failing") or affected or 1)
        ops = ", ".join(str(s.get("op")) for s in draft.get("steps") or [] if isinstance(s, dict))
        return {"value": ops, "source": "fix_draft", "covered": int(v["fixed"]), "base": failing,
                "confidence": round(100 * int(v["fixed"]) / failing),
                "evidence": f"Draft {draft.get('status')}: verified on the frame, {int(v['fixed']):,} of {failing:,} "
                            f"failing records pass after the steps, {int(v.get('broken') or 0):,} broken."}
    vfm = f.get("value_fix_map") or {}
    fixed = {k: x["suggested_value"] for k, x in vfm.items() if isinstance(x, dict) and x.get("suggested_value")}
    if fixed and values:
        hit = sum(1 for x in values if x in fixed)
        if hit:
            target = next(iter(dict.fromkeys(fixed.values())))
            return {"value": str(target), "source": "value_fix_map", "covered": hit, "base": len(values),
                    "confidence": round(100 * hit / len(values)),
                    "evidence": f"The rule allows one value; {hit:,} of {len(values):,} listed failing values map to it."}
    text_ = wb.auto_fix_text(rule)
    if text_:
        spec = rule.get("auto_fix")
        spec = spec if isinstance(spec, dict) else {}
        label = str(spec.get("confidence") or "medium")
        return {"value": text_, "source": "rule_auto_fix", "covered": affected, "base": affected,
                "confidence": _CONF.get(label, 60),
                "evidence": f"Rule {cid} carries an automatic fix rated {label}; it applies to all {affected:,} "
                            "failing records and is checked again on the next run."}
    return None


def instruction(kind: str, label: str, rules: list[str], affected: int) -> str:
    """Text for the cleaning workbook and the Fixes tab: one plain instruction per batch."""
    n = f"{affected:,} records"
    ids = ", ".join(rules)
    return {
        "auto": f"Review the suggested value for {label} on {n} (rules {ids}), then accept it in one batch. "
                "Meridian checks every record again on the next run.",
        "fill": f"Fill the mandatory field {label} on {n} (rules {ids}). Start with the sheet Required fields "
                "missing; it lists the records with the most blanks first.",
        "pick": f"Set {label} to a value from the allowed list or the reference table on {n} (rules {ids}). "
                "Records to clean shows each record's current value.",
        "review": f"Check {label} on {n} (rules {ids}) with the data owner; the rule text says what must hold. "
                  "Record the decision in Status and Comment.",
    }[kind]


def changes(history: list[dict]) -> dict:
    """Rule by rule against the object's previous run, plus a narrative sentence."""
    if len(history) < 2:
        return {"available": False, "previous": None, "new": [], "resolved": [], "worse": [], "better": [],
                "narrative": "This is the first run of this object; the next run is compared with it."}
    prev, cur = history[-2]["rules"], history[-1]["rules"]
    row = lambda c: {"rule": c, "before": prev.get(c, 0), "after": cur.get(c, 0)}  # noqa: E731
    new = [row(c) for c in sorted(cur) if c not in prev]
    resolved = [row(c) for c in sorted(prev) if c not in cur]
    worse = sorted((row(c) for c in cur if c in prev and cur[c] > prev[c]), key=lambda r: r["before"] - r["after"])
    better = sorted((row(c) for c in cur if c in prev and cur[c] < prev[c]), key=lambda r: r["after"] - r["before"])
    before, after = sum(prev.values()), sum(cur.values())
    trend = "fell" if after < before else "rose" if after > before else "held"
    parts = [f"Failing records {trend} from {before:,} to {after:,} since {history[-2].get('label') or 'the previous run'}."]
    if resolved:
        parts.append(f"{len(resolved)} {'rule now passes' if len(resolved) == 1 else 'rules now pass'}.")
    if new:
        parts.append(f"{len(new)} {'rule fails' if len(new) == 1 else 'rules fail'} for the first time.")
    if worse:
        w = worse[0]
        parts.append(f"{w['rule']} grew most, from {w['before']:,} to {w['after']:,}.")
    if better:
        b = better[0]
        parts.append(f"{b['rule']} improved most, from {b['before']:,} to {b['after']:,}.")
    return {"available": True, "previous": {k: history[-2].get(k) for k in ("version_id", "label", "run_at")},
            "new": new, "resolved": resolved, "worse": worse, "better": better, "narrative": " ".join(parts)}


def plan(findings: list[dict], rules: dict[str, dict], values: dict[str, list[str]], history: list[dict],
         drafts: dict[str, dict]) -> dict:
    items = []
    for f in findings:
        cid = f["check_id"]
        rule = rules.get(cid) or {}
        field = f.get("field") or rule.get("field") or ""
        vals = values.get(cid) or []
        pat = pattern(vals)
        sug = suggest(cid, rule, f, vals, drafts.get(cid))
        items.append({
            "rule": cid, "message": rule.get("message") or f.get("message") or "", "field": field,
            "field_label": wb.field_label(field), "severity": f.get("severity") or rule.get("severity") or "",
            "dimension": f.get("dimension") or "", "check_class": rule.get("check_class"),
            "affected": int(f.get("affected_count") or 0), "total": int(f.get("total_count") or 0),
            "pass_rate": f.get("pass_rate"), "kind": kind_of(cid, rule, sug is not None),
            "explanation": explain(cid, rule, f, pat), "pattern": pat, "suggestion": sug,
        })
    items.sort(key=lambda x: (wb.SEVERITY_ORDER.get(str(x["severity"]), 9), -x["affected"], x["rule"]))
    groups: dict[tuple[str, str], list[dict]] = {}
    for x in items:
        groups.setdefault((x["kind"], x["field"]), []).append(x)
    batches = []
    for (kind, field), xs in groups.items():
        affected = sum(x["affected"] for x in xs)
        ids = [x["rule"] for x in xs]
        label = xs[0]["field_label"] or field or "the fields the rule names"
        batches.append({"id": f"{kind}:{field}", "kind": kind, "field": field, "field_label": xs[0]["field_label"],
                        "rules": ids, "affected": affected,
                        "suggested": sum(1 for x in xs if x["suggestion"]),
                        "instruction": instruction(kind, label, ids, affected),
                        "evidence": f"{len(ids)} {'rule' if len(ids) == 1 else 'rules'} on {field or 'several fields'}, "
                                    f"{affected:,} failing records in this run."})
    batches.sort(key=lambda b: (KINDS.index(b["kind"]), -b["affected"], b["field"]))
    return {"items": items, "batches": batches, "changes": changes(history)}


# ── engine layer ─────────────────────────────────────────────────────────────

def engine_series(history: list[dict]) -> dict[str, list[float]]:
    """Everything the engine is sent: ``rule:<id>`` mapped to its failure count in each run, oldest first."""
    ids = sorted({c for h in history for c in h["rules"]})
    return {f"rule:{c}": [float(h["rules"].get(c, 0)) for h in history] for c in ids}


def learn(history: list[dict]) -> dict:
    """Each failing rule's learned normal range of failures; available False plus a reason when it cannot run."""
    off = engine._gate(len(history), LEARN_MIN_RUNS)
    if off:
        return {**off, "ranges": []}
    series = engine_series(history)
    res = engine._call(f"/api/{engine._tenant()}/learn", series)
    if res is None:
        return {"available": False, "reason": "engine_error", "ranges": []}
    out = []
    for k, b in (res.get("benchmarks") or {}).items():
        if not str(k).startswith("rule:") or k not in series:
            continue
        latest = series[k][-1]
        low, high = b.get("low"), b.get("high")
        outside = isinstance(low, (int, float)) and isinstance(high, (int, float)) and not (low <= latest <= high)
        out.append({"rule": k[5:], "mean": b.get("mean"), "low": low, "high": high, "n": b.get("n"),
                    "latest": latest, "outside": outside})
    out.sort(key=lambda r: (not r["outside"], r["rule"]))
    return {"available": True, "reason": None, "ranges": out}


def build(data: dict, use_engine: bool = True) -> dict:
    out = plan(data["findings"], data["rules"], data["values"], data["history"], data["drafts"])
    eng = learn(data["history"]) if use_engine else {"available": False, "reason": "not_configured", "ranges": []}
    n = len(data["history"])
    run = data["run"]
    return {"version_id": str(run["id"]), "run_label": run.get("label"), "module": data["module"], **out,
            "engine": {**eng, "runs": n,
                       "evidence": {"inputs": [f"Failure counts of {len(engine_series(data['history']))} rules over "
                                               f"{n} runs of this object (rule ids and counts only, no record values)"],
                                    "method": "Aletheia self-learning (POST /learn) of each rule's normal range of "
                                              "failing records; the latest run is flagged when it sits outside.",
                                    "confidence": None, "runs": n,
                                    "first_run": data["history"][0]["run_at"] if n else None,
                                    "last_run": data["history"][-1]["run_at"] if n else None}}}


def workbook_rows(p: dict) -> list[dict]:
    """Rows for the cleaning workbook's Fix batches sheet."""
    return [{"order": i, "kind": {"auto": "Suggested fix", "fill": "Fill mandatory field", "pick": "Pick allowed value",
                                  "review": "Owner review"}[b["kind"]],
             "field": b["field_label"] or b["field"], "rules": ", ".join(b["rules"]), "affected": b["affected"],
             "instruction": b["instruction"], "evidence": b["evidence"]} for i, b in enumerate(p["batches"], 1)]


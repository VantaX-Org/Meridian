"""Cleaning workbook: one object's failing records for one run, with what to change and how.

One workbook per object (module). Sheets:

* How to use: the working steps for the people who clean the data.
* Summary: one row per failing rule with its counts.
* Instructions: one row per failing rule with why it matters, the business impact and the fix steps.
* Records to clean: one row per failing record and rule, with the current value, a suggested value
  where the rule can derive one, the reason it failed and the record's own instruction, plus blank
  columns for the corrected value, owner, status and comment. Split over numbered sheets when a
  module has more rows than one sheet holds.

The suggested value comes from the run's stored proposal for that record, else the rule's
``auto_fix`` pipeline run on the record, else the run's per-value suggestion. A record with none
of these is left blank for the data owner; nothing is invented.

Layers match workbook_report: sync loaders, a pure ``cleaning_context`` that returns SheetSpecs,
and ``build`` that renders bytes.
"""
import json
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.branded_xlsx import ROW_CAP, ColumnSpec, ConditionalRule, SheetSpec, build_workbook, xlsx_filename
from api.services.pdf_reports import _all, fmt_module
from api.services.sf_roundtrip import MARKER, marker_rows

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
STATUSES = ("Open", "In progress", "Fixed", "Not an error")


# ── loaders ──────────────────────────────────────────────────────────────────

_FINDINGS_SQL = """
SELECT check_id, severity, dimension, affected_count, total_count, pass_rate,
       details->>'field_checked' AS field, details->>'message' AS message, value_fix_map, record_fixes
  FROM findings
 WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m AND COALESCE(affected_count, 0) > 0
 ORDER BY check_id"""

_RECORDS_SQL = """
SELECT check_id, grain, record_key, field_values
  FROM finding_records
 WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m
 ORDER BY check_id, record_key"""


def listed_note(affected: int, listed: int) -> str:
    """Say when the file holds fewer rows than the rule counted, so nobody signs off a partial list."""
    if listed >= affected:
        return ""
    return (f"{affected - listed:,} of {affected:,} failing records are not listed. The run stores at most "
            "100,000 records per rule and one row per record key. Fix the listed rows and rerun to see the rest.")


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def rule_meta(module: str) -> dict[str, dict]:
    """rule id -> the raw YAML rule for this module (first definition wins)."""
    from api.services.tenant_seed import raw_rules

    out: dict[str, dict] = {}
    for _cat, _src, mod, r in raw_rules():
        if mod == module:
            out.setdefault(str(r["id"]), r)
    return out


def load(s: Session, tid: str, vid: str, module: str) -> Optional[dict]:
    run = _all(s, "SELECT id, label, run_at FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t",
               v=vid, t=tid)
    if not run:
        return None
    findings = _all(s, _FINDINGS_SQL, t=tid, v=vid, m=module)
    for f in findings:
        f["value_fix_map"] = _json(f["value_fix_map"]) or {}
        f["record_fixes"] = _json(f["record_fixes"]) or []
    rows = s.execute(text(_RECORDS_SQL), {"t": tid, "v": vid, "m": module}).mappings()
    return {"run": run[0], "module": module, "findings": findings,
            "records": ({**r, "field_values": _json(r["field_values"]) or {}} for r in rows),
            "tenant_name": s.execute(text("SELECT name FROM tenants WHERE id = :t"), {"t": tid}).scalar() or ""}


# ── per-record logic (pure) ──────────────────────────────────────────────────

def record_dict(grain: Optional[str], record_key: Optional[str], field_values: dict) -> dict:
    """The record as the rule sees it: the checked fields plus the key parts, qualified by table."""
    out: dict[str, Any] = {}
    for part in (record_key or "").split("|"):
        k, sep, v = part.partition("=")
        if sep and k:
            out[f"{grain}.{k}" if grain and "." not in k else k] = v
    out.update(field_values or {})
    return out


def current_value(field: Optional[str], field_values: dict) -> str:
    """The checked field's value; for a multi-field rule every field as ``FIELD=value``."""
    if field and field in field_values:
        v = field_values[field]
        return "" if v is None else str(v)
    if len(field_values) == 1:
        v = next(iter(field_values.values()))
        return "" if v is None else str(v)
    return "; ".join(f"{k}={'' if v is None else v}" for k, v in field_values.items())


def fix_text(fix_map: dict, value: str) -> str:
    from checks.fix_generator import FixGenerator

    return FixGenerator().get_fix_instruction(value, fix_map or {}) if fix_map else ""


def render(template: Optional[str], record: dict, value: str, instruction: str) -> str:
    """``record_fix_template`` with ``{TABLE.FIELD}``, ``{actual_value}`` and ``{fix_instruction}`` filled."""
    if not template:
        return instruction
    out = template.replace("{actual_value}", value).replace("{invalid_value}", value)
    out = out.replace("{fix_instruction}", instruction)
    for k, v in record.items():
        out = out.replace("{" + k + "}", "" if v is None else str(v))
    return out


def reason(value: str, message: str) -> str:
    return f"The value is blank. {message}".strip() if value.strip() in ("", "nan", "None") else \
        f"The value '{value}' fails the rule. {message}".strip()


def suggestion(rule: dict, record: dict, stored: Optional[dict], vfm: dict, value: str) -> tuple[str, str, str]:
    """(suggested value, source, confidence); all blank when nothing can be derived."""
    if stored and stored.get("proposed_value") not in (None, ""):
        return str(stored["proposed_value"]), "Run proposal", str(stored.get("confidence") or "")
    if rule.get("auto_fix") or rule.get("fix_value") is not None:
        try:
            from checks.auto_fix import propose

            hit = propose(rule, record)
        except Exception:  # a pipeline that cannot run on a partial record suggests nothing
            hit = None
        if hit and hit[0] not in (None, "") and str(hit[0]) != value:
            return str(hit[0]), "Rule auto-fix", str(hit[1] or "")
    sv = ((vfm or {}).get(value) or {}).get("suggested_value")
    if sv not in (None, ""):
        return str(sv), "Value suggestion", ""
    return "", "", ""


def fix_steps(rule: dict) -> str:
    """The rule's fix_map as numbered lines a person can follow."""
    fm = rule.get("fix_map") or {}
    lines: list[str] = []
    for k, v in fm.items():
        label = {"__blank__": "When blank", "__null__": "When null", "__other__": "Any other value"}.get(k, f"When '{k}'")
        body = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
        lines.append(f"{len(lines) + 1}. {label}: {body.replace('{invalid_value}', 'the value')}")
    return "\n".join(lines)


def auto_fix_text(rule: dict) -> str:
    spec = rule.get("auto_fix")
    if isinstance(spec, dict) and spec.get("steps"):
        ops = ", ".join(str(s.get("op")) for s in spec["steps"] if isinstance(s, dict))
        return f"{ops} (confidence {spec.get('confidence') or 'medium'})"
    if rule.get("fix_value") is not None:
        return "Set to the rule's default value (confidence medium)"
    return ""


# ── sheets (pure) ────────────────────────────────────────────────────────────

_SEV_FILL = {"critical": "F8D7DA", "high": "FCE5CD", "medium": "FFF2CC", "low": "E2EFDA"}


def _rows(findings: list[dict], records: Iterable[dict], rules: dict[str, dict]) -> list[dict]:
    by_check = {f["check_id"]: f for f in findings}
    stored = {(f["check_id"], x.get("record_key")): x for f in findings for x in f["record_fixes"]
              if isinstance(x, dict) and x.get("record_key")}
    out = []
    for r in records:
        f = by_check.get(r["check_id"])
        if f is None:
            continue
        rule = rules.get(r["check_id"]) or {}
        field = f.get("field") or rule.get("field")
        fv = r["field_values"] or {}
        value = current_value(field, fv)
        rec = record_dict(r.get("grain"), r.get("record_key"), fv)
        message = rule.get("message") or f.get("message") or ""
        instruction = fix_text(rule.get("fix_map") or {}, value)
        st = stored.get((r["check_id"], r.get("record_key")))
        sv, src, conf = suggestion(rule, rec, st, f["value_fix_map"], value)
        out.append({
            "severity": f.get("severity") or rule.get("severity") or "", "rule": r["check_id"], "message": message,
            "table": r.get("grain") or "", "record_key": r.get("record_key") or "", "field": field or "",
            "current": value, "suggested": sv, "source": src, "confidence": conf, "why": reason(value, message),
            "instruction": (st or {}).get("fix_instruction") or render(rule.get("record_fix_template"), rec, value,
                                                                       instruction) or instruction,
            "corrected": "", "owner": "", "status": "Open", "comment": "",
        })
    out.sort(key=lambda x: (SEVERITY_ORDER.get(str(x["severity"]), 9), x["rule"], x["record_key"]))
    return out


def _guide(module: str) -> list[dict]:
    steps = [
        ("Start with Summary", "Each row is one failing rule. Work critical and high rules first."),
        ("Read the instruction", "Instructions explains why each rule matters, what breaks in SAP and how to fix it."),
        ("Clean the records", "Records to clean lists every failing record. Current value is what the system holds now."),
        ("Use the suggestion", "Suggested value is filled only where the rule can derive one. Check it before use."),
        ("Record your fix", "Type the value you set in Corrected value. Fill Owner and set Status."),
        ("Fix at source", "Make the change in the source system, then run the analysis again to confirm it passes."),
        ("Not an error", "When a record is right as it is, set Status to Not an error and say why in Comment."),
    ]
    return [{"n": i + 1, "step": s, "what": w.replace("{module}", fmt_module(module))} for i, (s, w) in enumerate(steps)]


def cleaning_context(data: dict, rules: dict[str, dict]) -> tuple[list[SheetSpec], dict]:
    """The sheets plus counts ``{rules, records, suggested}`` for the caller."""
    findings = data["findings"]
    rows = _rows(findings, data["records"], rules)
    per_rule: dict[str, int] = {}
    for x in rows:
        per_rule[x["rule"]] = per_rule.get(x["rule"], 0) + 1
    sev = ColumnSpec("severity", "Severity", fill_by_value=_SEV_FILL, width=10)

    summary = [{
        "severity": f.get("severity") or "", "rule": f["check_id"],
        "message": (rules.get(f["check_id"]) or {}).get("message") or f.get("message") or "",
        "dimension": f.get("dimension") or "", "field": f.get("field") or (rules.get(f["check_id"]) or {}).get("field") or "",
        "affected": f.get("affected_count") or 0, "total": f.get("total_count") or 0,
        "pass_rate": f.get("pass_rate"), "listed": per_rule.get(f["check_id"], 0),
    } for f in findings]
    for x in summary:
        x["coverage"] = listed_note(int(x["affected"] or 0), int(x["listed"] or 0))
    summary.sort(key=lambda x: (SEVERITY_ORDER.get(str(x["severity"]), 9), -int(x["affected"] or 0), x["rule"]))

    instr = []
    for x in summary:
        r = rules.get(x["rule"]) or {}
        instr.append({"severity": x["severity"], "rule": x["rule"], "message": x["message"], "field": x["field"],
                      "why": r.get("why_it_matters") or "", "impact": r.get("sap_impact") or "",
                      "authority": str(r.get("rule_authority") or "").replace("_", " "),
                      "steps": fix_steps(r), "auto": auto_fix_text(r), "affected": x["affected"]})

    rec_cols = [
        sev, ColumnSpec("rule", "Rule", "mono", width=12), ColumnSpec("message", "Rule text", width=50),
        ColumnSpec("table", "Table", "mono", width=18), ColumnSpec("record_key", "Record key", "mono", width=36),
        ColumnSpec("field", "Field", "mono", width=28), ColumnSpec("current", "Current value", "mono", width=24),
        ColumnSpec("suggested", "Suggested value", "mono", width=24), ColumnSpec("source", "Suggestion from", width=16),
        ColumnSpec("confidence", "Confidence", width=11), ColumnSpec("why", "Why it failed", width=50),
        ColumnSpec("instruction", "What to do", width=60), ColumnSpec("corrected", "Corrected value", "mono", width=20),
        ColumnSpec("owner", "Owner", width=18), ColumnSpec("status", "Status", width=13, choices=STATUSES),
        ColumnSpec("comment", "Comment", width=30),
    ]
    sheets = [
        SheetSpec("How to use", [ColumnSpec("n", "Step", "int", width=6), ColumnSpec("step", "Step name", width=22),
                                 ColumnSpec("what", "What to do", width=90)], _guide(data["module"])),
        SheetSpec("Summary", [sev, ColumnSpec("rule", "Rule", "mono", width=12),
                              ColumnSpec("message", "Rule text", width=60), ColumnSpec("dimension", "Dimension", width=14),
                              ColumnSpec("field", "Field", "mono", width=28),
                              ColumnSpec("affected", "Records failing", "int"), ColumnSpec("total", "Records checked", "int"),
                              ColumnSpec("pass_rate", "Pass rate", "pct"), ColumnSpec("listed", "Rows in this file", "int"),
                              ColumnSpec("coverage", "Listing note", width=50)],
                  summary, note="One row per failing rule, most severe first.", totals=["affected", "listed"],
                  rules=[ConditionalRule("affected", "databar")]),
        SheetSpec("Instructions", [sev, ColumnSpec("rule", "Rule", "mono", width=12),
                                   ColumnSpec("message", "Rule text", width=45), ColumnSpec("field", "Field", "mono", width=26),
                                   ColumnSpec("why", "Why it matters", width=60),
                                   ColumnSpec("impact", "What breaks in SAP", width=50),
                                   ColumnSpec("authority", "Source of the rule", width=16),
                                   ColumnSpec("steps", "How to fix", width=80),
                                   ColumnSpec("auto", "Automatic fix", width=26),
                                   ColumnSpec("affected", "Records failing", "int")], instr,
                  note="Why each rule matters and how to fix it."),
    ]
    chunks = [rows[i:i + ROW_CAP] for i in range(0, len(rows), ROW_CAP)] or [[]]
    for i, chunk in enumerate(chunks):
        title = "Records to clean" if len(chunks) == 1 else f"Records to clean {i + 1}"
        note = "Every failing record with its value, suggestion and instruction."
        if len(chunks) > 1:
            note += f" Part {i + 1} of {len(chunks)}."
        sheets.append(SheetSpec(title, rec_cols, chunk, note=note))
    counts = {"rules": len(summary), "records": len(rows), "suggested": sum(1 for x in rows if x["suggested"])}
    return sheets, counts


def build(s: Session, tid: str, vid: str, module: str,
          generated_at: Optional[datetime] = None) -> Optional[tuple[bytes, str]]:
    data = load(s, tid, vid, module)
    if data is None:
        return None
    generated_at = generated_at or datetime.now(timezone.utc)
    sheets, _ = cleaning_context(data, rule_meta(module))
    run = data["run"]
    # hidden and last: tells the upload-back which run and object this file came from (api/services/sf_roundtrip.py)
    sheets.append(SheetSpec(MARKER, [ColumnSpec("key", "key"), ColumnSpec("value", "value")],
                            marker_rows(str(run["id"]), module, "cleaning"), hidden=True))
    label = run.get("label") or str(run["id"])[:8]
    body = build_workbook(tenant_name=data["tenant_name"], run_label=label, run_id=str(run["id"]),
                          title=f"Cleaning workbook: {fmt_module(module)}", sheets=sheets, generated_at=generated_at)
    return body, xlsx_filename(f"cleaning-{module.replace('_', '-')}", label, generated_at)

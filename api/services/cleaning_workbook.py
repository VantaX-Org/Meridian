"""Cleaning workbook: one object's failing records for one run, with what to change and how.

One workbook per object (module). Sheets:

* How to use: plain-language steps for the people who clean the data.
* Column guide: what every column is and whether you fill it in or leave it alone.
* Summary: one row per failing rule with its counts, including required fields left empty.
* Instructions: one row per failing rule with why it matters, the business impact and the fix steps.
* Records to clean: one row per failing record and rule, with the current value, a suggested value
  where the rule can derive one, the reason it failed and the record's own instruction, plus blank
  columns for the corrected value, owner, status and comment. Split over numbered sheets when a
  module has more rows than one sheet holds. Rows where a required field is empty come first.
* Required fields missing: only the records whose required field is blank, grouped by field with
  the field with the most blanks first, so the owner knows what to fill first.

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
from api.services.upload_checks import fingerprint

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
STATUSES = ("Open", "In progress", "Needs owner", "Fixed", "Not an error")


# ── loaders ──────────────────────────────────────────────────────────────────

_FINDINGS_SQL = """
SELECT check_id, severity, dimension, affected_count, total_count, pass_rate,
       details->>'field_checked' AS field, details->>'message' AS message, value_fix_map, record_fixes
  FROM findings
 WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m AND COALESCE(affected_count, 0) > 0
 ORDER BY check_id"""

_RECORDS_SQL = """
SELECT check_id, grain, record_key, field_values
  FROM finding_records fr
 WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m
   -- a record marked Not an error (accepted) on this system leaves the workbook
   AND NOT EXISTS (SELECT 1 FROM record_issues ri
                    WHERE ri.tenant_id = :t AND ri.module = :m AND ri.status = 'accepted'
                      AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
                      AND ri.scope = (SELECT COALESCE(av.metadata->>'system_id', 'upload') FROM analysis_versions av
                                       WHERE av.id = CAST(:v AS uuid) AND av.tenant_id = :t))
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


class DownloadRefused(ValueError):
    """The chosen run cannot make a workbook for this object (message safe to show)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def refuse_download(run: dict, module: str) -> None:
    """The run must be finished and hold the object, or the workbook would not match what is uploaded back."""
    if "complete" not in str(run.get("status") or ""):
        raise DownloadRefused(409, "That run has not finished. Wait for it, or choose a finished run.")
    mods = run.get("modules")
    if isinstance(mods, str):
        mods = json.loads(mods)
    if mods and module not in mods:
        raise DownloadRefused(422, f"That run does not hold {module}. Choose the run that does.")


def load(s: Session, tid: str, vid: str, module: str) -> Optional[dict]:
    run = _all(s, "SELECT id, label, run_at, status, metadata->>'system_id' AS system_id, "
                  "COALESCE(metadata->'modules', '[]'::jsonb) AS modules FROM analysis_versions "
                  "WHERE id = CAST(:v AS uuid) AND tenant_id = :t",
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


BLANKS = ("", "nan", "none", "00000000", "000000")


def is_required_rule(check_id: str, rule: dict) -> bool:
    """A rule that insists a field is populated: a null check, or a field-status rule for a required field."""
    return rule.get("check_class") == "null_check" or (check_id.startswith("FS-") and check_id.endswith("-REQ"))


def required_empty(check_id: str, rule: dict, value: str) -> bool:
    return is_required_rule(check_id, rule) and value.strip().lower() in BLANKS


CLEAR = "#CLEAR"  # typed in Corrected value to empty the field; a blank cell is never an edit


def allowed_values(rule: dict) -> list[str]:
    """The rule's own permitted values (its allowed_values list, or the keys of valid_values_with_labels)."""
    for src in (rule, rule.get("params") or {}):
        if not isinstance(src, dict):
            continue
        vals = src.get("allowed_values")
        if isinstance(vals, list) and vals:
            return [str(v) for v in vals]
        labels = src.get("valid_values_with_labels")
        if isinstance(labels, dict) and labels:
            return [str(k) for k in labels]
    return []


def field_label(field: str) -> str:
    """``TABLE.FIELD (description)`` from the data dictionary; the bare name when it has no description."""
    if not field:
        return ""
    from sap.ddic import get_dictionary

    for release in ("s4hana", "ecc6"):
        f = get_dictionary(release).resolve(field)
        if f is not None and f.description:
            return f"{field} ({f.description})"
    return field


def rule_steps(rule: dict, required: bool) -> str:
    """Numbered steps: find the record, the rule's own fix steps, then record the fix."""
    own = [ln.split(". ", 1)[1] for ln in fix_steps(rule).splitlines() if ". " in ln]
    first = ("Find the records where the required field is empty (Required field empty = Yes in Records to clean)."
             if required else "Find the failing records for this rule in Records to clean (filter on the Rule column).")
    steps = [first, *own, f"Type the correct value in Corrected value ({CLEAR} empties the field), then set Status.",
             "Upload the file on the object's Fixes tab: Meridian scores a cleaned copy of the run.",
             "Make the same change in the source system; the next extraction confirms it passes."]
    return "\n".join(f"{i}. {t}" for i, t in enumerate(steps, 1))


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
        allowed = allowed_values(rule)
        req = required_empty(r["check_id"], rule, value)
        out.append({
            "severity": f.get("severity") or rule.get("severity") or "", "rule": r["check_id"], "message": message,
            "table": r.get("grain") or "", "record_key": r.get("record_key") or "", "field": field_label(field or ""),
            "required": "Yes" if req else "",
            "allowed": allowed,
            "current": value, "suggested": sv, "source": src, "confidence": conf, "why": reason(value, message),
            "instruction": (st or {}).get("fix_instruction") or render(rule.get("record_fix_template"), rec, value,
                                                                       instruction) or instruction,
            "corrected": "", "owner": "", "status": "Open", "comment": "",
        })
    out.sort(key=lambda x: (x["required"] != "Yes", SEVERITY_ORDER.get(str(x["severity"]), 9), x["rule"],
                            x["record_key"]))
    return out


def _guide(module: str) -> list[dict]:
    steps = [
        ("What this file is", "A list of the {module} records that failed Meridian's checks, with what to change. "
                              "Nothing here changes your system. You fix the records in the source system."),
        ("Start with Summary", "Each row is one failing rule. Work the most severe rules first. "
                               "The column Required fields empty shows how many records have a mandatory field left blank."),
        ("Fill required fields first", "The sheet Required fields missing lists records where a mandatory field is "
                                       "blank, field by field. Fill the field at the top first: it clears the most records."),
        ("Read the instructions", "Instructions says why each rule matters and gives numbered steps to fix it."),
        ("Work through Records to clean", "One row per failing record. Current value is what the system holds now. "
                                          "Suggested value is filled only where the rule can work one out, so check it before you use it."),
        ("Fill the green columns only", "Green columns are yours: Corrected value, Owner, Status and Comment. "
                                        "The other columns are locked: they tell Meridian which record and field "
                                        "each row is. Do not delete or reorder rows, and do not rename sheets."),
        ("Type the corrected value", "Where a field has a fixed list, Corrected value offers it as a drop-down and "
                                     "the Allowed values sheet lists it. The Examples sheet shows worked values. "
                                     "A blank cell changes nothing. To empty a field on purpose, type " + CLEAR + "."),
        ("Mark the status", "Pick Open, In progress, Needs owner, Fixed or Not an error from the list in Status. "
                            "If a record is right as it is, choose Not an error and say why in Comment: once an "
                            "approver uploads it, the issue stops showing on later runs. Owner and Comment are "
                            "saved on the issue."),
        ("Upload the file back", "Save the file and upload it on the {module} Fixes tab with Upload cleaned file. "
                                 "Meridian writes your corrected values into a cleaned copy of this run and scores it "
                                 "again, so you see the new score at once. Upload the file against the run it came "
                                 "from; a file from an older run is refused."),
        ("Fix the source system", "The cleaned copy is a forecast, not a change in SAP. Make the same changes in the "
                                  "source system. The next extraction shows which fixes are in the source and which "
                                  "are still waiting (Fix not yet in source)."),
    ]
    return [{"n": i + 1, "step": s, "what": w.replace("{module}", fmt_module(module))} for i, (s, w) in enumerate(steps)]


_STATUS_HELP = {
    "Open": "Nobody has started on this record.", "In progress": "Someone is fixing it now.",
    "Needs owner": "Nobody owns this record yet. Name an owner in Owner or pass it on.",
    "Fixed": "You changed it in the source system. Type the new value in Corrected value.",
    "Not an error": "The record is right as it is. Say why in Comment.",
}


def _extras(data: dict, rows: list[dict], rules: dict[str, dict], summary: list[dict], n_required: int) -> list[SheetSpec]:
    """Start here, Allowed values and Examples: the sheets that tell a first-time reader what to do and what to type."""
    run = data.get("run") or {}
    start = [
        {"item": "Object", "what": fmt_module(data["module"])},
        {"item": "Run", "what": str(run.get("label") or str(run.get("id") or "")[:8])},
        {"item": "Failing rules", "what": f"{len(summary):,}"},
        {"item": "Failing records listed", "what": f"{len(rows):,}"},
        {"item": "Required fields empty", "what": f"{n_required:,} (fill these first)"},
        {"item": "Step 1", "what": "Read Instructions for what each rule needs."},
        {"item": "Step 2", "what": "Open Records to clean. Type the right value in Corrected value, one row per record and rule. "
                                    "The grey columns are locked: they tell the file which record you mean."},
        {"item": "Step 3", "what": "Set Status and Owner. Use Allowed values for the codes a field accepts and Examples to see how others look."},
        {"item": "Step 4", "what": "Save with the same name and upload it to Meridian. Rows with no Corrected value are left alone."},
    ]
    allowed = [{"rule": "", "field": "Status", "value": k, "meaning": v} for k, v in _STATUS_HELP.items()]
    for f in summary:
        r = rules.get(f["rule"]) or {}
        allowed += [{"rule": f["rule"], "field": f["field"], "value": v, "meaning": ""} for v in allowed_values(r)[:200]]
    seen: dict[str, int] = {}
    examples = []
    for x in rows:
        if x["suggested"] and seen.get(x["rule"], 0) < 2:
            seen[x["rule"]] = seen.get(x["rule"], 0) + 1
            examples.append({"rule": x["rule"], "field": x["field"], "record_key": x["record_key"],
                             "current": x["current"], "corrected": x["suggested"], "why": x["why"]})
    return [
        SheetSpec("Start here", [ColumnSpec("item", "Item", width=26), ColumnSpec("what", "Detail", width=100)], start,
                  note="Read this first: what the file is and the four steps."),
        SheetSpec("Allowed values", [ColumnSpec("rule", "Rule", "mono", width=12), ColumnSpec("field", "Field", "mono", width=40),
                                     ColumnSpec("value", "Allowed value", "mono", width=28),
                                     ColumnSpec("meaning", "Meaning", width=70)], allowed,
                  note="The values you can type. Status values first, then the codes each rule accepts."),
        SheetSpec("Examples", [ColumnSpec("rule", "Rule", "mono", width=12), ColumnSpec("field", "Field", "mono", width=40),
                               ColumnSpec("record_key", "Record key", "mono", width=36),
                               ColumnSpec("current", "Current value", "mono", width=24),
                               ColumnSpec("corrected", "What to type", "mono", width=24),
                               ColumnSpec("why", "Why", width=60)], examples,
                  note="Up to two real records per rule where Meridian can work out the fix."),
    ]


def _template(rows: list[dict], rules: dict[str, dict]) -> SheetSpec:
    """Fix template: one row per field to fix, its code with description beside it, required flag and accepted values."""
    by: dict[str, dict] = {}
    for x in rows:
        t = by.setdefault(x["field"], {"rules": set(), "n": 0, "req": False, "vals": []})
        t["rules"].add(x["rule"])
        t["n"] += 1
        t["req"] = t["req"] or bool(x["required"])
        t["vals"] += [v for v in allowed_values(rules.get(x["rule"]) or {}) if v not in t["vals"]]
    out = []
    for f, t in sorted(by.items()):
        code, _, desc = f.partition(" (")  # row fields are "CODE (description)"
        out.append({"field": code, "description": desc.rstrip(")"),
                    "required": "Yes" if t["req"] else "", "allowed": ", ".join(t["vals"][:30]),
                    "rules": ", ".join(sorted(t["rules"])), "records": t["n"]})
    return SheetSpec("Fix template", [
        ColumnSpec("field", "Field", "mono", width=40, help="The field code, as in Records to clean."),
        ColumnSpec("description", "Description", width=40, help="What the field means."),
        ColumnSpec("required", "Required", width=10, fill_by_value={"Yes": "F8D7DA"}, help="Yes when the field is mandatory."),
        ColumnSpec("allowed", "Allowed values", "mono", width=50, help="Codes the field accepts, where the rules list them."),
        ColumnSpec("rules", "Rules", "mono", width=24, help="The rules that check this field."),
        ColumnSpec("records", "Rows to fix", "int", width=10)], out,
        note="The fields you will edit: code, meaning, whether it is mandatory and the values it accepts.")


def cleaning_context(data: dict, rules: dict[str, dict]) -> tuple[list[SheetSpec], dict]:
    """The sheets plus counts ``{rules, records, suggested, required_empty}`` for the caller."""
    findings = data["findings"]
    rows = _rows(findings, data["records"], rules)
    per_rule: dict[str, int] = {}
    req_rule: dict[str, int] = {}
    for x in rows:
        per_rule[x["rule"]] = per_rule.get(x["rule"], 0) + 1
        if x["required"]:
            req_rule[x["rule"]] = req_rule.get(x["rule"], 0) + 1
    sev = ColumnSpec("severity", "Severity", fill_by_value=_SEV_FILL, width=10,
                     help="How serious the failure is: critical, high, medium or low.")

    summary = [{
        "severity": f.get("severity") or "", "rule": f["check_id"],
        "message": (rules.get(f["check_id"]) or {}).get("message") or f.get("message") or "",
        "dimension": f.get("dimension") or "",
        "field": field_label(f.get("field") or (rules.get(f["check_id"]) or {}).get("field") or ""),
        "affected": f.get("affected_count") or 0, "total": f.get("total_count") or 0,
        "pass_rate": f.get("pass_rate"), "listed": per_rule.get(f["check_id"], 0),
        "required": req_rule.get(f["check_id"], 0),
    } for f in findings]
    for x in summary:
        x["coverage"] = listed_note(int(x["affected"] or 0), int(x["listed"] or 0))
    summary.sort(key=lambda x: (SEVERITY_ORDER.get(str(x["severity"]), 9), -int(x["affected"] or 0), x["rule"]))

    instr = []
    for x in summary:
        r = rules.get(x["rule"]) or {}
        req = is_required_rule(x["rule"], r)
        instr.append({"severity": x["severity"], "rule": x["rule"], "message": x["message"], "field": x["field"],
                      "required": "Yes" if req else "",
                      "why": r.get("why_it_matters") or "", "impact": r.get("sap_impact") or "",
                      "authority": str(r.get("rule_authority") or "").replace("_", " "),
                      "steps": rule_steps(r, req), "auto": auto_fix_text(r), "affected": x["affected"]})

    # Required fields missing: the fields with the most blank records come first.
    miss = [x for x in rows if x["required"]]
    per_field: dict[str, int] = {}
    for x in miss:
        per_field[x["field"]] = per_field.get(x["field"], 0) + 1
    order = {f: i for i, f in enumerate(sorted(per_field, key=lambda f: (-per_field[f], f)), 1)}
    miss.sort(key=lambda x: (order[x["field"]], SEVERITY_ORDER.get(str(x["severity"]), 9), x["record_key"]))
    missing = [{"order": order[x["field"]], "field": x["field"], "count": per_field[x["field"]],
                "severity": x["severity"], "table": x["table"], "record_key": x["record_key"], "rule": x["rule"],
                "instruction": x["instruction"]} for x in miss]

    rec_cols = [
        sev,
        ColumnSpec("required", "Required field empty", width=12, fill_by_value={"Yes": "F8D7DA"},
                   help="Yes when the field is mandatory and has no value. Fill these first."),
        ColumnSpec("rule", "Rule", "mono", width=12, help="The check that failed. See Instructions for the fix."),
        ColumnSpec("message", "Rule text", width=50, help="What the rule requires, in words."),
        ColumnSpec("table", "Table", "mono", width=18, help="The table or entity the record lives in."),
        ColumnSpec("record_key", "Record key", "mono", width=36,
                   help="Identifies the record. Use it to find the record in the source system."),
        ColumnSpec("field", "Field", "mono", width=40,
                   help="The field that failed, with its description where one exists."),
        ColumnSpec("current", "Current value", "mono", width=24,
                   help="What the system holds now. Blank means nothing is stored."),
        ColumnSpec("suggested", "Suggested value", "mono", width=24,
                   help="A value Meridian worked out. Blank when it cannot work one out. Check it before you use it."),
        ColumnSpec("source", "Suggestion from", width=16, help="Where the suggestion came from."),
        ColumnSpec("confidence", "Confidence", width=11, help="How sure Meridian is about the suggestion."),
        ColumnSpec("why", "Why it failed", width=50, help="The reason this record fails the rule."),
        ColumnSpec("instruction", "What to do", width=60, help="The fix for this record."),
        ColumnSpec("corrected", "Corrected value", "mono", width=20, editable=True, row_choices_key="allowed",
                   help=f"Type the correct value. A blank cell changes nothing; {CLEAR} empties the field."),
        ColumnSpec("owner", "Owner", width=18, editable=True, help="Who is fixing this record."),
        ColumnSpec("status", "Status", width=13, choices=STATUSES, editable=True,
                   help="Pick one: Open, In progress, Needs owner, Fixed or Not an error."),
        ColumnSpec("comment", "Comment", width=30, editable=True,
                   help="Anything the next person should know. Say why when you choose Not an error."),
    ]
    guide_cols = [{"column": c.header, "who": "You fill this in" if c.editable else "Read only", "what": c.help}
                  for c in rec_cols]
    sheets = [
        SheetSpec("How to use", [ColumnSpec("n", "Step", "int", width=6), ColumnSpec("step", "Step name", width=30),
                                 ColumnSpec("what", "What to do", width=100)], _guide(data["module"])),
        SheetSpec("Column guide", [ColumnSpec("column", "Column in Records to clean", width=28),
                                   ColumnSpec("who", "Who", width=18, fill_by_value={"You fill this in": "E2F5E9"}),
                                   ColumnSpec("what", "What it is", width=90)], guide_cols,
                  note="What each column in Records to clean means, and which ones you fill in."),
        SheetSpec("Summary", [sev, ColumnSpec("rule", "Rule", "mono", width=12, help="The check that failed."),
                              ColumnSpec("message", "Rule text", width=60, help="What the rule requires."),
                              ColumnSpec("dimension", "Dimension", width=14,
                                         help="The kind of quality problem, such as completeness."),
                              ColumnSpec("field", "Field", "mono", width=40,
                                         help="The field checked, with its description."),
                              ColumnSpec("affected", "Records failing", "int", help="How many records fail this rule."),
                              ColumnSpec("total", "Records checked", "int", help="How many records the rule looked at."),
                              ColumnSpec("pass_rate", "Pass rate", "pct", help="Share of records that pass."),
                              ColumnSpec("listed", "Rows in this file", "int",
                                         help="How many failing records are listed here."),
                              ColumnSpec("required", "Required fields empty", "int",
                                         help="Records where a mandatory field has no value. Fill these first."),
                              ColumnSpec("coverage", "Listing note", width=50)],
                  summary, note="One row per failing rule, most severe first.",
                  totals=["affected", "listed", "required"], rules=[ConditionalRule("affected", "databar")]),
        SheetSpec("Required fields missing",
                  [ColumnSpec("order", "Fill order", "int", width=10,
                              help="1 is the field with the most blank records. Start there."),
                   ColumnSpec("field", "Field", "mono", width=40, help="The mandatory field that is empty."),
                   ColumnSpec("count", "Records empty", "int", width=10,
                              help="How many records have this field empty."),
                   sev, ColumnSpec("table", "Table", "mono", width=18),
                   ColumnSpec("record_key", "Record key", "mono", width=36, help="Use it to find the record."),
                   ColumnSpec("rule", "Rule", "mono", width=12), ColumnSpec("instruction", "What to do", width=60)],
                  missing, note="Records whose mandatory field is empty, field by field, most blanks first. "
                                "Record what you set in Records to clean."),
        SheetSpec("Instructions", [sev, ColumnSpec("rule", "Rule", "mono", width=12),
                                   ColumnSpec("message", "Rule text", width=45),
                                   ColumnSpec("field", "Field", "mono", width=40),
                                   ColumnSpec("required", "Required field", width=10,
                                              help="Yes when the rule makes this field mandatory."),
                                   ColumnSpec("why", "Why it matters", width=60),
                                   ColumnSpec("impact", "What breaks in SAP", width=50),
                                   ColumnSpec("authority", "Source of the rule", width=16),
                                   ColumnSpec("steps", "How to fix", width=80, help="Numbered steps. Follow them in order."),
                                   ColumnSpec("auto", "Automatic fix", width=26),
                                   ColumnSpec("affected", "Records failing", "int")], instr,
                  note="Why each rule matters and numbered steps to fix it."),
    ]
    chunks = [rows[i:i + ROW_CAP] for i in range(0, len(rows), ROW_CAP)] or [[]]
    for i, chunk in enumerate(chunks):
        title = "Records to clean" if len(chunks) == 1 else f"Records to clean {i + 1}"
        note = "Every failing record with its value, suggestion and instruction. Required fields that are empty come first."
        if len(chunks) > 1:
            note += f" Part {i + 1} of {len(chunks)}."
        sheets.append(SheetSpec(title, rec_cols, chunk, note=note, protect=True))
    sheets[:0] = _extras(data, rows, rules, summary, len(miss))
    sheets.insert(len(sheets) - len(chunks), _template(rows, rules))
    counts = {"rules": len(summary), "records": len(rows), "suggested": sum(1 for x in rows if x["suggested"]),
              "required_empty": len(miss)}
    return sheets, counts


def aletheia_plan_sheet(s: Session, tid: str, vid: str, module: str) -> Optional[SheetSpec]:
    """Fix batches with their instruction text and the change since the previous run (api/services/aletheia_cleaning.py,
    deterministic layer only, so the download never waits on the engine)."""
    from api.services import aletheia_cleaning as ac

    data = ac.load(s, tid, vid, module)
    if data is None:
        return None
    p = ac.build(data, use_engine=False)
    if not p["batches"]:
        return None
    cols = [ColumnSpec("order", "Order", "int", width=8), ColumnSpec("kind", "Kind of fix", width=22),
            ColumnSpec("field", "Field", width=34), ColumnSpec("rules", "Rules", width=30),
            ColumnSpec("affected", "Failing records", "int", width=14),
            ColumnSpec("instruction", "What to do", width=70), ColumnSpec("evidence", "Evidence", width=44)]
    return SheetSpec("Fix batches", cols, ac.workbook_rows(p), note=p["changes"]["narrative"])


def build(s: Session, tid: str, vid: str, module: str,
          generated_at: Optional[datetime] = None) -> Optional[tuple[bytes, str]]:
    data = load(s, tid, vid, module)
    if data is None:
        return None
    refuse_download(data["run"], module)
    generated_at = generated_at or datetime.now(timezone.utc)
    sheets, _ = cleaning_context(data, rule_meta(module))
    plan_sheet = aletheia_plan_sheet(s, tid, vid, module)
    if plan_sheet is not None:
        sheets.insert(next((i for i, sh in enumerate(sheets) if sh.title.startswith("Records to clean")), len(sheets)),
                      plan_sheet)
    run = data["run"]
    recs = [sh for sh in sheets if sh.title.startswith("Records to clean")]
    fp = fingerprint("cleaning", tid, run.get("system_id"), [c.header for c in recs[0].columns] if recs else [],
                     sum(1 for sh in recs for _ in sh.rows))
    # hidden and last: tells the upload-back which run and object this file came from (api/services/sf_roundtrip.py)
    sheets.append(SheetSpec(MARKER, [ColumnSpec("key", "key"), ColumnSpec("value", "value")],
                            marker_rows(str(run["id"]), module, "cleaning", None, fp), hidden=True))
    label = run.get("label") or str(run["id"])[:8]
    body = build_workbook(tenant_name=data["tenant_name"], run_label=label, run_id=str(run["id"]),
                          title=f"Cleaning workbook: {fmt_module(module)}", sheets=sheets, generated_at=generated_at)
    return body, xlsx_filename(f"cleaning-{module.replace('_', '-')}", label, generated_at)

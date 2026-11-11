"""Export centre: every dataset Meridian keeps, as xlsx, csv, json or (where a report exists) pdf.

One builder per dataset reads plain SQL with the tenant id in every query, applies the same filters
(system, object, run, severity), keeps only the columns asked for, and writes the file. Every code
column has a description column beside it (object name, field name, system name, check message),
so a spreadsheet reader never has to look a code up. Text cells go through the formula-injection
guard on every format. Everything is deterministic Python over stored data; no LLM is involved.

Called by the export task (workers/tasks/export_centre.py) and, for scheduled exports, by
report_history.generate_report (kinds ``export_<dataset>``).
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services.branded_xlsx import (
    ROW_CAP, ColumnSpec, SheetSpec, build_workbook, guard_formula_cell, xlsx_filename,
)
from api.services.version_status import finished_sql

FORMATS = ("xlsx", "csv", "json", "pdf")
SPLITS = ("none", "module", "severity", "run")
SEVERITIES = ("critical", "high", "medium", "low")
MIME = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv",
    "json": "application/json",
    "pdf": "application/pdf",
}


def object_label(module: Optional[str]) -> str:
    """Same words as frontend/lib/format.ts formatModuleName."""
    return " ".join(w.capitalize() for w in (module or "").split("_"))


def _field_desc(f: Optional[str]) -> Optional[str]:
    from api.services.fix_sheet import field_label

    return field_label(f)


def _json_text(v: Any) -> Optional[str]:
    if v in (None, {}, []):
        return None
    if isinstance(v, dict):
        return "; ".join(f"{k}={'' if x is None else x}" for k, x in v.items())
    return json.dumps(v, default=str)


def _side(data: Any, fld: Optional[str]) -> Any:
    """The changed field's value when the field is known, else the whole record as key=value text."""
    if isinstance(data, dict) and fld:
        name = fld.rpartition(".")[2]
        for k in (fld, name):
            if k in data:
                return data[k]
    return _json_text(data)


@dataclass(frozen=True)
class Dataset:
    name: str
    columns: list[ColumnSpec]
    query: Callable[[Session, str, dict], list[dict]]
    filters: tuple[str, ...]  # which of system, module, run, severity apply
    pdf_kind: Optional[str] = None  # report_history kind that renders this dataset as a pdf
    default_split: tuple[str, ...] = field(default=("none",))


# ── shared SQL pieces ────────────────────────────────────────────────────────

def _runs_cte(p: dict) -> str:
    """Finished runs in scope as CTE ``v`` (id, run_at, run_label, system_id, system_name)."""
    sys = ""
    if p.get("system"):
        sys = "AND COALESCE(av.metadata->>'system_id', 'upload') = :system"
    return f"""v AS (
        SELECT av.id, av.run_at, COALESCE(av.label, to_char(av.run_at, 'YYYY-MM-DD HH24:MI')) AS run_label,
               COALESCE(av.metadata->>'system_id', 'upload') AS system_id,
               COALESCE(s.name, CASE WHEN av.metadata->>'system_id' IS NULL THEN 'File upload' END) AS system_name
          FROM analysis_versions av
          LEFT JOIN sap_systems s ON s.tenant_id = av.tenant_id AND s.id::text = av.metadata->>'system_id'
         WHERE av.tenant_id = CAST(:t AS uuid) AND {finished_sql('av.status')} {sys})"""


def _run_pick(p: dict, alias: str) -> str:
    """Restrict ``alias`` (a table with version_id and module) to the chosen run: one version id,
    every run (``all``), or the latest run of each object (default)."""
    run = p.get("run") or "latest"
    if run == "all":
        return ""
    if run != "latest":
        return f"AND {alias}.version_id = CAST(:run AS uuid)"
    return f"""AND ({alias}.version_id, {alias}.module) IN (
        SELECT DISTINCT ON (f2.module) f2.version_id, f2.module
          FROM findings f2 JOIN v v2 ON v2.id = f2.version_id
         WHERE f2.tenant_id = CAST(:t AS uuid) ORDER BY f2.module, v2.run_at DESC)"""


def _where(p: dict, *, module: Optional[str] = None, severity: Optional[str] = None) -> str:
    out = []
    if module and p.get("module"):
        out.append(f"AND {module} = :module")
    if severity and p.get("severity"):
        out.append(f"AND {severity} = ANY(:severity)")
    return " ".join(out)


def _rows(session: Session, sql: str, tid: str, p: dict) -> list[dict]:
    bind = {"t": tid, "system": p.get("system"), "module": p.get("module"), "run": p.get("run"),
            "severity": list(p.get("severity") or []), "cap": ROW_CAP + 1}
    return [dict(r) for r in session.execute(text(sql), bind).mappings().all()]


# ── datasets ─────────────────────────────────────────────────────────────────

_RUN_COLS = [ColumnSpec("run_label", "Run"), ColumnSpec("run_at", "Run at", kind="datetime"),
             ColumnSpec("system_id", "System", kind="mono", muted=True), ColumnSpec("system_name", "System name")]
_OBJ_COLS = [ColumnSpec("module", "Object code", kind="mono"), ColumnSpec("object", "Object")]


def _findings(session: Session, tid: str, p: dict) -> list[dict]:
    rows = _rows(session, f"""
        WITH {_runs_cte(p)}
        SELECT v.run_label, v.run_at, v.system_id, v.system_name, f.version_id::text AS version_id, f.module,
               f.check_id, f.rule_context->>'message' AS message,
               COALESCE(f.details->>'field_checked', f.rule_context->>'field') AS field,
               f.severity, f.dimension, f.affected_count, f.total_count, f.pass_rate, f.cost_at_risk,
               f.impact_score, f.remediation_text, f.finding_type
          FROM findings f JOIN v ON v.id = f.version_id
         WHERE f.tenant_id = CAST(:t AS uuid) {_run_pick(p, 'f')} {_where(p, module='f.module', severity='f.severity')}
         ORDER BY v.run_at DESC, CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3
                  WHEN 'low' THEN 4 ELSE 5 END, f.pass_rate NULLS LAST, f.check_id
         LIMIT :cap""", tid, p)
    for r in rows:
        r["object"] = object_label(r["module"])
        r["field_description"] = _field_desc(r["field"])
        r["pass_rate"] = float(r["pass_rate"]) * 100 if r["pass_rate"] is not None else None
    return rows


def _failing_records(session: Session, tid: str, p: dict) -> list[dict]:
    rows = _rows(session, f"""
        WITH {_runs_cte(p)}
        SELECT v.run_label, v.run_at, v.system_id, v.system_name, fr.version_id::text AS version_id, fr.module,
               fr.check_id, f.rule_context->>'message' AS message, f.severity, fr.record_key, fr.grain,
               COALESCE(f.details->>'field_checked', f.rule_context->>'field') AS field,
               fr.field_values, fr.context, f.remediation_text
          FROM finding_records fr
          JOIN v ON v.id = fr.version_id
          LEFT JOIN findings f ON f.tenant_id = fr.tenant_id AND f.version_id = fr.version_id
                              AND f.module = fr.module AND f.check_id = fr.check_id
         WHERE fr.tenant_id = CAST(:t AS uuid) {_run_pick(p, 'fr')}
               {_where(p, module='fr.module', severity='f.severity')}
         ORDER BY v.run_at DESC, fr.module, fr.check_id, fr.record_key
         LIMIT :cap""", tid, p)
    for r in rows:
        r["object"] = object_label(r["module"])
        r["field_description"] = _field_desc(r["field"])
        values = r.pop("field_values")
        r["values"] = _json_text(values)
        r["reason"] = "; ".join(x for x in (r["message"], r["values"]) if x) or None
        r["context"] = _json_text(r["context"])
    return rows


def _cleansing(session: Session, tid: str, p: dict) -> list[dict]:
    sys = ("AND (q.version_id IS NULL OR q.version_id IN (SELECT id FROM v))" if not p.get("system")
           else "AND q.version_id IN (SELECT id FROM v)")
    run = p.get("run") or "latest"
    pick = "AND q.version_id = CAST(:run AS uuid)" if run not in ("latest", "all") else ""
    rows = _rows(session, f"""
        WITH {_runs_cte(p)}
        SELECT v.run_label, v.run_at, v.system_id, v.system_name, q.version_id::text AS version_id,
               q.object_type AS module, q.record_key, q.check_id, q.field, q.status, q.confidence,
               q.record_data_before, q.record_data_after, q.detected_at, q.applied_at, q.priority,
               COALESCE(u.name, '') AS approved_by
          FROM cleaning_queue q
          LEFT JOIN v ON v.id = q.version_id
          LEFT JOIN users u ON u.tenant_id = q.tenant_id AND u.id = q.approved_by
         WHERE q.tenant_id = CAST(:t AS uuid) {sys} {pick} {_where(p, module='q.object_type')}
         ORDER BY q.detected_at DESC, q.record_key
         LIMIT :cap""", tid, p)
    for r in rows:
        r["object"] = object_label(r["module"])
        r["field_description"] = _field_desc(r["field"])
        r["before"] = _side(r.pop("record_data_before"), r["field"])
        r["after"] = _side(r.pop("record_data_after"), r["field"])
        r["confidence"] = float(r["confidence"]) * 100 if r["confidence"] is not None else None
    return rows


def _changes(session: Session, tid: str, p: dict) -> list[dict]:
    rows = _rows(session, f"""
        SELECT a.created_at, a.action, a.actor_name, a.object_type AS module, a.record_key,
               q.check_id, q.field, a.data_before, a.data_after, q.version_id::text AS version_id
          FROM cleaning_audit a
          LEFT JOIN cleaning_queue q ON q.tenant_id = a.tenant_id AND q.id = a.queue_id
         WHERE a.tenant_id = CAST(:t AS uuid) {_where(p, module='a.object_type')}
               {"AND q.version_id = CAST(:run AS uuid)" if (p.get("run") or "latest") not in ("latest", "all") else ""}
         ORDER BY a.created_at DESC
         LIMIT :cap""", tid, p)
    for r in rows:
        r["object"] = object_label(r["module"])
        r["field_description"] = _field_desc(r["field"])
        r["before"] = _side(r.pop("data_before"), r["field"])
        r["after"] = _side(r.pop("data_after"), r["field"])
    return rows


def _score_history(session: Session, tid: str, p: dict) -> list[dict]:
    sys = ""
    if p.get("system"):
        sys = "AND COALESCE(h.system_id::text, 'upload') = :system"
    rows = _rows(session, f"""
        SELECT h.recorded_at, COALESCE(h.system_id::text, 'upload') AS system_id,
               COALESCE(s.name, CASE WHEN h.system_id IS NULL THEN 'File upload' END) AS system_name,
               h.module_id AS module, h.dqs_score, h.completeness, h.accuracy, h.consistency, h.timeliness,
               h.uniqueness, h.validity, h.finding_count
          FROM dqs_history h
          LEFT JOIN sap_systems s ON s.tenant_id = h.tenant_id AND s.id = h.system_id
         WHERE h.tenant_id = CAST(:t AS uuid) {sys} {_where(p, module='h.module_id')}
         ORDER BY h.recorded_at DESC, h.module_id
         LIMIT :cap""", tid, p)
    for r in rows:
        r["object"] = object_label(r["module"])
    return rows


def _rule_catalogue(session: Session, tid: str, p: dict) -> list[dict]:
    rows = _rows(session, f"""
        SELECT name AS check_id, description, module, category, severity, enabled, source, source_yaml
          FROM rules
         WHERE tenant_id = CAST(:t AS uuid) {_where(p, module='module', severity='severity')}
         ORDER BY module, name
         LIMIT :cap""", tid, p)
    for r in rows:
        r["object"] = object_label(r["module"])
        r["enabled"] = "Yes" if r["enabled"] else "No"
    return rows


def _audit_log(session: Session, tid: str, p: dict) -> list[dict]:
    return _rows(session, """
        SELECT created_at, actor_email, action, entity_type, entity_id, method, path, status_code, ip
          FROM audit_log WHERE tenant_id = CAST(:t AS uuid)
         ORDER BY created_at DESC LIMIT :cap""", tid, p)


_DIMS = [ColumnSpec(k, k.capitalize(), kind="pct") for k in
         ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")]

DATASETS: dict[str, Dataset] = {
    "findings": Dataset("Findings", [
        *_RUN_COLS, *_OBJ_COLS,
        ColumnSpec("check_id", "Check", kind="mono"), ColumnSpec("message", "Check description"),
        ColumnSpec("field", "Field", kind="mono"), ColumnSpec("field_description", "Field description"),
        ColumnSpec("severity", "Severity"), ColumnSpec("dimension", "Dimension"),
        ColumnSpec("affected_count", "Failing records", kind="int"), ColumnSpec("total_count", "Records checked", kind="int"),
        ColumnSpec("pass_rate", "Pass rate", kind="pct"), ColumnSpec("cost_at_risk", "Cost at risk", kind="money"),
        ColumnSpec("impact_score", "Impact score"), ColumnSpec("remediation_text", "How to fix"),
        ColumnSpec("finding_type", "Type"), ColumnSpec("version_id", "Run id", kind="mono", muted=True),
    ], _findings, ("system", "module", "run", "severity"), pdf_kind="analysis"),
    "failing_records": Dataset("Failing records", [
        *_RUN_COLS, *_OBJ_COLS,
        ColumnSpec("check_id", "Check", kind="mono"), ColumnSpec("message", "Check description"),
        ColumnSpec("severity", "Severity"), ColumnSpec("record_key", "Record", kind="mono"),
        ColumnSpec("grain", "Record type"), ColumnSpec("field", "Field", kind="mono"),
        ColumnSpec("field_description", "Field description"), ColumnSpec("reason", "Reason"),
        ColumnSpec("values", "Values checked"), ColumnSpec("context", "Classification"),
        ColumnSpec("remediation_text", "How to fix"), ColumnSpec("version_id", "Run id", kind="mono", muted=True),
    ], _failing_records, ("system", "module", "run", "severity")),
    "cleansing": Dataset("Cleansing proposals", [
        *_RUN_COLS, *_OBJ_COLS,
        ColumnSpec("record_key", "Record", kind="mono"), ColumnSpec("check_id", "Check", kind="mono"),
        ColumnSpec("field", "Field", kind="mono"), ColumnSpec("field_description", "Field description"),
        ColumnSpec("before", "Before"), ColumnSpec("after", "After"), ColumnSpec("status", "Status"),
        ColumnSpec("confidence", "Confidence", kind="pct"), ColumnSpec("priority", "Priority", kind="int"),
        ColumnSpec("approved_by", "Approved by"), ColumnSpec("detected_at", "Proposed", kind="datetime"),
        ColumnSpec("applied_at", "Applied", kind="datetime"), ColumnSpec("version_id", "Run id", kind="mono", muted=True),
    ], _cleansing, ("system", "module", "run"), pdf_kind="cleaning"),
    "changes": Dataset("Approved changes", [
        ColumnSpec("created_at", "When", kind="datetime"), ColumnSpec("action", "Action"),
        ColumnSpec("actor_name", "By"), *_OBJ_COLS, ColumnSpec("record_key", "Record", kind="mono"),
        ColumnSpec("check_id", "Check", kind="mono"), ColumnSpec("field", "Field", kind="mono"),
        ColumnSpec("field_description", "Field description"),
        ColumnSpec("before", "Before"), ColumnSpec("after", "After"),
        ColumnSpec("version_id", "Run id", kind="mono", muted=True),
    ], _changes, ("module", "run")),
    "score_history": Dataset("Score history", [
        ColumnSpec("recorded_at", "Recorded", kind="datetime"), ColumnSpec("system_id", "System", kind="mono", muted=True),
        ColumnSpec("system_name", "System name"), *_OBJ_COLS, ColumnSpec("dqs_score", "Score", kind="pct"),
        *_DIMS, ColumnSpec("finding_count", "Findings", kind="int"),
    ], _score_history, ("system", "module"), pdf_kind="trend"),
    "rule_catalogue": Dataset("Rule catalogue", [
        *_OBJ_COLS, ColumnSpec("check_id", "Check", kind="mono"), ColumnSpec("description", "Check description"), ColumnSpec("category", "Category"),
        ColumnSpec("severity", "Severity"), ColumnSpec("enabled", "Enabled"), ColumnSpec("source", "Source"),
        ColumnSpec("source_yaml", "Rule file", kind="mono", muted=True),
    ], _rule_catalogue, ("module", "severity"), pdf_kind="rules"),
    "audit_log": Dataset("Audit log", [
        ColumnSpec("created_at", "When", kind="datetime"), ColumnSpec("actor_email", "By"),
        ColumnSpec("action", "Action", kind="mono"), ColumnSpec("entity_type", "Entity type"),
        ColumnSpec("entity_id", "Entity", kind="mono"), ColumnSpec("method", "Method", kind="mono"),
        ColumnSpec("path", "Path", kind="mono"), ColumnSpec("status_code", "Status", kind="int"),
        ColumnSpec("ip", "Address", kind="mono", muted=True),
    ], _audit_log, ()),
}


class ExportError(ValueError):
    """The parameters do not describe an export (shown to the user as is)."""


def clean_params(dataset: str, p: dict) -> dict:
    """Validated, normalised parameters: unknown datasets, formats, columns or splits are refused."""
    ds = DATASETS.get(dataset)
    if ds is None:
        raise ExportError(f"Unknown export: {dataset}")
    fmt = p.get("format") or "xlsx"
    if fmt not in FORMATS:
        raise ExportError(f"Unknown format: {fmt}")
    if fmt == "pdf" and not ds.pdf_kind:
        raise ExportError(f"{ds.name} has no PDF report; choose xlsx, csv or json.")
    if fmt == "pdf" and dataset == "rule_catalogue" and not p.get("module"):
        raise ExportError("The rule catalogue PDF covers one object; choose an object.")
    keys = [c.key for c in ds.columns]
    cols = [c for c in (p.get("columns") or []) if c in keys] or keys
    split = p.get("split") or "none"
    if split not in SPLITS:
        raise ExportError(f"Unknown split: {split}")
    sev = [s for s in (p.get("severity") or []) if s in SEVERITIES]
    out: dict[str, Any] = {"format": fmt, "columns": cols, "split": split}
    if "severity" in ds.filters and sev:
        out["severity"] = sev
    for k in ("system", "module", "run"):
        if k in ds.filters and p.get(k):
            out[k] = str(p[k])[:64]
    return out


def build(session: Session, tenant_id: str, dataset: str, params: dict,
          progress: Optional[Callable[[str, int], None]] = None) -> Optional[Any]:
    """The export as report_history.Generated, or None when a pdf report found nothing."""
    from api.services import report_history as rh

    p = clean_params(dataset, params)
    ds = DATASETS[dataset]
    tick = progress or (lambda stage, pct: None)
    stamp = datetime.now(timezone.utc)
    if p["format"] == "pdf":
        pdf_params = {"scope": p.get("system") or "latest", "module": p.get("module")}
        return rh.generate_report(session, tenant_id, ds.pdf_kind, pdf_params)
    tick("read", 10)
    rows = ds.query(session, str(tenant_id), p)
    tick("write", 60)
    columns = [c for c in ds.columns if c.key in p["columns"]]
    slug = dataset.replace("_", "-")
    version = p.get("run") if p.get("run") not in (None, "latest", "all") else None
    if p["format"] == "json":
        body = {"dataset": dataset, "name": ds.name, "generated_at": stamp.isoformat(), "filters": p,
                "truncated": len(rows) > ROW_CAP,
                "rows": [{c.key: _json_cell(r.get(c.key)) for c in columns} for r in rows[:ROW_CAP]]}
        data = json.dumps(body, default=str, indent=1).encode()
        return rh.Generated(data, xlsx_filename(slug, ds.name, stamp)[:-5] + ".json", MIME["json"], version)
    if p["format"] == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([c.header for c in columns])
        for r in rows[:ROW_CAP]:
            w.writerow([guard_formula_cell(r.get(c.key)) if c.kind in ("text", "mono") else _csv_cell(r.get(c.key))
                        for c in columns])
        data = ("﻿" + buf.getvalue()).encode()  # BOM: Excel opens UTF-8 (umlauts, kana) correctly
        return rh.Generated(data, xlsx_filename(slug, ds.name, stamp)[:-5] + ".csv", MIME["csv"], version)
    sheets = [SheetSpec(title=title, columns=columns, rows=group) for title, group in _split(rows, p["split"], ds.name)]
    tenant_name = session.execute(text("SELECT name FROM tenants WHERE id = CAST(:t AS uuid)"),
                                  {"t": str(tenant_id)}).scalar() or ""
    data = build_workbook(tenant_name=tenant_name, run_label=_filters_label(p), run_id=version,
                          title=f"{ds.name} export", sheets=sheets, generated_at=stamp)
    return rh.Generated(data, xlsx_filename(slug, ds.name, stamp), MIME["xlsx"], version)


def _split(rows: list[dict], split: str, name: str) -> list[tuple[str, list[dict]]]:
    if split == "none":
        return [(name, rows)]
    groups: dict[str, list[dict]] = {}
    for r in rows:
        if split == "module":
            label = r.get("object") or "No object"
        elif split == "run":
            label = str(r.get("run_label") or "No run")
        else:
            label = (r.get("severity") or "No severity").capitalize()
        groups.setdefault(label, []).append(r)
    return list(groups.items()) or [(name, [])]


def _filters_label(p: dict) -> str:
    parts = [object_label(p["module"])] if p.get("module") else []
    if p.get("severity"):
        parts.append(", ".join(p["severity"]))
    return " ".join(parts) or "All"


def _csv_cell(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat()
    return guard_formula_cell(v) if isinstance(v, str) else v


def _json_cell(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat()
    if v is None or isinstance(v, (int, float, bool)):
        return v
    try:
        return float(v) if type(v).__name__ == "Decimal" else guard_formula_cell(str(v))
    except (TypeError, ValueError):
        return str(v)


def options() -> list[dict]:
    """What the export centre can produce, for the UI's dataset, column and filter choices."""
    return [{"id": k, "name": d.name, "filters": list(d.filters), "pdf": bool(d.pdf_kind),
             "columns": [{"key": c.key, "header": c.header} for c in d.columns]} for k, d in DATASETS.items()]

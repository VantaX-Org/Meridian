"""Analyst workbook: ten sheets built from the same ``insights_aggregate.gather`` data as the board pack.

Layers match pdf_reports: sync loaders, a pure ``workbook_context`` that returns SheetSpecs, and
``build`` that renders bytes. Impact is only ever reported per L1; no sheet carries a cross-L1 total.
Totals rows on Modules sum counts, never scores.
"""
import json
from datetime import datetime, timezone
from collections.abc import Mapping
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.routes.findings import composite_dqs
from api.services import insights_aggregate as agg
from api.services import s4_readiness
from api.services.branded_xlsx import (
    ROW_CAP, ColumnKind, ColumnSpec, ConditionalRule, SheetSpec, build_workbook, xlsx_filename)
from api.services.pdf_reports import (
    DIMENSIONS, _all, _rows_checked, _rule, dimension_scores, fmt_module, load_scoring)
from api.services.scoring import scoring_config, tier

SCHEMA_VERSION = "1"
SAMPLE_PER_RULE = 9
TREND_RUNS = 24
_STATUS, _BAR, _SCALE = "status", "databar", "colorscale"


# ── loaders ──────────────────────────────────────────────────────────────────

_SAMPLE_SQL = """
WITH ranked AS (
  SELECT fr.tenant_id, fr.version_id, fr.check_id, fr.module, fr.grain, fr.record_key,
         ROW_NUMBER() OVER (PARTITION BY fr.check_id ORDER BY fr.record_key) AS rn
    FROM finding_records fr
   WHERE fr.tenant_id = :t AND fr.version_id = CAST(:v AS uuid)
     AND (CAST(:m AS text) IS NULL OR fr.module = CAST(:m AS text))),
kept AS (SELECT * FROM ranked WHERE rn <= :n)
SELECT k.check_id, k.module, k.grain, k.record_key, rf.field, rf.invalid_value, rf.suggested_value,
       (SELECT ri.confidence FROM remediation_items ri
         WHERE ri.tenant_id = k.tenant_id AND ri.check_id = k.check_id AND ri.record_key = k.record_key
         ORDER BY ri.updated_at DESC NULLS LAST LIMIT 1) AS confidence
  FROM kept k
  LEFT JOIN LATERAL (SELECT field, invalid_value, suggested_value FROM record_fixes x
                      WHERE x.tenant_id = k.tenant_id AND x.version_id = k.version_id
                        AND x.check_id = k.check_id AND x.record_id = k.record_key
                      ORDER BY x.created_at LIMIT 1) rf ON true
 ORDER BY k.check_id, k.record_key LIMIT :cap"""


def load_samples(s: Session, tid: str, vid: str, module: Optional[str]) -> list[dict]:
    return _all(s, _SAMPLE_SQL, t=tid, v=vid, m=module, n=SAMPLE_PER_RULE, cap=ROW_CAP)


def load_readiness_cells(s: Session, tid: str, vid: str) -> list[dict]:
    """One row per (wave, module): the latest analysed migration run of each wave, graded as the cockpit does."""
    from api.services.insights_readiness import build_wave_cells

    summary = (_all(s, "SELECT dqs_summary FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t",
                    v=vid, t=tid) or [{}])[0].get("dqs_summary") or {}
    dqs = {m: (d or {}).get("composite_score") for m, d in summary.items() if isinstance(d, dict)}
    out = []
    for w in _all(s, "SELECT id, name, modules, min_readiness, min_dqs FROM migration_waves WHERE tenant_id = :t "
                     "ORDER BY target_date NULLS LAST, name", t=tid):
        run = (_all(s, "SELECT gap_summary FROM migration_runs WHERE tenant_id = :t AND wave_id = :w "
                       "AND status = 'analysed' ORDER BY completed_at DESC LIMIT 1", t=tid, w=str(w["id"])) or [None])[0]
        for c in build_wave_cells(w["name"], list(w["modules"] or []), (run or {}).get("gap_summary") or {},
                                  dqs, w["min_readiness"], w["min_dqs"]):
            out.append({"module": c.module, "wave": c.wave, "verdict": c.verdict, "blocker_count": c.blocker_count,
                        "records_blocked": c.records_blocked, "dqs": c.dqs, "transfer_score": c.score})
    return out


def load_workbook_data(s: Session, tid: str, vid: str, compare: Optional[str] = None,
                       module: Optional[str] = None) -> Optional[dict]:
    d = agg.gather(s, tid, vid, compare, module, trend_limit=TREND_RUNS)
    if not d:
        return None
    v = str(d["version"]["id"])
    d["samples"] = load_samples(s, tid, v, module)
    d["readiness"] = load_readiness_cells(s, tid, v)
    d["tenant_name"] = (s.execute(text("SELECT name FROM tenants WHERE id = :t"), {"t": tid}).scalar() or "")
    d["tenant_id"] = tid
    return d


# ── sheets ───────────────────────────────────────────────────────────────────

def _c(key: str, header: str, kind: ColumnKind = "text", scale: float = 1.0,
       fill_by_value: Optional[Mapping[str, str]] = None, width: Optional[int] = None) -> ColumnSpec:
    return ColumnSpec(key, header, kind, scale, fill_by_value, width)


def _delta(cur: Optional[float], prev: Optional[float], dp: int = 1) -> Optional[float]:
    return None if cur is None or prev is None else round(float(cur) - float(prev), dp)


def _summary_sheet(data: dict, cfg: dict, tiers: dict) -> SheetSpec:
    ov, v, prev = data["overview"], data["version"], data["previous"]
    summary = v.get("dqs_summary") or {}
    dims = dimension_scores(summary)
    pdims = dimension_scores(prev.get("dqs_summary") or {}) if prev else {}
    var = ov["value_at_risk"]
    rows = [
        {"metric": "Data quality score", "value": ov["dqs"]["composite"], "previous": ov["dqs"].get("previous"),
         "delta": ov["dqs"].get("delta"), "note": "Composite, 0 to 100"},
        {"metric": "Tier", "value": tiers["composite"], "previous": None, "delta": None,
         "note": f"Target {cfg['thresholds']['target']}, warning {cfg['thresholds']['warning']}"},
    ]
    rows += [{"metric": d.capitalize(), "value": dims[d], "previous": pdims.get(d), "delta": _delta(dims[d], pdims.get(d)),
              "note": "Dimension score, 0 to 100"} for d in DIMENSIONS]
    rows += [
        {"metric": "Critical findings", "value": sum(int((r or {}).get("critical_count") or 0) for r in summary.values()
                                                     if isinstance(r, dict)), "previous": None, "delta": None,
         "note": "Failing rules at critical severity, summed over modules"},
        {"metric": "Blockers", "value": ov["blockers"]["count"], "previous": None, "delta": None,
         "note": "Failing rules that are critical or block S/4 readiness"},
        {"metric": "Auto-fixable records", "value": ov["auto_fixable"]["records"], "previous": None, "delta": None,
         "note": "Distinct records with a proposed value"},
        {"metric": "Failing records", "value": ov["auto_fixable"]["failing_records"], "previous": None, "delta": None,
         "note": "Affected records summed over failing rules"},
        {"metric": f"Worst L1 value at risk ({var['worst_l1'] or 'none'})", "value": var["worst_l1_amount"],
         "previous": None, "delta": None, "note": "Largest single L1; impact is never summed across L1s"},
        {"metric": "Currency", "value": data["currency"], "previous": None, "delta": None, "note": "Tenant cost model"},
    ]
    return SheetSpec("Summary", [_c("metric", "Metric", width=34), _c("value", "Value", "raw"),
                                 _c("previous", "Previous", "raw"), _c("delta", "Change", "raw"),
                                 _c("note", "Note", width=52)], rows,
                     note="Headline numbers for the run.", rules=[ConditionalRule("delta", _SCALE)])


def _per_module(findings: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for f in findings:
        m = out.setdefault(f["module"], {"high": 0, "medium": 0, "low": 0, "passing": 0, "failing": 0, "errored": 0,
                                         "fail_records": 0})
        if (f.get("details") or {}).get("error"):
            m["errored"] += 1
        elif f.get("affected_count"):
            m["failing"] += 1
            m["fail_records"] += int(f["affected_count"])
            if f.get("severity") in ("high", "medium", "low"):
                m[f["severity"]] += 1
        else:
            m["passing"] += 1
    return out


def _module_sheets(data: dict, cfg: dict) -> tuple[SheetSpec, SheetSpec]:
    v, prev = data["version"], data["previous"]
    summary = v.get("dqs_summary") or {}
    psummary = (prev or {}).get("dqs_summary") or {}
    heat = agg.heatmap_rows(summary, cfg["thresholds"], data["module"])
    per = _per_module(data["findings"])
    checked = _rows_checked(data["findings"])
    fixes = data["fixes_by_check"]
    fix_by_module: dict[str, int] = {}
    for f in data["findings"]:
        if f.get("affected_count"):
            fix_by_module[f["module"]] = fix_by_module.get(f["module"], 0) + min(
                fixes.get(f["check_id"], 0), int(f["affected_count"]))
    mrows, orows = [], []
    for h in heat:
        m = h["module"]
        p = per.get(m, {})
        pc = (psummary.get(m) or {}).get("composite_score") if prev else None
        mrows.append({
            "module": m, "group": h["group"], "composite": h["scores"]["composite"], "previous": pc,
            "delta": _delta(h["scores"]["composite"], pc), "tier": h["tier"]["composite"], "critical": h["critical"],
            "high": p.get("high", 0), "medium": p.get("medium", 0), "low": p.get("low", 0),
            "checks": int((summary.get(m) or {}).get("total_checks") or 0), "passing": p.get("passing", 0),
            "failing": p.get("failing", 0), "errored": p.get("errored", 0), "records": checked.get(m),
            "cap_reason": h["cap_reason"],
            "auto_fix_pct": round(100.0 * fix_by_module.get(m, 0) / p["fail_records"], 1) if p.get("fail_records") else None})
        for d in DIMENSIONS:
            if d in h["scores"]:
                orows.append({"module": m, "dimension": d, "score": h["scores"][d], "coverage": h["coverage"].get(d),
                              "tier": h["tier"][d]})
    modules = SheetSpec(
        "Modules",
        [_c("module", "Module", width=26), _c("group", "Group"), _c("composite", "Score", "pct"),
         _c("previous", "Previous score", "pct"), _c("delta", "Change", "raw"), _c("tier", "Tier"),
         _c("critical", "Critical", "int"), _c("high", "High", "int"), _c("medium", "Medium", "int"),
         _c("low", "Low", "int"), _c("checks", "Checks", "int"), _c("passing", "Passing", "int"),
         _c("failing", "Failing", "int"), _c("errored", "Errored", "int"), _c("records", "Records", "int"),
         _c("cap_reason", "Cap reason", width=30), _c("auto_fix_pct", "Auto-fix share", "pct")],
        mrows, note="One row per module. The total row counts rules and records, never scores.",
        totals=["critical", "high", "medium", "low", "checks", "passing", "failing", "errored"],
        rules=[ConditionalRule("tier", _STATUS), ConditionalRule("composite", _BAR),
               ConditionalRule("auto_fix_pct", _BAR), ConditionalRule("delta", _SCALE)])
    objects = SheetSpec(
        "Objects",
        [_c("module", "Module", width=26), _c("dimension", "Dimension"), _c("score", "Score", "pct"),
         _c("coverage", "Coverage", "pct"), _c("tier", "Tier")],
        orows, note="Module by dimension, long format for pivot tables.",
        rules=[ConditionalRule("tier", _STATUS), ConditionalRule("score", _BAR)])
    return modules, objects


def _rule_sheets(data: dict) -> tuple[SheetSpec, SheetSpec, list[dict]]:
    findings = data["findings"]
    rules = agg.rule_rows(findings, data["previous_findings"] if data["previous"] else None, data["fixes_by_check"])
    rule_sheet = SheetSpec(
        "Rules",
        [_c("check_id", "Rule", "mono"), _c("name", "Name", width=50), _c("module", "Module", width=24),
         _c("severity", "Severity"), _c("dimension", "Dimension"), _c("field", "Field", "mono"),
         _c("affected", "Affected", "int"), _c("total", "Total", "int"),
         _c("pass_rate", "Pass rate", "pct", scale=100.0), _c("impact", "Impact", "int"),
         _c("auto_fix_pct", "Auto-fix share", "pct"), _c("s4", "S/4"), _c("delta_affected", "Change in affected", "raw"),
         _c("cost_at_risk", "Cost at risk", "money")],
        rules, note="Every failing rule, highest impact first.",
        rules=[ConditionalRule("severity", _STATUS), ConditionalRule("s4", _STATUS),
               ConditionalRule("pass_rate", _BAR), ConditionalRule("auto_fix_pct", _BAR),
               ConditionalRule("delta_affected", _SCALE)])
    frows = [{"check_id": f["check_id"], "module": f["module"], "severity": f.get("severity"),
              "dimension": f.get("dimension"), "affected": int(f.get("affected_count") or 0),
              "total": int(f.get("total_count") or 0),
              "pass_rate": f.get("pass_rate"), "cost_at_risk": f.get("cost_at_risk"),
              "remediation_text": _rule(f["check_id"]).get("why") or _rule(f["check_id"]).get("message")}
             for f in sorted(findings, key=lambda f: (f["module"], f["check_id"]))]
    finding_sheet = SheetSpec(
        "Findings",
        [_c("check_id", "Rule", "mono"), _c("module", "Module", width=24), _c("severity", "Severity"),
         _c("dimension", "Dimension"), _c("affected", "Affected", "int"), _c("total", "Total", "int"),
         _c("pass_rate", "Pass rate", "pct"), _c("cost_at_risk", "Cost at risk", "money"),
         _c("remediation_text", "Remediation", width=60)],
        frows, note="Every rule result, passing and failing, for filtering.",
        rules=[ConditionalRule("severity", _STATUS), ConditionalRule("pass_rate", _BAR)])
    return rule_sheet, finding_sheet, rules


def _samples_sheet(data: dict) -> SheetSpec:
    return SheetSpec(
        "Records sample",
        [_c("check_id", "Rule", "mono"), _c("module", "Module", width=24), _c("grain", "Grain"),
         _c("record_key", "Record key", "mono", width=24), _c("field", "Field", "mono"),
         _c("invalid_value", "Invalid value", "raw"), _c("suggested_value", "Suggested value", "raw"),
         _c("confidence", "Confidence")],
        data["samples"], note=f"Up to {SAMPLE_PER_RULE} failing records per rule.")


def _readiness_sheet(data: dict) -> SheetSpec:
    roll = s4_readiness.rollup(data["findings"])
    area_of: dict[str, dict] = {}
    for a in roll["areas"]:
        for c in a["checks"]:
            if c.get("module"):
                cur = area_of.get(c["module"])
                if not cur or a["blocking_failing"] > cur["blocking_failing"]:
                    area_of[c["module"]] = a  # module -> the area where it fails most
    rows = []
    for r in data["readiness"]:
        if data["module"] and r["module"] != data["module"]:
            continue
        a = area_of.get(r["module"]) or {}
        rows.append({**r, "s4_area": a.get("label"), "blocking_failing": a.get("blocking_failing"),
                     "warning_failing": a.get("warning_failing")})
    return SheetSpec(
        "Readiness",
        [_c("module", "Module", width=26), _c("wave", "Wave"), _c("verdict", "Verdict"),
         _c("blocker_count", "Blockers", "int"), _c("records_blocked", "Records blocked", "int"),
         _c("dqs", "Score", "pct"), _c("transfer_score", "Transfer score", "pct"),
         _c("s4_area", "S/4 area", width=30), _c("blocking_failing", "Blocking rules failing", "int"),
         _c("warning_failing", "Warning rules failing", "int")],
        rows, note="Migration wave verdicts with the S/4 area each module fails most in.",
        rules=[ConditionalRule("verdict", _STATUS), ConditionalRule("dqs", _BAR)])


def _trend_sheet(data: dict) -> SheetSpec:
    rows = []
    for r in (data["trend"] or {}).get("runs") or []:
        rows.append({"version_id": r["version_id"], "run_at": datetime.fromisoformat(r["run_at"]) if r["run_at"] else None,
                     "label": r["label"], "composite": r["composite"],
                     **{d: (r["dimensions"] or {}).get(d) for d in DIMENSIONS},
                     "critical": r["critical"], "blockers": r["blockers"]})
    rows = rows[-TREND_RUNS:]
    return SheetSpec(
        "Trend",
        [_c("version_id", "Run ID", "mono", width=38), _c("run_at", "Run at", "datetime"), _c("label", "Label"),
         _c("composite", "Score", "pct"), *[_c(d, d.capitalize(), "pct") for d in DIMENSIONS],
         _c("critical", "Critical", "int"), _c("blockers", "Blockers", "int")],
        rows, note=f"Last {TREND_RUNS} runs, re-weighted under the current scoring config.",
        rules=[ConditionalRule("composite", _BAR)])


def _commentary_sheet(data: dict, scoring: dict) -> SheetSpec:
    """The board pack's plain-speech commentary, one row per section, so the words travel with the numbers."""
    from api.services.pdf_reports import board_context

    ctx = board_context(data, tenant_name=data["tenant_name"], scoring=scoring)
    com = ctx["commentary"]
    order = [("Score", "overall"), ("Dimensions", "dimensions"), ("Root causes", "clusters"), ("Blockers", "blockers"),
             ("Migration waves", "waves"), ("Cleansing funnel", "funnel"), ("Modules", "modules")]
    rows = [{"section": label, "commentary": com[key]} for label, key in order if com.get(key)]
    rows += [{"section": fmt_module(m["name"]), "commentary": m["commentary"]}
             for g in ctx["groups"] for m in g["modules"] if m.get("commentary")]
    rows += [{"section": f"Next step {i}", "commentary": step} for i, step in enumerate(com.get("next_steps") or [], 1)]
    return SheetSpec("Commentary", [_c("section", "Section", width=28), _c("commentary", "Commentary", width=120)], rows,
                     note="What the numbers mean and what to do, written from the figures alone.")


def _meta_sheet(data: dict, cfg: dict, generated_at: datetime, app_version: str) -> SheetSpec:
    prev = data["previous"]
    kv = [("schema_version", SCHEMA_VERSION), ("generated_at", generated_at.isoformat()),
          ("tenant_id", data["tenant_id"]), ("version_id", str(data["version"]["id"])),
          ("previous_version_id", str(prev["id"]) if prev else ""), ("module_filter", data["module"] or ""),
          ("currency", data["currency"]),
          ("scoring_weights", json.dumps({"dimension_weights": cfg["dimension_weights"],
                                          "module_weights": cfg["module_weights"],
                                          "thresholds": cfg["thresholds"]}, sort_keys=True)),
          ("app_version", app_version)]
    return SheetSpec("_meta", [_c("key", "Key", width=24), _c("value", "Value", width=80)],
                     [{"key": k, "value": v} for k, v in kv], hidden=True)


def workbook_context(data: dict, *, scoring: dict, generated_at: Optional[datetime] = None,
                     app_version: str = "") -> dict:
    """Pure builder: the ten sheets plus the cover fields."""
    cfg = scoring_config(scoring)
    now = generated_at or datetime.now(timezone.utc)
    v = data["version"]
    overall = composite_dqs([v.get("dqs_summary") or {}], scoring=scoring)
    tiers = {"composite": tier(overall["composite"], cfg["thresholds"]) if overall["composite"] is not None else None}
    modules, objects = _module_sheets(data, cfg)
    rules, findings, _ = _rule_sheets(data)
    sheets = [_summary_sheet(data, cfg, tiers), _commentary_sheet(data, scoring), modules, objects, rules, findings,
              _samples_sheet(data), _readiness_sheet(data), _trend_sheet(data), _meta_sheet(data, cfg, now, app_version)]
    return {"tenant_name": data["tenant_name"], "run_label": v.get("label") or str(v["id"]), "run_id": str(v["id"]),
            "title": "Analyst workbook", "sheets": sheets, "generated_at": now}


def build(s: Session, tid: str, vid: str, compare: Optional[str] = None,
          module: Optional[str] = None) -> Optional[tuple[bytes, str]]:
    """``(xlsx bytes, filename)``, or ``None`` when the run is not found."""
    from api.services.pdf_reports import _app_version

    data = load_workbook_data(s, tid, vid, compare, module)
    if not data:
        return None
    ctx = workbook_context(data, scoring=load_scoring(s, tid), app_version=_app_version())
    body = build_workbook(tenant_name=ctx["tenant_name"], run_label=ctx["run_label"], run_id=ctx["run_id"],
                          title=ctx["title"], sheets=ctx["sheets"], generated_at=ctx["generated_at"])
    return body, xlsx_filename("workbook", ctx["run_label"], ctx["generated_at"])

"""Deterministic aggregation behind the /insights overview, rules, root-cause, heatmap, trend and
cleansing endpoints, the board PDF and the analyst workbook. No LLM is called here.

Two layers: pure functions over plain rows (unit tested with fixtures) and sync loaders over a
``Session`` already scoped to the tenant (``AsyncSession.run_sync`` for routes, ``tenant_session``
for the report builders). Impact is always grouped by L1 and never summed across L1s.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from api.routes.findings import _COMPLETE, composite_dqs
from api.services import s4_readiness
from api.services.run_context import latest_run_sync
from api.services.run_lineage import lineage_key, lineage_sql
from api.services.insights_impact import feature_l1, tenant_currency, value_at_risk, worst_l1
from api.services.pdf_reports import (
    _SEV_RANK, DIMENSIONS, _all, _one, _rule, failing, fmt_module, load_scoring, module_deltas,
)
from api.services.scoring import CLEAN_KEY_CEILING, impact, rescore, scoring_config, tier

GROUPS = ("ecc", "successfactors", "warehouse")
NARRATIVE_MAX = 4
CLUSTER_LIMIT = 10
BLOCKING = "blocking"


# ── pure helpers ─────────────────────────────────────────────────────────────

def module_group(module: str) -> str:
    """ecc, successfactors or warehouse. employee_central and payroll_integration are in both the
    ecc and successfactors registries; successfactors wins."""
    from sap.extraction_registry import SYSTEM_EXTRACTIONS

    if module in SYSTEM_EXTRACTIONS.get("successfactors", {}):
        return "successfactors"
    if module in SYSTEM_EXTRACTIONS.get("ewms", {}):
        return "warehouse"
    return "ecc"


def _pct(num: float, den: float) -> Optional[float]:
    return round(min(100.0, 100.0 * num / den), 1) if den else None


def failing_rows(findings: list[dict]) -> list[dict]:
    return [f for f in findings if failing(f)]


def failing_records(findings: list[dict]) -> int:
    return sum(int(f.get("affected_count") or 0) for f in failing_rows(findings))


def distinct_failing_records(findings: list[dict], dqs_summary: Optional[dict]) -> dict[str, int]:
    """Distinct failing records per module: the run's ``clean_records.failing_records`` (records of the driving object
    failing at least one rule, ``api.services.scoring``) where scoring could attribute them, else the module's rule
    failures (the sum of its failing rules' affected counts, an upper bound). ``failing_records`` counts a record once
    per rule it fails, so it is never a count of records: the cleansing funnel's first step read 343,176 "failing
    records" against 343,209 records analysed."""
    failures: dict[str, int] = {}
    for f in failing_rows(findings):
        failures[f["module"]] = failures.get(f["module"], 0) + int(f.get("affected_count") or 0)
    out: dict[str, int] = {}
    for module, n in failures.items():
        summary = (dqs_summary or {}).get(module) if isinstance(dqs_summary, dict) else None
        cr = (summary or {}).get("clean_records") if isinstance(summary, dict) else None
        known = cr.get("failing_records") if isinstance(cr, dict) else None
        out[module] = int(known) if isinstance(known, (int, float)) and not cr.get("unattributed_rules") else n
    return out


def is_blocker(f: dict, members: dict[str, tuple[str, str]]) -> bool:
    """A failing rule that is critical or counted as blocking by the S/4 readiness pack."""
    return failing(f) and (f.get("severity") == "critical"
                           or members.get(f["check_id"], ("", ""))[1] == BLOCKING)


def blockers_of(findings: list[dict], members: dict[str, tuple[str, str]]) -> list[dict]:
    return [f for f in findings if is_blocker(f, members)]


def concentration(blockers: list[dict]) -> Optional[tuple[str, float]]:
    """(module, share) when one module holds more than half of the blocking rules."""
    if not blockers:
        return None
    counts: dict[str, int] = {}
    for f in blockers:
        counts[f["module"]] = counts.get(f["module"], 0) + 1
    top = max(sorted(counts), key=counts.__getitem__)
    share = counts[top] / len(blockers)
    return (top, round(share, 3)) if share > 0.5 else None


def waves_hit(waves: list[dict], blockers: list[dict]) -> list[str]:
    mods = {f["module"] for f in blockers}
    return [w["name"] for w in waves if mods & set(w.get("modules") or [])]


def field_of(f: dict) -> Optional[str]:
    """The field a finding is about: ``rule_context.field``, else the field its check recorded in
    ``details`` (``field_checked``); None when neither names one."""
    for src, key in ((f.get("rule_context"), "field"), (f.get("details"), "field_checked")):
        v = (src or {}).get(key) if isinstance(src, dict) else None
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def cluster_findings(findings: list[dict], fixes: dict[str, int]) -> list[dict]:
    """Group failing findings by (module, field). Rules with no field go in one ``unattributed``
    cluster per module. Sorted by impact, worst first; records are filled in later."""
    groups: dict[tuple[str, Optional[str]], list[dict]] = {}
    for f in failing_rows(findings):
        groups.setdefault((f["module"], field_of(f)), []).append(f)
    out = []
    for (module, field), rows in groups.items():
        rows = sorted(rows, key=lambda f: (-impact(f["affected_count"], f.get("severity")), f["check_id"]))
        affected = sum(int(f["affected_count"]) for f in rows)
        table, _, col = (field or "").rpartition(".") if field and "." in field else ("", "", field or "")
        out.append({
            "key": f"{module}:{field or 'unattributed'}",
            "kind": "field" if field else "unattributed",
            "module": module, "table": table or None, "field": col or None,
            "rules": [f["check_id"] for f in rows],
            "dimension": rows[0].get("dimension"),
            "severity": min((f.get("severity") for f in rows), key=lambda s: _SEV_RANK.get(s, 9)),
            "records": affected, "records_estimated": True,
            "impact": sum(impact(f["affected_count"], f.get("severity")) for f in rows),
            "auto_fix_pct": _pct(sum(fixes.get(f["check_id"], 0) for f in rows), affected),
            "worst_rule": rows[0]["check_id"],
        })
    out.sort(key=lambda c: (-c["impact"], c["key"]))
    return out


def origin_of(row: Optional[dict]) -> dict:
    """The dominant origin of a rule's failing values from ``finding_root_causes`` (share 0..1)."""
    origins = sorted((row or {}).get("origins") or [], key=lambda o: -(o.get("records") or 0))
    if not row or row.get("status") != "computed" or not origins:
        return {"status": "not_computed", "top": None, "share": None}
    top = origins[0]
    who = " ".join(str(x) for x in (top.get("origin"), top.get("username")) if x)
    return {"status": "computed", "top": who or None, "share": round(float(top.get("share") or 0) / 100.0, 3)}


def _ids(rows: list[dict]) -> str:
    return ", ".join(r["check_id"] for r in rows[:3])


def _score_sentence(dqs: dict, deltas: dict) -> str:
    comp, delta = dqs["composite"], dqs["delta"]
    if comp is None:
        return "No module has been scored in this run."
    if delta is None:
        return f"The data quality score is {comp:.1f} with no earlier run to compare against."
    verb = "rose" if delta > 0 else "fell" if delta < 0 else "held"
    head = f"The data quality score {verb} {abs(delta):.1f} points to {comp:.1f}" if delta else \
        f"The data quality score held at {comp:.1f}"
    moved = sorted(((m, d) for m, d in deltas.items() if d["dqs_change"]),
                   key=lambda kv: (-abs(kv[1]["dqs_change"]), kv[0]))
    if not moved:
        return head + "."
    mod, d = moved[0]
    dims = sorted(((k, v["change"]) for k, v in d["dimensions"].items() if v["change"]),
                  key=lambda kv: (-abs(kv[1]), kv[0]))
    tail = f", led by {fmt_module(mod)}" + (f" {dims[0][0]} ({dims[0][1]:+.1f})" if dims else
                                            f" ({d['dqs_change']:+.1f})")
    return head + tail + "."


def _href(path: str, run_id: Optional[str], extra: str = "") -> str:
    """``path`` scoped to ``run_id`` (none: the current state, no ``run``), plus ``extra`` query pairs."""
    q = "&".join(x for x in (f"run={run_id}" if run_id else "", extra) if x)
    return f"{path}?{q}" if q else path


def _current_score_sentence(dqs: dict) -> str:
    comp = dqs["composite"]
    return "No object has been scored yet." if comp is None else \
        f"The data quality score across objects, each at its latest run, is {comp:.1f}."


def narrative(*, run_id: Optional[str], dqs: dict, deltas: dict, blockers: dict, conc: Optional[tuple[str, float]],
              wave_names: list[str], auto: dict, top_cluster: Optional[dict]) -> list[dict]:
    """At most four sentences, always in the same order, from the figures alone. ``run_id`` None: the
    current state across objects, so the score sentence names no run and the links carry no ``run``."""
    score = _score_sentence(dqs, deltas) if run_id else _current_score_sentence(dqs)
    out = [{"text": score, "href": _href("/insights/trends", run_id)}]
    n = blockers["count"]
    if n:
        s = f"{n} blocking {'rule fails' if n == 1 else 'rules fail'}"
        if wave_names:
            s += f", holding up {wave_names[0]}" + (f" and {len(wave_names) - 1} more" if len(wave_names) > 1 else "")
        if conc:
            s += f"; {conc[1] * 100:.0f}% sit in {fmt_module(conc[0])}"
        out.append({"text": s + ".", "href": _href("/insights/readiness", run_id)})
    else:
        out.append({"text": "No blocking rule fails.", "href": _href("/insights/readiness", run_id)})
    if auto["pct"] is not None:
        out.append({"text": f"{auto['pct']:.0f}% of failing records have a proposed fix, "
                            f"{auto['high_confidence']:,} at high confidence.",
                    "href": _href("/insights/rules", run_id, "auto_fixable=true")})
    if top_cluster:
        label = f"{fmt_module(top_cluster['module'])} {top_cluster['field']}" if top_cluster["field"] \
            else f"{fmt_module(top_cluster['module'])} rules with no named field"
        out.append({"text": f"The largest root cause is {label}, across {len(top_cluster['rules'])} "
                            f"{'rule' if len(top_cluster['rules']) == 1 else 'rules'}.",
                    "href": _href("/insights/rules", run_id,
                                  f"field={top_cluster['table']}.{top_cluster['field']}" if top_cluster["table"] else "")})
    return out[:NARRATIVE_MAX]


def _summary_of(version: Optional[dict], module: Optional[str]) -> dict:
    s = (version or {}).get("dqs_summary") or {}
    return {m: r for m, r in s.items() if not module or m == module}


def dqs_block(version: dict, previous: Optional[dict], scoring: dict, module: Optional[str]) -> dict:
    cur = composite_dqs([_summary_of(version, module)], scoring=scoring)
    prev = composite_dqs([_summary_of(previous, module)], scoring=scoring)["composite"] if previous else None
    comp = cur["composite"]
    capped = [r for m, r in sorted(_summary_of(version, module).items())
              if isinstance(r, dict) and r.get("capped") and r.get("cap_reason")]
    return {"composite": comp, "previous": prev,
            "delta": None if comp is None or prev is None else round(comp - prev, 2),
            "tier": cur.get("tier"), "capped": bool(cur.get("capped")),
            "cap_reason": capped[0]["cap_reason"] if capped else None}


def overview_from(data: dict) -> dict:
    """The overview payload from loaded rows (see ``load_overview_data``)."""
    v, prev, findings = data["version"], data["previous"], data["findings"]
    members = s4_readiness.membership()
    module = data.get("module")
    dqs = dqs_block(v, prev, data["scoring"], module)
    deltas = module_deltas(_summary_of(prev, module), _summary_of(v, module)) if prev else {}
    bl = blockers_of(findings, members)
    prev_bl = blockers_of(data["previous_findings"], members) if prev else None
    wave_names = waves_hit(data["waves"], bl)
    fail_n = failing_records(findings)
    auto = {"records": data["fix_records"], "failing_records": fail_n,
            "pct": _pct(data["fix_records"], fail_n), "high_confidence": data["high_confidence"]}
    clusters = data.get("clusters") or cluster_findings(findings, data["fixes_by_check"])
    worst, amount = worst_l1(data["impact_rows"])
    blockers = {"count": len(bl), "previous": None if prev_bl is None else len(prev_bl), "waves": len(wave_names)}
    run_id = str(v["id"]) if v.get("id") else None
    return {
        "version_id": run_id, "run_label": v.get("label"),
        "run_at": v["run_at"].isoformat() if v.get("run_at") else None,
        "previous_version_id": str(prev["id"]) if prev else None,
        "dqs": dqs, "blockers": blockers, "auto_fixable": auto,
        "value_at_risk": {"worst_l1": worst, "worst_l1_amount": amount, "currency": data["currency"],
                          "features_blocked": sum(1 for r in data["impact_rows"]
                                                  if r.get("status") == "blocked" and r["record_count"] > 0)},
        "narrative": narrative(run_id=run_id, dqs=dqs, deltas=deltas, blockers=blockers,
                               conc=concentration(bl), wave_names=wave_names, auto=auto,
                               top_cluster=clusters[0] if clusters else None),
    }


def rule_rows(findings: list[dict], previous: Optional[list[dict]], fixes: dict[str, int], *,
              module: Optional[str] = None, severity: Optional[str] = None, dimension: Optional[str] = None,
              auto_fixable: bool = False, s4_only: bool = False) -> list[dict]:
    """Failing rules ranked by impact, each with its change since the previous run."""
    members = s4_readiness.membership()
    prev = {f["check_id"]: f for f in previous or []}
    out = []
    for f in failing_rows(findings):
        if (module and f["module"] != module) or (severity and f.get("severity") != severity) \
                or (dimension and f.get("dimension") != dimension):
            continue
        cid, affected = f["check_id"], int(f["affected_count"])
        s4 = members.get(cid, ("", "none"))[1] if cid in members else "none"
        fix_pct = _pct(fixes.get(cid, 0), affected) or 0.0
        if (auto_fixable and fix_pct <= 0) or (s4_only and s4 == "none"):
            continue
        p = prev.get(cid)
        pass_rate = f.get("pass_rate")
        r = _rule(cid)
        out.append({
            "check_id": cid, "name": r.get("message") or cid, "module": f["module"],
            "severity": f.get("severity"), "dimension": f.get("dimension"),
            "field": r.get("field") or field_of(f), "affected": affected,
            "total": int(f.get("total_count") or 0),
            "pass_rate": None if pass_rate is None else round(float(pass_rate) / 100.0, 4),
            "impact": impact(affected, f.get("severity")), "auto_fix_pct": fix_pct, "s4": s4,
            "delta_affected": None if not p or (p.get("details") or {}).get("error")
            else affected - int(p.get("affected_count") or 0),
            "cost_at_risk": None if f.get("cost_at_risk") is None else float(f["cost_at_risk"]),
        })
    out.sort(key=lambda r: (-r["impact"], r["check_id"]))
    return out


def heatmap_rows(summary: dict, thresholds: dict, module: Optional[str] = None) -> list[dict]:
    rows = []
    for mod, r in sorted(summary.items()):
        if not isinstance(r, dict) or (module and mod != module) or r.get("composite_score") is None:
            continue
        scores = {d: r["dimension_scores"].get(d) for d in DIMENSIONS if d in (r.get("dimension_scores") or {})}
        scores["composite"] = r["composite_score"]
        cov = {d: (r.get("dimension_coverage") or {}).get(d) for d in DIMENSIONS}
        rows.append({"module": mod, "group": module_group(mod), "scores": scores,
                     "tier": {k: tier(v, thresholds) for k, v in scores.items()}, "coverage": cov,
                     "critical": int(r.get("critical_count") or 0), "cap_reason": r.get("cap_reason")})
    rows.sort(key=lambda x: (GROUPS.index(x["group"]), x["scores"]["composite"], x["module"]))
    return rows


def trend_runs(versions: list[dict], findings_by_run: dict[str, list[dict]], fixes_by_run: dict[str, int],
               scoring: dict) -> list[dict]:
    """Oldest first. Every run is re-weighted under the tenant's current config so the line compares."""
    members = s4_readiness.membership()
    out = []
    prev: Optional[dict] = None  # the run before, for the per-run change: composite delta, rules fixed and new
    for v in versions:
        vid = str(v["id"])
        summary = {m: rescore(r, scoring) for m, r in (v.get("dqs_summary") or {}).items() if isinstance(r, dict)}
        c = composite_dqs([summary], scoring=scoring)
        f = findings_by_run.get(vid, [])
        fails = failing_rows(f)
        ran = {x["check_id"] for x in f if not (x.get("details") or {}).get("error")}
        failing_ids = {x["check_id"] for x in fails}
        this = {"composite": c["composite"], "ran": ran, "failing": failing_ids}
        change = fixed = new = None
        if prev is not None:
            # only checks that ran cleanly in both runs can be said to have moved
            both = ran & prev["ran"]
            fixed, new = len(both & prev["failing"] - failing_ids), len(both & failing_ids - prev["failing"])
            if c["composite"] is not None and prev["composite"] is not None:
                change = round(c["composite"] - prev["composite"], 1)
        out.append({
            "version_id": vid, "label": v.get("label"), "run_at": v["run_at"].isoformat() if v.get("run_at") else None,
            "baseline": (v.get("metadata") or {}).get("baseline") in (True, "true"),
            "composite": c["composite"], "dimensions": c["dimension_scores"], "modules": c["modules"],
            "critical": sum(int(r.get("critical_count") or 0) for r in summary.values()),
            "high": sum(1 for x in fails if x.get("severity") == "high"),
            "failing_rules": len(fails), "affected_records": failing_records(f),
            "blockers": len(blockers_of(f, members)),
            "auto_fixable_pct": _pct(fixes_by_run.get(vid, 0), failing_records(f)),
            "change": change, "rules_fixed": fixed, "rules_new": new,
        })
        prev = this
    return out


def trend_annotations(versions: list[dict]) -> list[dict]:
    out, last = [], None
    for v in versions:
        meta = v.get("metadata") or {}
        if meta.get("baseline") in (True, "true"):
            out.append({"version_id": str(v["id"]), "kind": "event", "label": "Baseline pinned"})
        if last is not None and meta.get("scoring") != last:
            out.append({"version_id": str(v["id"]), "kind": "change", "label": "Scoring settings changed"})
        last = meta.get("scoring")
    return out


def cleansing_steps(failing_n: int, proposed: int, high: int, approved: int, applied: int) -> list[dict]:
    return [{"key": k, "label": label, "records": n} for k, label, n in (
        ("failing", "Failing records", failing_n), ("proposed", "With a proposed value", proposed),
        ("high", "High confidence", high), ("approved", "Approved", approved), ("applied", "Applied", applied))]


# ── loaders (sync Session, tenant already set) ───────────────────────────────

def resolve_version(s: Session, tid: str, vid: Optional[str]) -> Optional[dict]:
    """The requested run, else the tenant's latest complete one."""
    vid = vid or latest_run_sync(s, tid)
    if not vid:
        return None
    return _one(s, "SELECT id, label, run_at, status, dqs_summary, metadata FROM analysis_versions "
                   "WHERE id = CAST(:v AS uuid) AND tenant_id = :t", v=str(vid), t=tid)


def lineage_of(version: dict) -> str:
    """The run's lineage key: its system id, or ``upload:<sorted modules>`` (api/services/run_lineage.py)."""
    return lineage_key(version.get("metadata"), version.get("dqs_summary"), version.get("label"))


def previous_version(s: Session, tid: str, version: dict) -> Optional[dict]:
    """The prior complete run of the same lineage (same system, or uploads of the same objects)."""
    return _one(s, f"""
        SELECT id, label, run_at, status, dqs_summary, metadata FROM analysis_versions
         WHERE tenant_id = :t AND {lineage_sql()} = :l
           AND run_at < :r AND dqs_summary IS NOT NULL AND {_COMPLETE}
         ORDER BY run_at DESC LIMIT 1""", t=tid, l=lineage_of(version), r=version["run_at"])


_FINDING_COLS = ("module, check_id, severity, dimension, affected_count, total_count, pass_rate, details, "
                 "rule_context, cost_at_risk")


def load_run_findings(s: Session, tid: str, vid: str, module: Optional[str] = None) -> list[dict]:
    return _all(s, f"SELECT {_FINDING_COLS} FROM findings WHERE version_id = CAST(:v AS uuid) AND tenant_id = :t "
                   "AND (CAST(:m AS text) IS NULL OR module = CAST(:m AS text))", v=str(vid), t=tid, m=module)


def load_fixes_by_check(s: Session, tid: str, vid: str, module: Optional[str] = None) -> dict[str, int]:
    """check_id -> distinct records with a proposed value."""
    rows = _all(s, "SELECT check_id, count(DISTINCT record_id) AS n FROM record_fixes "
                   "WHERE version_id = CAST(:v AS uuid) AND tenant_id = :t AND COALESCE(suggested_value, '') <> '' "
                   "AND (CAST(:m AS text) IS NULL OR module = CAST(:m AS text)) GROUP BY check_id",
                v=str(vid), t=tid, m=module)
    return {r["check_id"]: int(r["n"]) for r in rows}


def load_fix_records(s: Session, tid: str, vid: str, module: Optional[str] = None) -> int:
    return int((_one(s, "SELECT count(DISTINCT record_id) AS n FROM record_fixes "
                        "WHERE version_id = CAST(:v AS uuid) AND tenant_id = :t AND COALESCE(suggested_value, '') <> '' "
                        "AND (CAST(:m AS text) IS NULL OR module = CAST(:m AS text))",
                     v=str(vid), t=tid, m=module) or {"n": 0})["n"])


_HIGH_SQL = """
    FROM remediation_items ri
   WHERE ri.tenant_id = :t AND ri.confidence = 'high'
     AND (CAST(:m AS text) IS NULL OR ri.module = CAST(:m AS text))
     AND EXISTS (SELECT 1 FROM finding_records fr
                  WHERE fr.tenant_id = :t AND fr.version_id = CAST(:v AS uuid)
                    AND fr.check_id = ri.check_id AND fr.record_key = ri.record_key)"""


def load_high_confidence(s: Session, tid: str, vid: str, module: Optional[str] = None) -> int:
    return int((_one(s, "SELECT count(*) AS n " + _HIGH_SQL, v=str(vid), t=tid, m=module) or {"n": 0})["n"])


def load_waves(s: Session, tid: str) -> list[dict]:
    return _all(s, "SELECT name, modules FROM migration_waves WHERE tenant_id = :t ORDER BY target_date NULLS LAST, name",
                t=tid)


def load_cost_model(s: Session, tid: str) -> dict:
    return (_one(s, "SELECT cost_model FROM tenants WHERE id = :t", t=tid) or {}).get("cost_model") or {}


def load_impact_rows(s: Session, tid: str, vid: str, cost_model: dict) -> list[dict]:
    """Priced config-impact rows with their L1; a feature the tenant has not priced is skipped."""
    prices = cost_model.get("features") or {}
    l1 = feature_l1()
    out = []
    for r in _all(s, "SELECT feature, status, total_affected_records, blocking_findings FROM config_impact_results "
                     "WHERE version_id = CAST(:v AS uuid) AND tenant_id = :t", v=str(vid), t=tid):
        price = prices.get(r["feature"])
        if price is None:
            continue
        n = int(r["total_affected_records"] or 0)
        out.append({"feature": r["feature"], "l1": l1.get(r["feature"]), "status": r["status"], "record_count": n,
                    "value_per_record": price, "value_at_risk": value_at_risk(n, price),
                    "causing_rules": r["blocking_findings"]})
    return out


def cluster_record_counts(s: Session, tid: str, vid: str, clusters: list[dict]) -> list[dict]:
    """Fill each cluster's distinct failing records from finding_records. A cluster with no stored
    keys, or with more than CLEAN_KEY_CEILING, keeps sum(affected) and ``records_estimated``."""
    for c in clusters:
        n = int((_one(s, """
            SELECT count(*) AS n FROM (
              SELECT DISTINCT record_key FROM finding_records
               WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m
                 AND check_id = ANY(CAST(:ids AS text[])) LIMIT :cap) x""",
                     t=tid, v=str(vid), m=c["module"], ids=c["rules"], cap=CLEAN_KEY_CEILING + 1) or {"n": 0})["n"])
        if 0 < n <= CLEAN_KEY_CEILING:
            c["records"], c["records_estimated"] = n, False
    return clusters


def load_origins(s: Session, tid: str, vid: str, check_ids: list[str]) -> dict[str, dict]:
    rows = _all(s, "SELECT check_id, status, origins FROM finding_root_causes WHERE tenant_id = :t "
                   "AND version_id = CAST(:v AS uuid) AND check_id = ANY(CAST(:ids AS text[]))",
                t=tid, v=str(vid), ids=check_ids)
    return {r["check_id"]: r for r in rows}


def load_clusters(s: Session, tid: str, vid: str, module: Optional[str], findings: Optional[list[dict]] = None,
                  fixes: Optional[dict[str, int]] = None) -> list[dict]:
    findings = load_run_findings(s, tid, vid, module) if findings is None else findings
    fixes = load_fixes_by_check(s, tid, vid, module) if fixes is None else fixes
    top = cluster_findings(findings, fixes)[:CLUSTER_LIMIT]
    cluster_record_counts(s, tid, vid, top)
    origins = load_origins(s, tid, vid, [c["worst_rule"] for c in top])
    for c in top:
        c["origin"] = origin_of(origins.get(c["worst_rule"]))
    return top


# ── endpoint payloads ────────────────────────────────────────────────────────

def overview(s: Session, tid: str, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
    v = resolve_version(s, tid, vid)
    if not v:
        return None
    prev = previous_version(s, tid, v)
    vid = str(v["id"])
    findings = load_run_findings(s, tid, vid, module)
    fixes = load_fixes_by_check(s, tid, vid, module)
    cost_model = load_cost_model(s, tid)
    return overview_from({
        "version": v, "previous": prev, "module": module, "findings": findings,
        "previous_findings": load_run_findings(s, tid, str(prev["id"]), module) if prev else [],
        "scoring": load_scoring(s, tid), "waves": load_waves(s, tid), "fixes_by_check": fixes,
        "fix_records": load_fix_records(s, tid, vid, module), "high_confidence": load_high_confidence(s, tid, vid, module),
        "impact_rows": load_impact_rows(s, tid, vid, cost_model), "currency": tenant_currency(cost_model),
        "clusters": load_clusters(s, tid, vid, module, findings, fixes),
    })


def rules(s: Session, tid: str, vid: Optional[str], module: Optional[str], *, severity: Optional[str] = None,
          dimension: Optional[str] = None, auto_fixable: bool = False, s4_only: bool = False,
          limit: int = 50) -> Optional[dict]:
    v = resolve_version(s, tid, vid)
    if not v:
        return None
    prev = previous_version(s, tid, v)
    rows = rule_rows(load_run_findings(s, tid, str(v["id"]), module),
                     load_run_findings(s, tid, str(prev["id"]), module) if prev else None,
                     load_fixes_by_check(s, tid, str(v["id"]), module), module=module, severity=severity,
                     dimension=dimension, auto_fixable=auto_fixable, s4_only=s4_only)
    return {"version_id": str(v["id"]), "rows": rows[:limit]}


def root_causes(s: Session, tid: str, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
    v = resolve_version(s, tid, vid)
    if not v:
        return None
    clusters = load_clusters(s, tid, str(v["id"]), module)
    for c in clusters:
        c.pop("worst_rule", None)
    return {"version_id": str(v["id"]), "clusters": clusters}


def heatmap(s: Session, tid: str, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
    v = resolve_version(s, tid, vid)
    if not v:
        return None
    thresholds = scoring_config(load_scoring(s, tid))["thresholds"]
    return {"version_id": str(v["id"]), "dimensions": [*DIMENSIONS, "composite"],
            "rows": heatmap_rows(v.get("dqs_summary") or {}, thresholds, module)}


def trends(s: Session, tid: str, vid: Optional[str], system_id: Optional[str], limit: int = 12) -> Optional[dict]:
    v = resolve_version(s, tid, vid)
    if not v:
        return None
    lineage = system_id or lineage_of(v)
    versions = list(reversed(_all(s, f"""
        SELECT id, label, run_at, dqs_summary, metadata FROM analysis_versions
         WHERE tenant_id = :t AND {lineage_sql()} = :l
           AND dqs_summary IS NOT NULL AND {_COMPLETE}
         ORDER BY run_at DESC LIMIT :n""", t=tid, l=lineage, n=limit)))
    ids = [str(x["id"]) for x in versions]
    by_run: dict[str, list[dict]] = {i: [] for i in ids}
    for f in _all(s, "SELECT version_id, module, check_id, severity, affected_count, details FROM findings "
                     "WHERE tenant_id = :t AND version_id = ANY(CAST(:ids AS uuid[]))", t=tid, ids=ids):
        by_run[str(f.pop("version_id"))].append(f)
    fixes = {str(r["version_id"]): int(r["n"]) for r in _all(
        s, "SELECT version_id, count(DISTINCT record_id) AS n FROM record_fixes WHERE tenant_id = :t "
           "AND version_id = ANY(CAST(:ids AS uuid[])) AND COALESCE(suggested_value, '') <> '' GROUP BY version_id",
        t=tid, ids=ids)}
    return {"lineage": lineage,
            "runs": trend_runs(versions, by_run, fixes, load_scoring(s, tid)),
            "annotations": trend_annotations(versions)}


def cleansing(s: Session, tid: str, vid: Optional[str], module: Optional[str]) -> Optional[dict]:
    v = resolve_version(s, tid, vid)
    if not v:
        return None
    vid = str(v["id"])
    findings = load_run_findings(s, tid, vid, module)
    fixes = load_fixes_by_check(s, tid, vid, module)
    queue = _one(s, """
        SELECT count(*) FILTER (WHERE status IN ('approved', 'applied')) AS approved,
               count(*) FILTER (WHERE status = 'applied') AS applied
          FROM cleaning_queue WHERE tenant_id = :t AND version_id = CAST(:v AS uuid)
           AND (CAST(:m AS text) IS NULL OR object_type = CAST(:m AS text))""", t=tid, v=vid, m=module) or {}
    high_by_rule = {r["check_id"]: int(r["n"]) for r in _all(
        s, "SELECT ri.check_id, count(*) AS n " + _HIGH_SQL + " GROUP BY ri.check_id", t=tid, v=vid, m=module)}
    high_by_module = {r["module"]: int(r["n"]) for r in _all(
        s, "SELECT ri.module, count(*) AS n " + _HIGH_SQL + " GROUP BY ri.module", t=tid, v=vid, m=module)}
    proposed_by_module = {r["module"]: int(r["n"]) for r in _all(
        s, "SELECT module, count(DISTINCT record_id) AS n FROM record_fixes WHERE tenant_id = :t "
           "AND version_id = CAST(:v AS uuid) AND COALESCE(suggested_value, '') <> '' "
           "AND (CAST(:m AS text) IS NULL OR module = CAST(:m AS text)) GROUP BY module", t=tid, v=vid, m=module)}
    # Records, not rule failures: the later steps (proposed, approved, applied) count records too.
    fail_by_module = distinct_failing_records(findings, v.get("dqs_summary"))
    by_rule = sorted(({"check_id": c, "proposed": n, "high": high_by_rule.get(c, 0), "auto": n > 0}
                      for c, n in fixes.items()), key=lambda r: (-r["proposed"], r["check_id"]))[:20]
    return {
        "version_id": vid, "currency": tenant_currency(load_cost_model(s, tid)),
        "steps": cleansing_steps(sum(fail_by_module.values()), load_fix_records(s, tid, vid, module),
                                 sum(high_by_rule.values()), int(queue.get("approved") or 0),
                                 int(queue.get("applied") or 0)),
        "by_module": [{"module": m, "failing": n, "proposed": proposed_by_module.get(m, 0),
                       "high": high_by_module.get(m, 0)} for m, n in sorted(fail_by_module.items())],
        "by_rule": by_rule,
    }


# ── current state: every object at the latest finished run of its lineage ────
#
# The run set is ``api.routes.findings._latest_version_ids`` (the latest complete run per lineage, the set
# GET /findings/aggregate reads by default), passed in by the route. Dedupe: an object (a module) measured by
# more than one of those runs, e.g. accounts_payable read from a system and also uploaded, is taken once, from
# the newest of them (``run_at``, then id); its findings, fixes, queue and root causes come from that run only.
# A run "measures" an object when the module is in its ``dqs_summary`` or it has findings for it. This is the
# frontend's ``stateObjects``/``currentObjectRows`` rule (frontend/lib/current-state.ts).

_CURRENT_OBJECTS_SQL = """
    SELECT DISTINCT ON (module) module, id::text AS version_id FROM (
        SELECT av.id, av.run_at, k.module FROM analysis_versions av
         CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(av.dqs_summary) = 'object'
                                                   THEN av.dqs_summary ELSE '{}'::jsonb END) AS k(module)
         WHERE av.tenant_id = :t AND av.id = ANY(CAST(:ids AS uuid[]))
        UNION
        SELECT av.id, av.run_at, f.module FROM analysis_versions av
          JOIN findings f ON f.version_id = av.id AND f.tenant_id = :t
         WHERE av.tenant_id = :t AND av.id = ANY(CAST(:ids AS uuid[]))
    ) x
     WHERE CAST(:m AS text) IS NULL OR module = CAST(:m AS text)
     ORDER BY module, run_at DESC, id DESC"""


def current_objects(s: Session, tid: str, version_ids: list, module: Optional[str] = None) -> list[dict]:
    """``[{module, version_id}]``, ordered by module: each object once, from the newest of ``version_ids`` (the
    current runs) that measured it (see the rule above). ``module`` keeps only that object."""
    if not version_ids:
        return []
    return _all(s, _CURRENT_OBJECTS_SQL, t=tid, ids=[str(i) for i in version_ids], m=module)


def _current_runs(s: Session, tid: str, objects: list[dict]) -> list[dict]:
    """The runs that own at least one current object, newest first."""
    ids = sorted({o["version_id"] for o in objects})
    if not ids:
        return []
    return _all(s, "SELECT id, label, run_at, dqs_summary, metadata FROM analysis_versions "
                   "WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[])) ORDER BY run_at DESC, id DESC",
                t=tid, ids=ids)


def _scope_fields(objects: list[dict], runs: list[dict]) -> dict:
    return {"scope": "current", "version_ids": [str(r["id"]) for r in runs],
            "objects": [{"module": o["module"], "version_id": o["version_id"]} for o in objects]}


def _current_impact_rows(s: Session, tid: str, runs: list[dict], cost_model: dict) -> list[dict]:
    """Priced config-impact rows of the current runs. ``config_impact_results`` is per run and feature, not per
    object, so a feature computed by more than one current run is taken once, from the newest of them (the same
    newer-run-wins rule as an object)."""
    out: dict[str, dict] = {}
    for r in runs:  # newest first
        for row in load_impact_rows(s, tid, str(r["id"]), cost_model):
            out.setdefault(row["feature"], row)
    return sorted(out.values(), key=lambda r: r["feature"])


def _sum_by(rows: list[dict[str, int]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for d in rows:
        for k, n in d.items():
            out[k] = out.get(k, 0) + n
    return out


def _per_object(s: Session, tid: str, objects: list[dict]) -> tuple[dict[str, list[dict]], dict[str, dict[str, int]]]:
    """Each object's findings and proposed fixes, from its own run only."""
    findings_of = {o["module"]: load_run_findings(s, tid, o["version_id"], o["module"]) for o in objects}
    fixes_of = {o["module"]: load_fixes_by_check(s, tid, o["version_id"], o["module"]) for o in objects}
    return findings_of, fixes_of


def _current_clusters(s: Session, tid: str, objects: list[dict], findings_of: dict[str, list[dict]],
                      fixes_of: dict[str, dict[str, int]]) -> list[dict]:
    """Root-cause clusters over the objects, each from its object's own run (a cluster never spans objects), the
    worst CLUSTER_LIMIT overall. Each cluster carries the ``version_id`` it was computed in."""
    out = []
    for o in objects:
        for c in load_clusters(s, tid, o["version_id"], o["module"], findings_of[o["module"]], fixes_of[o["module"]]):
            out.append({**c, "version_id": o["version_id"]})
    out.sort(key=lambda c: (-c["impact"], c["key"]))
    return out[:CLUSTER_LIMIT]


def current_overview(s: Session, tid: str, version_ids: list, module: Optional[str]) -> dict:
    """The overview over the current state. No single previous run exists for a set of lineages, so
    ``previous_version_id``, ``dqs.previous``, ``dqs.delta`` and ``blockers.previous`` are None."""
    objects = current_objects(s, tid, version_ids, module)
    runs = _current_runs(s, tid, objects)
    summaries = {str(r["id"]): r.get("dqs_summary") or {} for r in runs}
    merged = {o["module"]: summaries[o["version_id"]][o["module"]] for o in objects
              if o["module"] in summaries.get(o["version_id"], {})}
    findings_of, fixes_of = _per_object(s, tid, objects)
    cost_model = load_cost_model(s, tid)
    out = overview_from({
        "version": {"id": None, "label": None, "run_at": runs[0]["run_at"] if runs else None, "dqs_summary": merged},
        "previous": None, "module": module, "findings": [f for o in objects for f in findings_of[o["module"]]],
        "previous_findings": [], "scoring": load_scoring(s, tid), "waves": load_waves(s, tid),
        "fixes_by_check": _sum_by(list(fixes_of.values())),
        "fix_records": sum(load_fix_records(s, tid, o["version_id"], o["module"]) for o in objects),
        "high_confidence": sum(load_high_confidence(s, tid, o["version_id"], o["module"]) for o in objects),
        "impact_rows": _current_impact_rows(s, tid, runs, cost_model), "currency": tenant_currency(cost_model),
        "clusters": _current_clusters(s, tid, objects, findings_of, fixes_of),
    })
    return {**out, **_scope_fields(objects, runs)}


def current_root_causes(s: Session, tid: str, version_ids: list, module: Optional[str]) -> dict:
    objects = current_objects(s, tid, version_ids, module)
    findings_of, fixes_of = _per_object(s, tid, objects)
    clusters = _current_clusters(s, tid, objects, findings_of, fixes_of)
    for c in clusters:
        c.pop("worst_rule", None)
    return {"version_id": None, **_scope_fields(objects, _current_runs(s, tid, objects)), "clusters": clusters}


def current_cleansing(s: Session, tid: str, version_ids: list, module: Optional[str]) -> dict:
    """The cleansing funnel over the current state: each object's counts from its own run (``cleansing`` scoped
    to that run and object), summed. A rule belongs to one object, so per-rule rows never double count."""
    objects = current_objects(s, tid, version_ids, module)
    parts = [p for o in objects if (p := cleansing(s, tid, o["version_id"], o["module"]))]
    steps = cleansing_steps(0, 0, 0, 0, 0)
    for p in parts:
        for st, add in zip(steps, p["steps"]):
            st["records"] += add["records"]
    by_rule: dict[str, dict] = {}
    for p in parts:
        for r in p["by_rule"]:
            row = by_rule.setdefault(r["check_id"], {"check_id": r["check_id"], "proposed": 0, "high": 0, "auto": False})
            row["proposed"] += r["proposed"]
            row["high"] += r["high"]
            row["auto"] = row["auto"] or r["auto"]
    return {
        "version_id": None, **_scope_fields(objects, _current_runs(s, tid, objects)),
        "currency": tenant_currency(load_cost_model(s, tid)),
        "steps": steps,
        "by_module": sorted((m for p in parts for m in p["by_module"]), key=lambda m: m["module"]),
        "by_rule": sorted(by_rule.values(), key=lambda r: (-r["proposed"], r["check_id"]))[:20],
    }


# ── shared gather for the board PDF and the analyst workbook ─────────────────

def gather(s: Session, tid: str, vid: Optional[str], compare: Optional[str] = None,
           module: Optional[str] = None, trend_limit: int = 12) -> Optional[dict]:
    """Everything the board report and the workbook need, loaded once. ``compare`` is an explicit
    earlier run: without it nothing is compared and deltas read "no earlier run"."""
    from api.services.pdf_reports import load_system

    v = resolve_version(s, tid, vid)
    if not v:
        return None
    vid = str(v["id"])
    prev = resolve_version(s, tid, compare) if compare else None
    findings = load_run_findings(s, tid, vid, module)
    fixes = load_fixes_by_check(s, tid, vid, module)
    cost_model = load_cost_model(s, tid)
    clusters = load_clusters(s, tid, vid, module, findings, fixes)
    scoring = load_scoring(s, tid)
    data = {
        "version": v, "previous": prev, "module": module, "findings": findings, "fixes_by_check": fixes,
        "previous_findings": load_run_findings(s, tid, str(prev["id"]), module) if prev else [],
        "scoring": scoring, "waves": load_waves(s, tid), "fix_records": load_fix_records(s, tid, vid, module),
        "high_confidence": load_high_confidence(s, tid, vid, module),
        "impact_rows": load_impact_rows(s, tid, vid, cost_model), "currency": tenant_currency(cost_model),
        "clusters": clusters, "system": load_system(s, tid, v),
        "trend": trends(s, tid, vid, None, trend_limit), "cleansing": cleansing(s, tid, vid, module),
    }
    data["overview"] = overview_from(data)
    return data

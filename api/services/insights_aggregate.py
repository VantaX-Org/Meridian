"""Deterministic aggregation behind the /insights overview, rules, root-cause, heatmap, trend and
cleansing endpoints, the board PDF and the analyst workbook. No LLM is called here.

Two layers: pure functions over plain rows (unit tested with fixtures) and sync loaders over a
``Session`` already scoped to the tenant (``AsyncSession.run_sync`` for routes, ``tenant_session``
for the report builders). Impact is always grouped by L1 and never summed across L1s.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from api.routes.findings import _COMPLETE, composite_dqs
from api.services import s4_readiness
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


def narrative(*, run_id: str, dqs: dict, deltas: dict, blockers: dict, conc: Optional[tuple[str, float]],
              wave_names: list[str], auto: dict, top_cluster: Optional[dict]) -> list[dict]:
    """At most four sentences, always in the same order, from the figures alone."""
    out = [{"text": _score_sentence(dqs, deltas), "href": f"/insights/trends?run={run_id}"}]
    n = blockers["count"]
    if n:
        s = f"{n} blocking {'rule fails' if n == 1 else 'rules fail'}"
        if wave_names:
            s += f", holding up {wave_names[0]}" + (f" and {len(wave_names) - 1} more" if len(wave_names) > 1 else "")
        if conc:
            s += f"; {conc[1] * 100:.0f}% sit in {fmt_module(conc[0])}"
        out.append({"text": s + ".", "href": f"/insights/readiness?run={run_id}"})
    else:
        out.append({"text": "No blocking rule fails.", "href": f"/insights/readiness?run={run_id}"})
    if auto["pct"] is not None:
        out.append({"text": f"{auto['pct']:.0f}% of failing records have a proposed fix, "
                            f"{auto['high_confidence']:,} at high confidence.",
                    "href": f"/insights/rules?run={run_id}&auto_fixable=true"})
    if top_cluster:
        label = f"{fmt_module(top_cluster['module'])} {top_cluster['field']}" if top_cluster["field"] \
            else f"{fmt_module(top_cluster['module'])} rules with no named field"
        out.append({"text": f"The largest root cause is {label}, across {len(top_cluster['rules'])} "
                            f"{'rule' if len(top_cluster['rules']) == 1 else 'rules'}.",
                    "href": f"/insights/rules?run={run_id}"
                            + (f"&field={top_cluster['table']}.{top_cluster['field']}" if top_cluster["table"] else "")})
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
    run_id = str(v["id"])
    return {
        "version_id": run_id, "run_label": v.get("label"),
        "run_at": v["run_at"].isoformat() if v.get("run_at") else None,
        "previous_version_id": str(prev["id"]) if prev else None,
        "dqs": dqs, "blockers": blockers, "auto_fixable": auto,
        "value_at_risk": {"worst_l1": worst, "worst_l1_amount": amount, "currency": data["currency"],
                          "features_blocked": sum(1 for r in data["impact_rows"] if r["record_count"] > 0)},
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
    for v in versions:
        vid = str(v["id"])
        summary = {m: rescore(r, scoring) for m, r in (v.get("dqs_summary") or {}).items() if isinstance(r, dict)}
        c = composite_dqs([summary], scoring=scoring)
        f = findings_by_run.get(vid, [])
        out.append({
            "version_id": vid, "label": v.get("label"), "run_at": v["run_at"].isoformat() if v.get("run_at") else None,
            "baseline": (v.get("metadata") or {}).get("baseline") in (True, "true"),
            "composite": c["composite"], "dimensions": c["dimension_scores"], "modules": c["modules"],
            "critical": sum(int(r.get("critical_count") or 0) for r in summary.values()),
            "blockers": len(blockers_of(f, members)),
            "auto_fixable_pct": _pct(fixes_by_run.get(vid, 0), failing_records(f)),
        })
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
    if vid:
        return _one(s, "SELECT id, label, run_at, status, dqs_summary, metadata FROM analysis_versions "
                       "WHERE id = CAST(:v AS uuid) AND tenant_id = :t", v=str(vid), t=tid)
    return _one(s, f"SELECT id, label, run_at, status, dqs_summary, metadata FROM analysis_versions "
                   f"WHERE tenant_id = :t AND {_COMPLETE} ORDER BY run_at DESC LIMIT 1", t=tid)


def lineage_of(version: dict) -> str:
    return (version.get("metadata") or {}).get("system_id") or "upload"


def previous_version(s: Session, tid: str, version: dict) -> Optional[dict]:
    """The prior complete run of the same lineage (same system, or uploads)."""
    return _one(s, f"""
        SELECT id, label, run_at, status, dqs_summary, metadata FROM analysis_versions
         WHERE tenant_id = :t AND COALESCE(metadata->>'system_id', 'upload') = :l
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
    return {"version_id": str(v["id"]), "total_impact": sum(r["impact"] for r in rows), "rows": rows[:limit]}


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
         WHERE tenant_id = :t AND COALESCE(metadata->>'system_id', 'upload') = :l
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
    fail_by_module: dict[str, int] = {}
    for f in failing_rows(findings):
        fail_by_module[f["module"]] = fail_by_module.get(f["module"], 0) + int(f["affected_count"])
    by_rule = sorted(({"check_id": c, "proposed": n, "high": high_by_rule.get(c, 0), "auto": n > 0}
                      for c, n in fixes.items()), key=lambda r: (-r["proposed"], r["check_id"]))[:20]
    return {
        "version_id": vid, "currency": tenant_currency(load_cost_model(s, tid)),
        "steps": cleansing_steps(failing_records(findings), load_fix_records(s, tid, vid, module),
                                 sum(high_by_rule.values()), int(queue.get("approved") or 0),
                                 int(queue.get("applied") or 0)),
        "by_module": [{"module": m, "failing": n, "proposed": proposed_by_module.get(m, 0),
                       "high": high_by_module.get(m, 0)} for m, n in sorted(fail_by_module.items())],
        "by_rule": by_rule,
    }

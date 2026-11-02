"""What Aletheia found: ranked, deterministic findings over the current state, what changed since each object's
previous run, and the proof of value of every finding a person acted on. No LLM is called here.

Built only from existing aggregates: ``insights_aggregate.rule_rows`` (impact, change, cost at risk),
``finding_root_causes`` (the driver), ``config_impact_results`` (money at risk per feature), the self-tune
proposals (rule precision) and ``proven_cost_results`` (money already lost). Nothing here is sent to an LLM
except through ``api/services/assistant.py``, which receives rule ids, field names and counts only.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from api.routes.findings import _COMPLETE
from api.services import insights_aggregate as agg
from api.services.insights_impact import tenant_currency
from api.services.pdf_reports import _all, _one
from api.services.run_lineage import lineage_sql

TOP = 6          # findings shown in the band
MOVERS = 3       # rules shown per object under "what changed"
SPARK_RUNS = 8   # runs of the lineage in each sparkline
CROSS_CHECK = "XSYS"  # ledger check_id of the cross-system finding (no rule behind it; the count is the baseline)


def score_of(version: Optional[dict], module: str) -> Optional[float]:
    s = ((version or {}).get("dqs_summary") or {}).get(module)
    v = s.get("composite_score") if isinstance(s, dict) else None
    return None if v is None else round(float(v), 2)


def action_for(row: dict, tunable: dict[str, dict], dupes: Optional[dict[str, int]] = None,
               owned: Optional[set] = None) -> dict:
    """One recommended action with a backend behind it: draft the tuned rule version when steward verdicts say the
    rule over-flags; review duplicates when a uniqueness rule fails and match & merge holds pairs waiting for review
    on the object (``dupes``: pending review pairs by module); assign an owner when neither the rule nor its object
    has an owner or steward in ``data_owners`` (``owned``: rule ids and modules that do; None means not loaded);
    else draft a cleansing batch when proposed values exist, else open the rule. Assign goes before cleanse because
    a drafted batch notifies the owners and nobody is told when there are none."""
    if row["check_id"] in tunable:
        return {"kind": "tune"}
    pairs = (dupes or {}).get(row.get("module") or "", 0)
    if row.get("dimension") == "uniqueness" and pairs > 0:
        return {"kind": "merge", "pairs": pairs}
    if owned is not None and row["check_id"] not in owned and row.get("module") not in owned:
        return {"kind": "assign"}
    if (row.get("auto_fix_pct") or 0) > 0:
        return {"kind": "cleanse"}
    return {"kind": "open"}


def confidence_of(origin: dict, tune: Optional[dict]) -> Optional[dict]:
    """How sure the finding is: the steward-judged precision when the rule is rated, else the share of failing
    values from the dominant origin. None when neither is measured (shown as a dash)."""
    if tune and tune.get("precision_before") is not None:
        return {"basis": "precision", "value": round(float(tune["precision_before"]), 3)}
    if origin.get("status") == "computed" and origin.get("share") is not None:
        return {"basis": "origin_share", "value": origin["share"]}
    return None


def rank(rows: list[dict], top: int = TOP) -> list[dict]:
    """Highest impact first; ties by the largest rise since the previous run, then rule id."""
    return sorted(rows, key=lambda r: (-r["impact"], -(r.get("delta_affected") or 0), r["check_id"]))[:top]


def movers(rows: list[dict], n: int = MOVERS) -> list[dict]:
    moved = [r for r in rows if r.get("delta_affected")]
    moved.sort(key=lambda r: (-abs(r["delta_affected"]), r["check_id"]))
    return [{"check_id": r["check_id"], "name": r["name"], "delta_affected": r["delta_affected"]} for r in moved[:n]]


def proof(acted: dict, affected_now: Optional[int], score_now: Optional[float], now_version: Optional[str]) -> dict:
    """The realised result of one acted finding. ``waiting`` until a newer run measured the object."""
    waiting = now_version is None or now_version == str(acted["version_id"])
    before_a, before_s = acted.get("affected_before"), acted.get("score_before")
    return {"waiting": waiting,
            "affected_now": None if waiting else affected_now,
            "score_now": None if waiting else score_now,
            "reduction": None if waiting or affected_now is None or before_a is None else before_a - affected_now,
            "gain": None if waiting or score_now is None or before_s is None else round(score_now - float(before_s), 2)}


# ── loaders (sync Session, tenant already set) ───────────────────────────────

def _spark(s: Session, tid: str, version: dict, module: str, check_ids: list[str]) -> dict[str, list]:
    """Each rule's failing-record count over the lineage's last SPARK_RUNS runs, oldest first; None where a run
    has no finding row for the rule."""
    if not check_ids:
        return {}
    runs = _all(s, f"""
        SELECT id::text AS id FROM analysis_versions
         WHERE tenant_id = :t AND {lineage_sql()} = :l AND run_at <= :r AND {_COMPLETE}
         ORDER BY run_at DESC LIMIT :n""", t=tid, l=agg.lineage_of(version), r=version["run_at"], n=SPARK_RUNS)
    ids = [r["id"] for r in reversed(runs)]
    got = {(r["v"], r["check_id"]): int(r["affected_count"] or 0) for r in _all(s, """
        SELECT version_id::text AS v, check_id, affected_count FROM findings
         WHERE tenant_id = :t AND module = :m AND version_id = ANY(CAST(:ids AS uuid[]))
           AND check_id = ANY(CAST(:c AS text[]))""", t=tid, m=module, ids=ids, c=check_ids)}
    return {c: [got.get((v, c)) for v in ids] for c in check_ids}


def _money(row: dict, impact_rows: list[dict], currency: str) -> dict:
    feats = [{"feature": r["feature"], "l1": r["l1"], "value_at_risk": r["value_at_risk"]}
             for r in impact_rows if row["check_id"] in (r.get("causing_rules") or [])]
    return {"cost_at_risk": row.get("cost_at_risk"), "currency": currency, "features": feats}


def load_acted(s: Session, tid: str) -> list[dict]:
    return _all(s, "SELECT module, check_id, action, version_id::text AS version_id, affected_before, score_before, "
                   "created_at FROM aletheia_actions WHERE tenant_id = :t ORDER BY created_at DESC LIMIT 50", t=tid)


def _proven(s: Session, tid: str, vid: str, check_id: str, currency: str) -> dict[str, float]:
    """Proven cost (money already lost) of the metrics this rule feeds, in the tenant currency, for one run."""
    return {r["metric"]: round(float((r["by_currency"] or {}).get(currency, 0.0)), 2) for r in _all(s, """
        SELECT metric, by_currency FROM proven_cost_results
         WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND :c = ANY(check_ids)""", t=tid, v=vid, c=check_id)}


def cross_findings(cross: dict[str, dict], versions: dict[str, str]) -> list[dict]:
    """One finding per object that has duplicates in more than one connected system. ``cross``: module -> {pairs,
    systems: [{a, b, pairs}]} counted from match_scores (see ``insights._cross_systems``); nothing else feeds it."""
    return [{"id": f"{m}:{CROSS_CHECK}", "module": m, "version_id": versions.get(m), "check_id": CROSS_CHECK,
             "name": "", "field": None, "severity": None, "dimension": "uniqueness", "affected": c["pairs"],
             "total": None, "impact": 0, "delta_affected": None, "auto_fix_pct": None, "spark": [],
             "why": {"origin": {"status": "not_computed", "top": None, "share": None}, "delta_affected": None},
             "money": {"cost_at_risk": None, "currency": "", "features": []}, "confidence": None,
             "action": {"kind": "across", "pairs": c["pairs"], "systems": c["systems"]}}
            for m, c in sorted(cross.items()) if c["pairs"] > 0]


def build(s: Session, tid: str, version_ids: list, module: Optional[str], tunable: dict[str, dict],
          dupes: Optional[dict[str, int]] = None, owned: Optional[set] = None,
          cross: Optional[dict[str, dict]] = None) -> dict:
    """The band over the current state (every object at the latest finished run of its lineage)."""
    objects = agg.current_objects(s, tid, version_ids, module)
    cost_model = agg.load_cost_model(s, tid)
    currency = tenant_currency(cost_model)
    runs = agg._current_runs(s, tid, objects)
    impact_rows = agg._current_impact_rows(s, tid, runs, cost_model)
    candidates, changes, now, names = [], [], {}, {}
    for o in objects:
        mod, vid = o["module"], o["version_id"]
        v = agg.resolve_version(s, tid, vid)
        if not v:
            continue
        prev = agg.previous_version(s, tid, v)
        rows = agg.rule_rows(agg.load_run_findings(s, tid, vid, mod),
                             agg.load_run_findings(s, tid, str(prev["id"]), mod) if prev else None,
                             agg.load_fixes_by_check(s, tid, vid, mod), module=mod)
        now[mod] = (vid, score_of(v, mod), {r["check_id"]: r["affected"] for r in rows})
        sc, ps = score_of(v, mod), score_of(prev, mod)
        changes.append({"module": mod, "version_id": vid, "previous_version_id": str(prev["id"]) if prev else None,
                        "score": sc, "previous": ps,
                        "delta": None if sc is None or ps is None else round(sc - ps, 2), "movers": movers(rows)})
        candidates += [{**r, "version_id": vid, "_v": v} for r in rows]
        names.update({(mod, r["check_id"]): r["name"] for r in rows})
    top = rank(candidates)
    by_run: dict[str, list[dict]] = {}
    for r in top:
        by_run.setdefault(r["version_id"], []).append(r)
    findings = []
    for vid, rows in by_run.items():
        origins = agg.load_origins(s, tid, vid, [r["check_id"] for r in rows])
        for mod in {r["module"] for r in rows}:
            mine = [r for r in rows if r["module"] == mod]
            spark = _spark(s, tid, mine[0]["_v"], mod, [r["check_id"] for r in mine])
            for r in mine:
                origin = agg.origin_of(origins.get(r["check_id"]))
                findings.append({
                    "id": f"{mod}:{r['check_id']}", "module": mod, "version_id": vid, "check_id": r["check_id"],
                    "name": r["name"], "field": r["field"], "severity": r["severity"], "dimension": r["dimension"],
                    "affected": r["affected"], "total": r["total"], "impact": r["impact"],
                    "delta_affected": r["delta_affected"], "auto_fix_pct": r["auto_fix_pct"],
                    "spark": spark.get(r["check_id"], []),
                    "why": {"origin": origin, "delta_affected": r["delta_affected"]},
                    "money": _money(r, impact_rows, currency),
                    "confidence": confidence_of(origin, tunable.get(r["check_id"])),
                    "action": action_for({**r, "module": mod}, tunable, dupes, owned)})
    findings = rank(findings)
    cross = {m: c for m, c in (cross or {}).items() if not module or m == module}
    findings = cross_findings(cross, {m: v[0] for m, v in now.items()}) + findings
    acted = []
    for a in load_acted(s, tid):
        vid_now, score_now, aff = now.get(a["module"], (None, None, {}))
        if a["check_id"] == CROSS_CHECK:  # the count now is the pairs still open, 0 once none are
            aff = {CROSS_CHECK: (cross.get(a["module"]) or {}).get("pairs", 0)}
        p = proof(a, aff.get(a["check_id"], 0 if vid_now else None), score_now, vid_now)
        money = None
        if not p["waiting"]:
            before = _proven(s, tid, a["version_id"], a["check_id"], currency)
            after = _proven(s, tid, vid_now, a["check_id"], currency)
            money = [{"metric": m, "before": before.get(m), "after": after.get(m)}
                     for m in sorted(set(before) | set(after))]
        acted.append({**a, "name": names.get((a["module"], a["check_id"])), "created_at": a["created_at"].isoformat() if a.get("created_at") else None,
                      "score_before": None if a["score_before"] is None else float(a["score_before"]),
                      **p, "proven_cost": money, "currency": currency})
    return {"currency": currency, "findings": findings, "changes": changes, "acted": acted}


def baseline(s: Session, tid: str, version_ids: list, module: str, check_id: str,
             cross: Optional[dict[str, dict]] = None) -> Optional[dict]:
    """The object's current run, its score and the rule's failing records, stored when a person acts. For the
    cross-system finding the failing records are the open cross-system pairs on the object (``cross``)."""
    obj = next(iter(agg.current_objects(s, tid, version_ids, module)), None)
    if not obj:
        return None
    v = agg.resolve_version(s, tid, obj["version_id"])
    if check_id == CROSS_CHECK:
        pairs = (cross or {}).get(module, {}).get("pairs")
        return None if not pairs else {"version_id": obj["version_id"], "score_before": score_of(v, module),
                                       "affected_before": pairs}
    f = _one(s, "SELECT affected_count FROM findings WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) "
                "AND module = :m AND check_id = :c", t=tid, v=obj["version_id"], m=module, c=check_id)
    return {"version_id": obj["version_id"], "score_before": score_of(v, module),
            "affected_before": None if f is None else int(f["affected_count"] or 0)}

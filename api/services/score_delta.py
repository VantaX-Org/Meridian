"""Why a score moved between two runs of one object: a deterministic decomposition plus a verified narrative.

The decomposition uses the real scoring code (api/services/scoring.py: rule_weight, scaled_rate, the cap) and the runs'
stored findings. Every contribution is in points of the composite score; they sum to the stored composite change:

  failing_records  a rule in both runs fails more or fewer records (its population held at the earlier run's)
  record_count     a rule in both runs checked a different number of records (rate effect of the population change)
  new_rule         a rule that ran only in the later run, its marginal effect on its dimension
  removed_rule     a rule that ran only in the earlier run (positive when dropping it raised the score)
  reweighting      per dimension: what is left of the dimension's change once the rules above are taken out
                   (severity changes, shifted denominators, a dimension that appeared or went)
  unexplained      the stored raw score against the one recomputed from findings (a changed scoring config)
  cap              the critical-failure cap: shown change minus measured change

The narrative never sees record values: only rule id, description, dimension and delta points go to the model, and any
sentence with a number that is not in the decomposition is dropped.
"""
from __future__ import annotations

import re
from types import SimpleNamespace
from typing import Optional

from api.services.receipt_math import reweigh
from api.services.scoring import (
    DEFAULT_WEIGHTS, effective_weights, rule_weight, scaled_rate, scoring_config, scoring_dimension,
)
from checks.base import pass_rate_of

SUM_TOLERANCE = 0.05   # points: contributions are rounded to 2 dp, so the sum may drift by a rounding step per row
MIN_POINTS = 0.005
TOP_N = 5


def _rule(row: dict, cfg: dict, affected: Optional[int] = None, total: Optional[int] = None) -> tuple[float, float]:
    """(severity weight, severity-scaled rule score) exactly as scoring.score_module computes them."""
    rate = row["pass_rate"] if affected is None else pass_rate_of(total or 0, affected)
    f = SimpleNamespace(check_id=row["check_id"], severity=row["severity"], pass_rate=float(rate))
    return rule_weight(f, cfg["severity_weights"]), scaled_rate(f, cfg["severity_multipliers"])


def _by_dim(rows: list[dict], cfg: dict) -> dict[str, dict]:
    out: dict[str, dict] = {d: {} for d in DEFAULT_WEIGHTS}
    for r in rows:
        d = scoring_dimension(r["dimension"])
        if d in out:
            w, s = _rule(r, cfg)
            out[d][r["check_id"]] = (w, s, r)
    return out


def _stats(rules: dict) -> tuple[float, float, Optional[float]]:
    num = sum(w * s for w, s, _ in rules.values())
    den = sum(w for w, _, _ in rules.values())
    return num, den, (num / den if den else None)


def _marginal(rules: dict, cid: str, share: float) -> float:
    """Effect on the composite of the rule being in its dimension rather than out of it."""
    w, s, _ = rules[cid]
    num, den, mean = _stats(rules)
    if den <= w:
        return share * (mean or 0.0)
    return share * w * (s - (num - w * s) / (den - w)) / den


def run_scoring(stored: object, fallback: Optional[dict] = None) -> Optional[dict]:
    """A run's stored scoring config (``analysis_versions.metadata.scoring``, the ``scoring_config`` shape) as raw
    tenant scoring input; ``fallback`` (today's ``tenants.dqs_weights``) for a run stored before the config was."""
    if not isinstance(stored, dict) or not isinstance(stored.get("dimension_weights"), dict):
        return fallback
    return {**stored["dimension_weights"], **{k: stored[k] for k in (
        "module_weights", "thresholds", "severity_weights", "severity_multipliers", "critical_tolerance") if k in stored}}


def rule_set_change(fp_a: Optional[str], fp_b: Optional[str], rows_a: list[dict], rows_b: list[dict]) -> dict:
    """Whether run b ran a different rule set from run a: the stored fingerprints differ (a rule's logic, an
    override or the app version changed) or a rule ran in one run only. Unknown fingerprints count as unchanged."""
    ids_a, ids_b = {r["check_id"] for r in rows_a}, {r["check_id"] for r in rows_b}
    added, removed = len(ids_b - ids_a), len(ids_a - ids_b)
    return {"rules_changed": bool(fp_a and fp_b and fp_a != fp_b) or bool(added or removed),
            "rules_added": added, "rules_removed": removed}


def decompose(rows_a: list[dict], rows_b: list[dict], sum_a: dict, sum_b: dict, tenant_scoring: Optional[dict] = None,
              scoring_b: Optional[dict] = None) -> Optional[dict]:
    """Contributions to ``sum_b.composite_score - sum_a.composite_score`` for one module; None when either run has no score.
    ``rows_*`` are findings rows (check_id, severity, dimension, affected_count, total_count, pass_rate) that ran cleanly.
    ``tenant_scoring`` is run a's scoring config, ``scoring_b`` run b's (default: a's): each run's rules are weighted
    under its own config, and what a config change moved lands in ``reweighting``, never in ``failing_records``."""
    ca, cb = sum_a.get("composite_score"), sum_b.get("composite_score")
    ra, rb = sum_a.get("raw_score"), sum_b.get("raw_score")
    if ca is None or cb is None or ra is None or rb is None:
        return None
    scoring_b = tenant_scoring if scoring_b is None else scoring_b
    cfg, cfg_b = scoring_config(tenant_scoring), scoring_config(scoring_b)
    A, B = _by_dim(rows_a, cfg), _by_dim(rows_b, cfg_b)
    sh_a, sh_b = reweigh(sum_a, effective_weights(tenant_scoring))[0], reweigh(sum_b, effective_weights(scoring_b))[0]
    out: list[dict] = []

    def add(kind: str, points: float, dim: Optional[str] = None, a: Optional[dict] = None, b: Optional[dict] = None,
            cid: Optional[str] = None) -> None:
        if abs(points) < MIN_POINTS and kind != "cap":
            return
        row = b or a or {}
        out.append({"kind": kind, "check_id": cid, "dimension": dim, "points": round(points, 2),
                    "before_failing": a["affected_count"] if a else None, "after_failing": b["affected_count"] if b else None,
                    "before_records": a["total_count"] if a else None, "after_records": b["total_count"] if b else None,
                    "severity": row.get("severity")})

    raw_moved = 0.0
    for d in DEFAULT_WEIGHTS:
        da, db = A[d], B[d]
        sa, sb = (sh_a.get(d, 0.0) if da else 0.0), (sh_b.get(d, 0.0) if db else 0.0)
        _, den_a, mean_a = _stats(da)
        _, _, mean_b = _stats(db)
        dim_delta = sb * (mean_b or 0.0) - sa * (mean_a or 0.0)
        raw_moved += dim_delta
        explained = 0.0
        for cid in sorted(set(da) | set(db)):
            if cid in da and cid in db:
                (wa, s_a, a), (_, _, b) = da[cid], db[cid]
                s_mid = _rule(b, cfg, b["affected_count"], a["total_count"])[1]
                s_b = _rule(b, cfg)[1]  # under a's config: a config change is left to reweighting
                f = sa * wa * (s_mid - s_a) / den_a
                c = sa * wa * (s_b - s_mid) / den_a
                add("failing_records", f, d, a, b, cid)
                add("record_count", c, d, a, b, cid)
                explained += f + c
            elif cid in db:
                m = _marginal(db, cid, sb)
                add("new_rule", m, d, None, db[cid][2], cid)
                explained += m
            else:
                m = -_marginal(da, cid, sa)
                add("removed_rule", m, d, da[cid][2], None, cid)
                explained += m
        add("reweighting", dim_delta - explained, d)
    add("unexplained", (rb - ra) - raw_moved)
    add("cap", (cb - rb) - (ca - ra))
    delta = round(cb - ca, 2)
    total = round(sum(c["points"] for c in out), 2)
    out.sort(key=lambda c: -abs(c["points"]))
    return {"before": ca, "after": cb, "delta": delta, "contributions": out, "sum": total,
            "residual": round(delta - total, 2), "within_tolerance": abs(delta - total) <= SUM_TOLERANCE,
            "reproduced": abs((rb - ra) - raw_moved) <= SUM_TOLERANCE, "by_dimension": _by_dimension(out)}


def _by_dimension(contribs: list[dict]) -> list[dict]:
    acc: dict[str, float] = {}
    for c in contribs:
        if c["dimension"]:
            acc[c["dimension"]] = acc.get(c["dimension"], 0.0) + c["points"]
    return [{"dimension": d, "points": round(p, 2)} for d, p in sorted(acc.items(), key=lambda kv: -abs(kv[1]))]


# ── narrative ────────────────────────────────────────────────────────────────

_KIND_PHRASE = {"failing_records": "failing records changed", "record_count": "the number of records checked changed",
                "new_rule": "the rule is new in the later run", "removed_rule": "the rule no longer ran",
                "reweighting": "dimension weighting shifted", "unexplained": "the scoring configuration differs",
                "cap": "the critical-failure cap"}
_NUM = re.compile(r"\d+(?:\.\d+)?")


def _pts(x: float) -> str:
    return f"{abs(x):.2f}"


def _line(c: dict, names: dict[str, str]) -> str:
    cid = c.get("check_id")
    who = f"{cid} ({names[cid]})" if cid and names.get(cid) else (cid or (f"{c['dimension']} dimension" if c.get("dimension") else "The score"))
    return f"{who} {'added' if c['points'] > 0 else 'cost'} {_pts(c['points'])} points: {_KIND_PHRASE[c['kind']]}."


def top_facts(d: dict, names: dict[str, str]) -> list[dict]:
    return [{"rule_id": c.get("check_id"), "description": names.get(c.get("check_id") or ""), "dimension": c["dimension"],
             "kind": c["kind"], "delta_points": c["points"]} for c in d["contributions"][:TOP_N]]


def template_narrative(d: dict, names: dict[str, str], label: str) -> list[str]:
    word = "rose" if d["delta"] > 0 else "fell"
    head = (f"{label} scored {d['before']:.2f} before and {d['after']:.2f} now." if d["delta"] == 0
            else f"{label} {word} from {d['before']:.2f} to {d['after']:.2f}, a change of {_pts(d['delta'])} points.")
    return [head] + [_line(c, names) for c in d["contributions"][:TOP_N]]


def verify(sentences: list[str], d: dict, names: dict[str, str], label: str) -> tuple[list[str], int]:
    """(sentences whose every number is in the decomposition, how many were dropped). Rule ids, descriptions and the
    object label are removed before numbers are read; a number is allowed when it equals a shown score, the change,
    or a top contribution's points (to 1 or 2 places, either sign)."""
    allowed = {d["before"], d["after"], abs(d["delta"])} | {abs(c["points"]) for c in d["contributions"][:TOP_N]}
    ok = {f"{v:.{p}f}" for v in allowed for p in (1, 2)} | {str(int(v)) for v in allowed if v == int(v)}
    strip = sorted({c["check_id"] for c in d["contributions"] if c.get("check_id")} | set(names.values()) | {label},
                   key=len, reverse=True)
    keep, dropped = [], 0
    for s in sentences:
        bare = s
        for token in strip:
            bare = bare.replace(token, " ")
        if all(n in ok for n in _NUM.findall(bare)):
            keep.append(s)
        else:
            dropped += 1
    return keep, dropped


def ai_sentences(facts: list[dict], label: str, before: float, after: float) -> Optional[list[str]]:
    """One sentence per line from the model, or None when AI is unavailable. Sync: run in a threadpool."""
    from llm.provider import get_llm, llm_is_noop, safe_invoke
    if llm_is_noop():
        return None
    lines = "\n".join(f"- {f['rule_id'] or 'overall'}; {f['description'] or 'n/a'}; {f['dimension'] or 'n/a'}; "
                      f"{f['kind']}; {f['delta_points']:+.2f} points" for f in facts)
    prompt = (f"The data quality score of {label} moved from {before:.2f} to {after:.2f}. These are the largest contributions "
              f"(rule; description; dimension; cause; points):\n{lines}\n"
              "Write at most 4 short plain sentences explaining why the score moved. Use only these figures, copied exactly. "
              "Add no other numbers. One sentence per line, no bullets.")
    out = safe_invoke(get_llm(), prompt, timeout_seconds=45, max_tokens=400)
    if not out:
        return None
    return [ln.strip(" -*\t") for ln in out.splitlines() if ln.strip(" -*\t")]


def narrative(d: dict, names: dict[str, str], label: str, generated: Optional[list[str]]) -> dict:
    """The verified narrative: the model's sentences that survive ``verify``, else the template."""
    dropped = 0
    if generated:
        keep, dropped = verify(generated, d, names, label)
        if keep:
            return {"source": "ai", "sentences": keep, "dropped": dropped}
    return {"source": "template", "sentences": template_narrative(d, names, label), "dropped": dropped}

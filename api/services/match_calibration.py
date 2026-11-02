"""Fellegi-Sunter weight calibration from steward decisions.

Accepted pairs are true matches, rejected pairs true non-matches. For each match rule a
field "agrees" on a pair when its stored similarity reaches the rule threshold. Then

    m = P(agree | match)      = (agree_accepted + 1) / (accepted_with_value + 2)
    u = P(agree | non-match)  = (agree_rejected + 1) / (rejected_with_value + 2)

(Laplace smoothing keeps both off 0 and 1), the agreement weight is log2(m/u) and the
disagreement weight log2((1-m)/(1-u)). The recommended rule weight is the field's
agreement weight as a share of all positive agreement weights, in whole percent, at least 1:
a field that agrees as often on non-matches as on matches earns the floor. Pure function,
no I/O: the route reads match_scores and match_rules under RLS and passes them in.
"""

from math import log2
from typing import Optional

from api.services.merge_explain import similarities

MIN_DECISIONS = 10  # per side; fewer and the m/u estimates are noise


def calibrate(rules: list[dict], pairs: list[dict], min_decisions: int = MIN_DECISIONS) -> dict:
    """``rules``: ``[{field, match_type, weight, threshold}]``.
    ``pairs``: match_scores rows with steward_decision and explanation (or field_scores)."""
    decided = [p for p in pairs if p.get("steward_decision") in ("accept", "reject")]
    acc = [similarities(p) for p in decided if p["steward_decision"] == "accept"]
    rej = [similarities(p) for p in decided if p["steward_decision"] == "reject"]

    fields = []
    for r in rules:
        f, thr = r["field"], float(r.get("threshold") if r.get("threshold") is not None else 1.0)

        def counts(rows: list[dict]) -> tuple[int, int]:
            vals = [s[f] for s in rows if s.get(f) is not None]
            return sum(v >= thr for v in vals), len(vals)

        ag_a, n_a = counts(acc)
        ag_r, n_r = counts(rej)
        m, u = (ag_a + 1) / (n_a + 2), (ag_r + 1) / (n_r + 2)
        fields.append({"field": f, "match_type": r["match_type"], "threshold": thr,
                       "current_weight": float(r.get("weight") or 0),
                       "accepted_with_value": n_a, "accepted_agree": ag_a,
                       "rejected_with_value": n_r, "rejected_agree": ag_r,
                       "m": round(m, 4), "u": round(u, 4),
                       "agreement_weight": round(log2(m / u), 4),
                       "disagreement_weight": round(log2((1 - m) / (1 - u)), 4)})

    positive = sum(max(x["agreement_weight"], 0.0) for x in fields)
    for x in fields:
        x["recommended_weight"] = max(1, round(100 * max(x["agreement_weight"], 0.0) / positive)) if positive else (
            int(x["current_weight"]))
    status = "ready" if len(acc) >= min_decisions and len(rej) >= min_decisions else "insufficient"
    return {"status": status, "accepted": len(acc), "rejected": len(rej), "min_decisions": min_decisions,
            "fields": fields}


def recommended_weights(result: dict) -> Optional[dict[str, float]]:
    """Field to recommended weight, or None while the decision sample is too small."""
    if result["status"] != "ready":
        return None
    return {x["field"]: float(x["recommended_weight"]) for x in result["fields"]}

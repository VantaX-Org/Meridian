"""Merge explainability: pure, deterministic functions (no I/O).

- ``explain_pair``      per-attribute match explanation for a candidate pair:
                        comparator, normalised (masked) values, similarity, weight,
                        contribution to the total, per-rule threshold and the band
                        (auto_merge / steward_review / auto_dismiss) that fired.
- ``survive_cluster``   golden values for a cluster with, per attribute, the winning
                        member, the rule applied and every losing value with a reason.
- ``cluster_graph``     nodes = member records, edges = pair scores, weak chains
                        (A~B, B~C but A!~C) flagged.
- ``dry_run_tuning``    re-band stored pair scores under new weights / thresholds and
                        count clusters that would merge or split. Writes nothing.

Values in explanations are masked for sensitive fields (bank, tax, personal) using
the same classifier as profiling, so an explanation never leaks a full bank account
or tax number to the browser.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Callable, Optional

from api.services.survivorship import (
    FieldContribution,
    apply_most_complete,
    apply_most_frequent,
    apply_most_recent,
    apply_trusted_source,
)
from checks.profiling import is_sensitive
from sap.deterministic.normalize import canonical_phone, normalize_business_name

AUTO_MERGE = 0.95
REVIEW_FLOOR = 0.30

_ALNUM = re.compile(r"[^0-9A-Za-z]+")
_WORD = re.compile(r"[a-z0-9]+")


# ── Comparators ─────────────────────────────────────────────────────────────


def _norm_tax(v: str) -> str:
    return _ALNUM.sub("", v).upper()


def _norm_bank(v: str) -> str:
    return _ALNUM.sub("", v).upper().lstrip("0")


def _norm_address(v: str) -> str:
    return " ".join(sorted(set(_WORD.findall(v.lower()))))


def _eq(a: str, b: str) -> float:
    return 1.0 if a and a == b else 0.0


def _jaccard(a: str, b: str) -> float:
    ta, tb = set(a.split()), set(b.split())
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


def _phone(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    # National vs international format of the same number: same last 9 digits.
    da, db = a.lstrip("+"), b.lstrip("+")
    return 0.9 if len(da) >= 9 and len(db) >= 9 and da[-9:] == db[-9:] else 0.0


def _token_set(a: str, b: str) -> float:
    from thefuzz import fuzz
    return fuzz.token_set_ratio(a, b) / 100.0 if a and b else 0.0


# comparator -> (normaliser, scorer, always_mask)
SAP_COMPARATORS: dict[str, tuple[Callable[[str], str], Callable[[str, str], float], bool]] = {
    "name_legal": (normalize_business_name, _token_set, False),
    "address_tokens": (_norm_address, _jaccard, False),
    "tax_exact": (_norm_tax, _eq, True),
    "phone_e164": (lambda v: canonical_phone(v) or "", _phone, True),
    "bank_exact": (_norm_bank, _eq, True),
}


def _legacy(match_type: str) -> Optional[tuple[Callable[[str], str], Callable[[str, str], float], bool]]:
    from api.services.match_engine import SCORERS
    scorer = SCORERS.get(match_type)
    return (lambda v: v, scorer, False) if scorer else None


def mask_value(field: str, value: object, force: bool = False) -> str:
    """Mask a value when its field is sensitive. Digits keep the last 4, text keeps initials."""
    s = "" if value is None else str(value)
    if not s or not (force or is_sensitive("", field)):
        return s
    digits = sum(ch.isdigit() for ch in s)
    if digits >= len(s.replace(" ", "")) / 2:
        return "•" * max(len(s) - 4, 0) + s[-4:]
    return " ".join(t[0] + "•" * (len(t) - 1) for t in s.split())


def band_for(total: float, auto_merge: float = AUTO_MERGE, review_floor: float = REVIEW_FLOOR) -> str:
    if total >= auto_merge:
        return "auto_merge"
    return "auto_dismiss" if total < review_floor else "steward_review"


BAND_ACTION = {"auto_merge": "merged", "steward_review": "queued", "auto_dismiss": "dismissed"}


def explain_pair(
    rules: list[dict],
    a: dict,
    b: dict,
    *,
    auto_merge: float = AUTO_MERGE,
    review_floor: float = REVIEW_FLOOR,
    constraint: Optional[str] = None,
    semantic: Optional[Callable[[str, str, str], Optional[float]]] = None,
) -> dict:
    """Explain how a pair scores under ``rules`` (dicts with field, match_type, weight, threshold).

    ``constraint`` is a steward pair decision (do_not_match / always_match) that
    overrides the score band.
    """
    attrs: list[dict] = []
    for r in rules:
        field, ctype, weight = r["field"], r["match_type"], float(r.get("weight") or 0)
        threshold = r.get("threshold")
        row: dict = {"field": field, "comparator": ctype, "weight": weight, "threshold": threshold}
        va, vb = a.get(field), b.get(field)
        if va in (None, "") or vb in (None, ""):
            attrs.append({**row, "skipped": True, "reason": "missing_value", "similarity": None,
                          "value_a": mask_value(field, va), "value_b": mask_value(field, vb)})
            continue
        if ctype == "semantic":
            score = semantic(field, str(va), str(vb)) if semantic else None
            if score is None:
                attrs.append({**row, "skipped": True, "reason": "semantic_scoring_failed", "similarity": None})
                continue
            na, nb, force = str(va), str(vb), False
        else:
            comp = SAP_COMPARATORS.get(ctype) or _legacy(ctype)
            if comp is None:
                attrs.append({**row, "skipped": True, "reason": "unknown_comparator", "similarity": None})
                continue
            norm, scorer, force = comp
            na, nb = norm(str(va)), norm(str(vb))
            score = scorer(na, nb)
        attrs.append({**row, "skipped": False, "similarity": round(float(score), 4),
                      "value_a": mask_value(field, na, force), "value_b": mask_value(field, nb, force),
                      "masked": force or is_sensitive("", field),
                      "threshold_met": threshold is None or score >= float(threshold)})

    scored = [x for x in attrs if not x["skipped"]]
    weight_total = sum(x["weight"] for x in scored)
    for x in attrs:
        x["contribution"] = round(x["similarity"] * x["weight"] / weight_total, 4) if (
            not x["skipped"] and weight_total) else 0.0
    total = sum(x["similarity"] * x["weight"] for x in scored) / weight_total if weight_total else 0.0
    band = band_for(total, auto_merge, review_floor)
    fired = f"total {total:.4f} >= auto_merge {auto_merge}" if band == "auto_merge" else (
        f"total {total:.4f} < review_floor {review_floor}" if band == "auto_dismiss"
        else f"review_floor {review_floor} <= total {total:.4f} < auto_merge {auto_merge}")
    if constraint == "do_not_match":
        band, fired = "auto_dismiss", "steward do_not_match pair overrides the score"
    elif constraint == "always_match":
        band, fired = "auto_merge", "steward always_match pair overrides the score"
    return {
        "attributes": attrs,
        "total": round(total, 4),
        "weight_total": weight_total,
        "band": band,
        "auto_action": BAND_ACTION[band],
        "fired": fired,
        "thresholds": {"auto_merge": auto_merge, "review_floor": review_floor},
        "rules_met": [x["field"] for x in scored if x.get("threshold_met")],
        "rules_failed": [x["field"] for x in scored if not x.get("threshold_met")],
        "constraint": constraint,
    }


# ── Survivorship explanation ────────────────────────────────────────────────

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _blank(v: object) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def survive_cluster(members: list[dict], rules: Optional[dict] = None,
                    overrides: Optional[dict] = None) -> dict:
    """Golden values for a cluster, with the winner, rule and losers per attribute.

    ``members``: ``[{key, fields, extracted_at?, source_system?}]`` in priority order
    (survivor first, then members in the order they joined). ``rules``:
    ``{field: {rule_type, trusted_sources}}`` from survivorship_rules. Without a rule
    the default is source priority = member order, which is exactly what
    ``mdm_merge.fuse`` does (survivor keeps its values, blanks filled in join order).
    """
    rules, overrides = rules or {}, overrides or {}
    order = [m["key"] for m in members]
    sys_of = {m["key"]: m.get("source_system") or m["key"] for m in members}
    when = {m["key"]: m.get("extracted_at") or _EPOCH for m in members}
    all_fields: list[str] = []
    for m in members:
        all_fields += [f for f in m["fields"] if f not in all_fields]
    all_fields += [f for f in overrides if f not in all_fields]

    contribs = {f: [FieldContribution(None if _blank(m["fields"].get(f)) else m["fields"].get(f),
                                      m["key"], when[m["key"]]) for m in members] for f in all_fields}
    blanks = {k: sum(1 for f in all_fields if _blank(next(m for m in members if m["key"] == k)["fields"].get(f)))
              for k in order}

    fields: dict = {}
    explanation: dict = {}
    for f in all_fields:
        cs = contribs[f]
        rule = rules.get(f) or {}
        rtype = rule.get("rule_type") or "source_priority"
        if rtype in ("chain", "manual_override"):  # sync-time rules; across a cluster use member order
            rtype = "source_priority"
        winner_key: Optional[str] = None
        value: object = None
        if f in overrides:
            rtype, value = "steward_override", overrides[f]
        else:
            res = None
            if rtype == "most_recent":
                res = apply_most_recent(cs)
            elif rtype == "most_complete":
                res = apply_most_complete(cs, contribs)
            elif rtype == "most_frequent":
                res = apply_most_frequent(cs)
            elif rtype == "trusted_source" and rule.get("trusted_sources"):
                ranked = [k for s in rule["trusted_sources"] for k in order if sys_of[k] == s or k == s]
                res = apply_trusted_source(cs, ranked + [k for k in order if k not in ranked])
                rtype = "source_priority"
            if res is None:
                if rtype not in ("source_priority", "trusted_source"):
                    rtype = f"source_priority ({rtype} undecided)"
                else:
                    rtype = "source_priority"
                res = apply_trusted_source(cs, order)
            if res is not None:
                winner_key, value = res.source_system, res.value
        if value is None:
            continue
        fields[f] = value
        losers = []
        for c in cs:
            if c.source_system == winner_key:
                continue
            if c.value is None:
                why = "blank"
            elif str(c.value).strip().lower() == str(value).strip().lower():
                why = "same value as winner"
            elif rtype == "steward_override":
                why = "overridden by steward"
            elif rtype == "most_recent":
                why = f"older ({c.extracted_at.isoformat()})"
            elif rtype == "most_complete":
                why = f"less complete source ({blanks[c.source_system]} blank fields)"
            elif rtype == "most_frequent":
                n = sum(1 for x in cs if x.value is not None and
                        str(x.value).strip().lower() == str(c.value).strip().lower())
                why = f"minority value ({n} of {sum(1 for x in cs if x.value is not None)})"
            else:
                why = f"lower source priority (rank {order.index(c.source_system) + 1})"
            losers.append({"key": c.source_system, "value": mask_value(f, c.value), "reason": why})
        explanation[f] = {"value": mask_value(f, value), "winner_key": winner_key, "rule": rtype, "losers": losers}
    return {"fields": fields, "explanation": explanation}


# ── Cluster graph ───────────────────────────────────────────────────────────


def pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def drop_blocked_pairs(candidates: list[dict], blocked: set[tuple[str, str]]) -> list[dict]:
    """Remove dedup candidates (``record_key`` "a|b") that a steward marked do_not_match."""
    def key(c: dict) -> tuple[str, str]:
        a, _, b = c["record_key"].partition("|")
        return pair_key(a, b)
    return [c for c in candidates if c.get("category") != "dedup" or key(c) not in blocked]


def cluster_graph(keys: list[str], pairs: list[dict], constraints: Optional[dict] = None,
                  auto_merge: float = AUTO_MERGE) -> dict:
    """``pairs``: ``[{a, b, total, steward_decision?, id?, explanation?}]``; ``constraints``:
    ``{(lo, hi): kind}``. An edge is a link when it auto-merges, a steward accepted it or
    it is always_match. A weak chain is A~B, B~C where A-C is not a link.
    """
    constraints = constraints or {}
    ks = set(keys)
    edges, linked = [], set()
    for p in pairs:
        if p["a"] not in ks or p["b"] not in ks:
            continue
        k = pair_key(p["a"], p["b"])
        kind = constraints.get(k)
        link = kind != "do_not_match" and (kind == "always_match" or p.get("steward_decision") == "accept"
                                           or float(p.get("total") or 0) >= auto_merge)
        if link:
            linked.add(k)
        edges.append({"id": p.get("id"), "source": p["a"], "target": p["b"], "total": p.get("total"),
                      "linked": link, "constraint": kind, "steward_decision": p.get("steward_decision"),
                      "explanation": p.get("explanation")})
    for k, kind in constraints.items():
        if kind == "always_match" and k[0] in ks and k[1] in ks and k not in linked:
            linked.add(k)
            edges.append({"id": None, "source": k[0], "target": k[1], "total": None, "linked": True,
                          "constraint": kind, "steward_decision": None, "explanation": None})
    scored = {pair_key(e["source"], e["target"]) for e in edges if e["total"] is not None}
    adj: dict[str, set[str]] = {k: set() for k in keys}
    for lo, hi in linked:
        adj[lo].add(hi)
        adj[hi].add(lo)
    # ponytail: O(n * deg^2) over one cluster; clusters are small. Index by hub if clusters grow to thousands.
    weak = []
    for hub in sorted(adj):
        nb = sorted(adj[hub])
        for i, x in enumerate(nb):
            for y in nb[i + 1:]:
                k = pair_key(x, y)
                if k in linked:
                    continue
                why = ("do_not_match" if constraints.get(k) == "do_not_match"
                       else "direct_score_below_threshold" if k in scored else "no_direct_score")
                weak.append({"a": x, "via": hub, "b": y, "reason": why})
    return {"nodes": [{"key": k, "degree": len(adj[k])} for k in keys], "edges": edges, "weak_chains": weak}


# ── Tuning dry-run ──────────────────────────────────────────────────────────


def _clusters(keys: set[str], links: set[tuple[str, str]]) -> list[frozenset[str]]:
    parent = {k: k for k in keys}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in links:
        parent[find(a)] = find(b)
    groups: dict[str, set[str]] = {}
    for k in keys:
        groups.setdefault(find(k), set()).add(k)
    return [frozenset(g) for g in groups.values()]


def similarities(stored: dict) -> dict[str, Optional[float]]:
    """Per-field similarity from a match_scores row (explanation, else legacy field_scores)."""
    expl = stored.get("explanation") or {}
    if expl.get("attributes"):
        return {x["field"]: x["similarity"] for x in expl["attributes"]}
    return {f: (None if v.get("skipped") else v.get("score")) for f, v in (stored.get("field_scores") or {}).items()}


def dry_run_tuning(pairs: list[dict], weights: dict[str, float], *, auto_merge: float = AUTO_MERGE,
                   review_floor: float = REVIEW_FLOOR, constraints: Optional[dict] = None) -> dict:
    """``pairs``: ``[{a, b, auto_action, steward_decision?, explanation?|field_scores?, current_weights?}]``.

    Current links are the stored outcomes (auto_action merged or steward accepted).
    Proposed links re-score each pair from its stored per-field similarities with
    ``weights`` (fields absent from ``weights`` keep their stored weight). Steward
    decisions and pair constraints win over the score in both.
    """
    constraints = constraints or {}
    keys: set[str] = set()
    cur, new = set(), set()
    moves: dict[str, int] = {}
    for p in pairs:
        k = pair_key(p["a"], p["b"])
        keys.update(k)
        kind = constraints.get(k)
        sims = similarities(p)
        stored_w = {x["field"]: x["weight"] for x in (p.get("explanation") or {}).get("attributes", [])} or {
            f: v.get("weight", 0) for f, v in (p.get("field_scores") or {}).items()}
        num = den = 0.0
        for f, s in sims.items():
            if s is None:
                continue
            w = float(weights.get(f, stored_w.get(f, 0)))
            num += s * w
            den += w
        total = num / den if den else 0.0
        band = band_for(total, auto_merge, review_floor)
        decided = p.get("steward_decision")
        was = p.get("auto_action") == "merged" or decided == "accept"
        will = band == "auto_merge" or decided == "accept"
        if kind == "do_not_match" or decided == "reject":
            was = will = False
        elif kind == "always_match":
            was = will = True
        old_band = {"merged": "auto_merge", "dismissed": "auto_dismiss"}.get(p.get("auto_action") or "",
                                                                            "steward_review")
        if old_band != band:
            moves[f"{old_band}->{band}"] = moves.get(f"{old_band}->{band}", 0) + 1
        if was:
            cur.add(k)
        if will:
            new.add(k)
    before, after = _clusters(keys, cur), _clusters(keys, new)
    multi_before = [c for c in before if len(c) > 1]
    multi_after = [c for c in after if len(c) > 1]
    would_merge = sum(1 for c in after if sum(1 for b in before if b <= c) > 1)
    would_split = sum(1 for c in before if sum(1 for a in after if a <= c) > 1)
    return {
        "pairs": len(pairs),
        "pairs_newly_linked": len(new - cur),
        "pairs_unlinked": len(cur - new),
        "band_moves": moves,
        "clusters_before": len(multi_before),
        "clusters_after": len(multi_after),
        "clusters_that_would_merge": would_merge,
        "clusters_that_would_split": would_split,
        "applied": False,
    }

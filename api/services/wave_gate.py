"""Wave planning gates (migration 104).

A gate is what a migration wave must pass before it moves: every object of the wave at or above a minimum score, no
critical rule over tolerance, and the data contracts that name the wave's objects met. ``gate_checks`` evaluates one
gate deterministically over the landscape cells (GET /landscape, current state) and the contracts with their latest
compliance; the route only reads and the Waves view only draws what it returns.

A cell is (system, object). When the wave has a source system only that system's cells count; otherwise every
system's. An object of the wave with no measured cell fails the score check (nothing measured is not ready).

Each check also carries its evidence as numbers: ``actual`` against ``threshold`` and ``items``, the per-object scores,
the critical rules that fail with their field and its DDIC text, or the contracts met. ``forecast_gate`` projects
when the blocking findings of the wave's objects reach zero from the per-run trend: a least-squares line over the
run dates, and an honest "not converging" when the line does not fall.
"""
from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Optional

TOP_RULES = 5


def wave_threshold(gate_min_score: Optional[float], wave_min_dqs: Optional[float],
                   default: Optional[float] = None) -> Optional[float]:
    """The one score threshold of a wave (F16): its gate's minimum score when the gate sets one (what decides go),
    else the wave's own minimum DQS, else ``default`` (the tenant's readiness threshold). The Readiness grid, the
    wave cockpit and the gate all read it here, so a wave never shows two numbers."""
    for v in (gate_min_score, wave_min_dqs, default):
        if v is not None:
            return float(v)
    return None


async def gate_scores(db, tenant_id: str, wave_ids: Iterable[str]) -> dict[str, Optional[float]]:
    """{wave id: its gate's min_score} for the waves that have a gate (one read)."""
    from sqlalchemy import text

    ids = [str(w) for w in wave_ids]
    if not ids:
        return {}
    rows = (await db.execute(text(
        "SELECT wave_id::text, min_score FROM wave_gates WHERE tenant_id = CAST(:t AS uuid) "
        "AND wave_id = ANY(CAST(:ids AS uuid[]))"), {"t": str(tenant_id), "ids": ids})).fetchall()
    return {r[0]: r[1] for r in rows}


def _names(c: Mapping[str, Any]) -> set[str]:
    q = c.get("quality_contract") if isinstance(c.get("quality_contract"), Mapping) else {}
    return {str(x) for x in (c.get("producer"), c.get("consumer"), q.get("module")) if x}


def relevant_contracts(contracts: Iterable[Mapping[str, Any]], modules: Iterable[str]) -> list[Mapping[str, Any]]:
    """Active contracts whose producer, consumer or quality module names one of the wave's objects."""
    mods = set(modules)
    return [c for c in contracts if c.get("status") == "active" and _names(c) & mods]


@lru_cache(maxsize=None)
def _rule_index(module: str) -> dict[str, dict]:
    from checks.runner import module_rules

    return {str(r.get("id")): r for r in module_rules(module) if r.get("id")}


def rule_evidence(module: str, check_id: str) -> dict[str, Optional[str]]:
    """The rule's message and field, with the field's DDIC text (sap/ddic.py), for one failing critical rule.
    Empty values when the rule pack or the dictionary does not name them; nothing is invented."""
    from sap.ddic import get_dictionary

    r = _rule_index(module).get(check_id) or {}
    field = r.get("field") if isinstance(r.get("field"), str) else None
    fd = get_dictionary().resolve(field) if field and "." in field else None
    return {"message": r.get("message") or r.get("description") or None, "field": field,
            "field_description": fd.description if fd is not None else None}


def gate_checks(gate: Mapping[str, Any], wave: Mapping[str, Any], cells: Iterable[Mapping[str, Any]],
                contracts: Iterable[Mapping[str, Any]],
                evidence: Optional[Callable[[str, str], Mapping[str, Any]]] = rule_evidence) -> dict[str, Any]:
    """{passed, checks: [{key, label, passed, detail, actual, threshold, items}]} for one wave. Only the criteria the
    gate turns on are checked; a gate with none on passes with no checks (and says so).

    min_score: actual is the lowest object score (None when an object is not measured), items one per object.
    zero_criticals: actual is the count of failing critical rules per object, threshold 0, items the most widespread
    rules with their field and DDIC text. contracts_met: actual contracts met against the number that name the wave."""
    modules = list(wave.get("modules") or [])
    source = str(wave["source_system_id"]) if wave.get("source_system_id") else None
    mine = [c for c in cells if c.get("module") in modules and (source is None or str(c.get("system_id")) == source)]
    checks: list[dict[str, Any]] = []
    min_score: float | None = gate.get("min_score")
    if min_score is not None:
        measured = {c["module"] for c in mine if c.get("score") is not None}
        below = sorted({c["module"] for c in mine if c.get("score") is not None and c["score"] < min_score})
        missing = sorted(set(modules) - measured)
        ok = not below and not missing
        detail = (f"Every object is at or above {min_score:.1f}." if ok else
                  "; ".join(x for x in (f"below {min_score:.1f}: {', '.join(below)}" if below else "",
                                       f"not measured: {', '.join(missing)}" if missing else "") if x))
        worst = {m: min((c["score"] for c in mine if c["module"] == m and c.get("score") is not None), default=None)
                 for m in modules}
        items = [{"module": m, "actual": v, "threshold": float(min_score), "passed": v is not None and v >= min_score}
                 for m, v in worst.items()]
        checks.append({"key": "min_score", "label": f"Gate: min score {min_score:.1f}", "passed": ok,
                       "detail": detail, "actual": None if missing else min(v for v in worst.values() if v is not None)
                       if worst else None, "threshold": float(min_score), "items": items})
    if gate.get("zero_criticals"):
        crit = sorted({c["module"] for c in mine if (c.get("critical_over_tolerance") or 0) > 0 or c.get("breaches")})
        tally = Counter((c["module"], str(cid)) for c in mine for cid in set(c.get("breaches") or []))
        failing = sum(max(int(c.get("critical_over_tolerance") or 0), len(set(c.get("breaches") or []))) for c in mine)
        top = sorted(tally.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP_RULES]
        items = [{"module": m, "check_id": cid, "cells": n, **(dict(evidence(m, cid)) if evidence else {})}
                 for (m, cid), n in top]
        checks.append({"key": "zero_criticals", "label": "No critical rule over tolerance", "passed": not crit,
                       "detail": "No object is capped by a critical rule." if not crit else
                       f"Capped by a critical rule: {', '.join(crit)}", "actual": float(failing), "threshold": 0.0,
                       "items": items})
    if gate.get("contracts_met"):
        rel = relevant_contracts(contracts, modules)
        broken = sorted(str(c.get("name")) for c in rel if c.get("latest_compliant") is not True)
        checks.append({"key": "contracts_met", "label": "Data contracts met", "passed": not broken,
                       "detail": ("No active contract names these objects." if not rel else
                                  f"All {len(rel)} contracts met." if not broken else
                                  f"Not met or never checked: {', '.join(broken)}"),
                       "actual": float(len(rel) - len(broken)), "threshold": float(len(rel)),
                       "items": [{"name": str(c.get("name")), "passed": c.get("latest_compliant") is True}
                                 for c in sorted(rel, key=lambda c: str(c.get("name")))]})
    return {"passed": all(c["passed"] for c in checks), "checks": checks}


def _when(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


def forecast_gate(points: Iterable[Mapping[str, Any]], horizon_days: int = 730) -> dict[str, Any]:
    """When the blocking findings of a wave's objects reach zero, from the per-run trend.

    ``points`` are runs with ``at`` (the run date) and ``blocking`` (critical and high findings of the wave's objects).
    A least-squares line of blocking over days gives the date it crosses zero. Status: ``passing`` when the latest run
    has none, ``projected`` with the date when the line falls, ``not_converging`` when it is flat or rising (no date is
    given), ``no_trend`` with fewer than two dated runs. A crossing beyond ``horizon_days`` is reported as not
    converging: a line that slow is no plan. Deterministic: same runs, same answer."""
    pts = sorted(((d, float(p["blocking"])) for p in points
                  if (d := _when(p.get("at"))) is not None and p.get("blocking") is not None), key=lambda x: x[0])
    out: dict[str, Any] = {"status": "no_trend", "runs_used": len(pts), "slope_per_day": None,
                           "projected_date": None, "latest": pts[-1][1] if pts else None,
                           "latest_at": pts[-1][0].isoformat() if pts else None}
    if pts and pts[-1][1] <= 0:
        return {**out, "status": "passing"}
    if len(pts) < 2:
        return out
    t0 = pts[0][0]
    xs = [(d - t0).total_seconds() / 86400 for d, _ in pts]
    ys = [y for _, y in pts]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return out
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    out["slope_per_day"] = round(slope, 4)
    if slope >= 0:
        return {**out, "status": "not_converging"}
    zero_at = mx - my / slope  # x where the fitted line reaches 0
    when = t0 + timedelta(days=zero_at)
    if when < pts[-1][0]:
        when = pts[-1][0]
    if (when - pts[-1][0]).days > horizon_days:
        return {**out, "status": "not_converging"}
    return {**out, "status": "projected", "projected_date": when.date().isoformat()}

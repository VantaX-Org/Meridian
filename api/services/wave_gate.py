"""Wave planning gates (migration 104).

A gate is what a migration wave must pass before it moves: every object of the wave at or above a minimum score, no
critical rule over tolerance, and the data contracts that name the wave's objects met. ``gate_checks`` evaluates one
gate deterministically over the landscape cells (GET /landscape, current state) and the contracts with their latest
compliance; the route only reads and the Waves view only draws what it returns.

A cell is (system, object). When the wave has a source system only that system's cells count; otherwise every
system's. An object of the wave with no measured cell fails the score check (nothing measured is not ready).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Optional


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


def gate_checks(gate: Mapping[str, Any], wave: Mapping[str, Any], cells: Iterable[Mapping[str, Any]],
                contracts: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """{passed, checks: [{key, label, passed, detail}]} for one wave. Only the criteria the gate turns on are
    checked; a gate with none on passes with no checks (and says so)."""
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
        checks.append({"key": "min_score", "label": f"Gate: min score {min_score:.1f}", "passed": ok,
                       "detail": detail})
    if gate.get("zero_criticals"):
        crit = sorted({c["module"] for c in mine if (c.get("critical_over_tolerance") or 0) > 0 or c.get("breaches")})
        checks.append({"key": "zero_criticals", "label": "No critical rule over tolerance", "passed": not crit,
                       "detail": "No object is capped by a critical rule." if not crit else
                       f"Capped by a critical rule: {', '.join(crit)}"})
    if gate.get("contracts_met"):
        rel = relevant_contracts(contracts, modules)
        broken = sorted(str(c.get("name")) for c in rel if c.get("latest_compliant") is not True)
        checks.append({"key": "contracts_met", "label": "Data contracts met", "passed": not broken,
                       "detail": ("No active contract names these objects." if not rel else
                                  f"All {len(rel)} contracts met." if not broken else
                                  f"Not met or never checked: {', '.join(broken)}")})
    return {"passed": all(c["passed"] for c in checks), "checks": checks}

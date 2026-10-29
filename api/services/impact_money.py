"""Feature impact in money over time: GET /api/v1/impact/money (api/routes/impact_money.py).

Per S/4 feature of the scope (a wave, an object or the whole landscape) at the current runs (each object at its newest
finished run, per system, as the landscape reads them): its status and blocking rules from config_impact_results, the
opportunity cost per month from the tenant's cost model, how long it has been blocked and what that has cost since.

The cost model is ``tenants.cost_model.features``: a value per affected record per month for each feature (the same
keys GET /settings/cost-model/features lists). A feature the tenant has not priced, or a tenant with no prices at all,
has null money: never an invented amount.

  opportunity cost per month = total_affected_records x the feature's value per record per month
  cumulative since first blocked = the sum, over the runs of the unbroken streak of runs in which the feature is
      blocked (ending at the current run), of that run's monthly cost x the months until the next run (or ``as_of``)

A month is 365.25 / 12 days. The ranking orders waves and objects by the monthly value they would unblock: the cost of
the blocked features whose every blocking rule belongs to their objects.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.services.version_status import finished_sql

DAYS_PER_MONTH = 365.25 / 12

_RUNS_SQL = f"""
    SELECT id::text, run_at, metadata->>'system_id' AS sid FROM analysis_versions
     WHERE tenant_id = CAST(:t AS uuid) AND {finished_sql()}
       AND metadata->>'system_id' = ANY(:sids)
       AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
       AND metadata->>'archived' IS DISTINCT FROM 'true'
     ORDER BY run_at, id"""


def check_ids(blocking: object) -> list[str]:
    items = blocking if isinstance(blocking, list) else []
    out = []
    for i in items:
        cid = i.get("check_id") if isinstance(i, dict) else i
        if isinstance(cid, str) and cid not in out:
            out.append(cid)
    return out


def months_between(a: datetime, b: datetime) -> float:
    return max(0.0, (b - a).total_seconds() / 86400 / DAYS_PER_MONTH)


NOT_BLOCKED = object()  # a run in which the feature was not blocked


def blocked_streak(history: list[tuple[datetime, object]], as_of: datetime) -> tuple[datetime | None, float, float | None]:
    """(first blocked at, months blocked, cumulative cost) over a feature's runs, oldest first, each ``(run_at,
    monthly cost while blocked)``, or ``(run_at, NOT_BLOCKED)`` for a run in which it was not blocked. Only the
    unbroken streak that ends at the newest run counts. The cost is None when a run of the streak has no price."""
    streak: list[tuple[datetime, object]] = []
    for at, cost in history:
        if cost is NOT_BLOCKED:
            streak = []
        else:
            streak.append((at, cost))
    if not streak:
        return None, 0.0, None
    total: float | None = 0.0
    months = 0.0
    for i, (at, cost) in enumerate(streak):
        end = streak[i + 1][0] if i + 1 < len(streak) else as_of
        m = months_between(at, end)
        months += m
        total = None if total is None or cost is None else total + cost * m
    return streak[0][0], round(months, 2), None if total is None else round(total, 2)


async def _scope(db: AsyncSession, tenant_id: str, scope: str, ident: str | None) -> tuple[list[tuple[str, str, str]], list[dict]]:
    """(current (system, module, run) triples in scope, the waves to rank)."""
    from api.routes.landscape import _CELL_RUNS_SQL

    triples = [(r["sid"], r["module"], r["run_id"]) for r in (await db.execute(text(_CELL_RUNS_SQL), {"t": tenant_id})).mappings().all()]
    waves = [dict(r) for r in (await db.execute(text(
        "SELECT id::text, name, modules, source_system_id::text AS sid FROM migration_waves WHERE tenant_id = :t "
        "ORDER BY name, id"), {"t": tenant_id})).mappings().all()]
    if scope == "object":
        triples = [x for x in triples if x[1] == ident]
    elif scope == "wave":
        wave = next((w for w in waves if w["id"] == ident), None)
        if wave is None:
            raise LookupError("wave")
        triples = [x for x in triples if x[1] in (wave["modules"] or []) and (not wave["sid"] or x[0] == wave["sid"])]
        waves = [wave]
    return triples, waves


async def money(db: AsyncSession, tenant_id: str, scope: str, ident: str | None, as_of: datetime | None = None) -> dict:
    from api.services.insights_impact import tenant_currency

    as_of = as_of or datetime.now(timezone.utc)
    cost_model = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": tenant_id})).scalar()
    cost_model = cost_model if isinstance(cost_model, dict) else {}
    prices = {k: float(v) for k, v in (cost_model.get("features") or {}).items()
              if isinstance(v, (int, float)) and not isinstance(v, bool)}
    priced = bool(prices)
    triples, waves = await _scope(db, tenant_id, scope, ident)
    run_ids = sorted({r for _s, _m, r in triples})
    in_scope = {(r, m) for _s, m, r in triples}
    module_of: dict[tuple[str, str], str] = {}
    rows: list[dict] = []
    if run_ids:
        p = {"t": tenant_id, "ids": run_ids}
        module_of = {(r[0], r[1]): r[2] for r in (await db.execute(text(
            "SELECT version_id::text, check_id, module FROM findings WHERE tenant_id = :t "
            "AND version_id = ANY(CAST(:ids AS uuid[]))"), p)).fetchall()}
        rows = [dict(r) for r in (await db.execute(text(
            "SELECT version_id::text AS run_id, feature, status, blocking_findings, total_affected_records "
            "FROM config_impact_results WHERE tenant_id = :t AND version_id = ANY(CAST(:ids AS uuid[])) "
            "AND status IN ('blocked', 'degraded') ORDER BY feature"), p)).mappings().all()]
    sid_of = {r: s for s, _m, r in triples}
    systems = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT id::text, name FROM sap_systems WHERE tenant_id = :t"), {"t": tenant_id})).fetchall()}

    # current features: (system, feature) -> the newest run's row touching an object in scope
    run_at = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT id::text, run_at FROM analysis_versions WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[]))"),
        {"t": tenant_id, "ids": run_ids})).fetchall()} if run_ids else {}
    current: dict[tuple[str, str], dict] = {}
    for r in sorted(rows, key=lambda r: run_at.get(r["run_id"]) or as_of, reverse=True):
        rules = check_ids(r["blocking_findings"])
        mods = sorted({module_of.get((r["run_id"], c)) for c in rules} - {None})
        if not any((r["run_id"], m) in in_scope for m in mods):
            continue
        current.setdefault((sid_of[r["run_id"]], r["feature"]), {**r, "rules": rules, "modules": mods})

    # history of each system's runs, for the blocked streaks
    history: dict[tuple[str, str], list] = {}
    sids = sorted({s for s, _f in current})
    if sids:
        runs = (await db.execute(text(_RUNS_SQL), {"t": tenant_id, "sids": sids})).mappings().all()
        blocked = {(r[0], r[1]): int(r[2] or 0) for r in (await db.execute(text(
            "SELECT version_id::text, feature, total_affected_records FROM config_impact_results WHERE tenant_id = :t "
            "AND status = 'blocked' AND version_id = ANY(CAST(:ids AS uuid[]))"),
            {"t": tenant_id, "ids": [r["id"] for r in runs]})).fetchall()}
        for (sid, feature) in current:
            price = prices.get(feature)
            history[(sid, feature)] = [
                (r["run_at"], (None if price is None else blocked[(r["id"], feature)] * price)
                 if (r["id"], feature) in blocked else NOT_BLOCKED)
                for r in runs if r["sid"] == sid]

    features = []
    for (sid, feature), r in sorted(current.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        price = prices.get(feature)
        n = int(r["total_affected_records"] or 0)
        monthly = round(n * price, 2) if price is not None else None
        first, months, cumulative = (blocked_streak(history.get((sid, feature), []), as_of)
                                     if r["status"] == "blocked" else (None, 0.0, None))
        features.append({
            "feature": feature, "system_id": sid, "system": systems.get(sid), "run_id": r["run_id"],
            "status": r["status"], "blocking_rules": r["rules"], "modules": r["modules"], "records": n,
            "value_per_record_month": price, "opportunity_cost_per_month": monthly,
            "first_blocked_at": first.isoformat() if first else None, "months_blocked": months,
            "cumulative_cost": cumulative if price is not None else None,
        })

    def unblocked(mods: set[str], sid: str | None = None) -> tuple[float | None, list[str]]:
        hit = [f for f in features if f["status"] == "blocked" and f["modules"] and set(f["modules"]) <= mods
               and (sid is None or f["system_id"] == sid)]
        vals = [f["opportunity_cost_per_month"] for f in hit]
        return (round(sum(v for v in vals if v is not None), 2) if priced and hit else (0.0 if priced else None),
                sorted({f["feature"] for f in hit}))

    objects = []
    for m in sorted({m for _s, m, _r in triples}):
        value, feats = unblocked({m})
        objects.append({"id": m, "name": m, "value_unblocked_per_month": value, "features": feats})
    wave_rank = []
    if scope == "landscape":
        for w in waves:
            value, feats = unblocked(set(w["modules"] or []), w["sid"])
            wave_rank.append({"id": w["id"], "name": w["name"], "value_unblocked_per_month": value, "features": feats})
    order = (lambda x: (-(x["value_unblocked_per_month"] or 0.0), -len(x["features"]), x["name"]))
    month_vals = [f["opportunity_cost_per_month"] for f in features if f["opportunity_cost_per_month"] is not None]
    cum_vals = [f["cumulative_cost"] for f in features if f["cumulative_cost"] is not None]
    return {
        "scope": scope, "id": ident, "as_of": as_of.isoformat(), "currency": tenant_currency(cost_model),
        "cost_model": priced, "features": features,
        "totals": {"opportunity_cost_per_month": round(sum(month_vals), 2) if priced else None,
                   "cumulative_cost": round(sum(cum_vals), 2) if priced else None,
                   "features_blocked": sum(1 for f in features if f["status"] == "blocked"),
                   "features_degraded": sum(1 for f in features if f["status"] == "degraded")},
        "ranking": {"waves": sorted(wave_rank, key=order), "objects": sorted(objects, key=order)},
    }

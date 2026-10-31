"""Plain-language explanations of the numbers on screen, built from the same figures the receipt returns.

GET /api/v1/explain/{metric}?module=&run=&dimension=&check_id=

  dqs          why an object scores what it does: six dimensions at their weights, the cap, the result
  dimension    one dimension's score: the rules behind it, their severity weights, critical rules over tolerance
  cap          what holds the score at 85 or 70, rule by rule
  coverage     how many rules ran, were skipped, errored or had no records
  value_at_risk the money the failing rules put at risk, largest rules first
  failing_pct  one rule's failing records against its population
  tolerance    when a critical rule counts as over tolerance
  open_work    records still needing a decision, by work status

Every sentence is assembled from stored figures (dqs_summary, findings, work_records, the tenant's scoring config) by
deterministic Python; no model writes any of it. A figure the run did not store is left out of the text and returned as
null in ``computation``. Read-only; tenant-scoped; ``view`` permission.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label, _measured_dimensions, _version_summary
from api.routes.record_issues import _rls
from api.services.rbac import require_permission
from api.services.receipt_math import DIMENSION_ORDER, OPEN_WORK, breach_ids, cap_level_of, records_checked_of, reweigh, rule_names
from api.services.run_context import latest_run
from api.services.scoring import (
    critical_over_tolerance, dimensions_scored_as, effective_weights, scoring_config, scoring_dimension,
)
from checks.cost import effective as effective_cost_model

router = APIRouter(prefix="/api/v1/explain", tags=["explain"], dependencies=[Depends(require_permission("view"))])

Metric = Literal["dqs", "dimension", "cap", "coverage", "value_at_risk", "failing_pct", "tolerance", "open_work"]
_NEEDS_MODULE = {"dqs", "dimension", "cap", "coverage", "value_at_risk", "open_work"}


class ComputationRow(BaseModel):
    label: str
    value: Union[float, int, str, None] = None   # null: the run did not store it
    unit: Optional[str] = None                   # points | % | rules | records | currency code


class ExplainOut(BaseModel):
    metric: str
    title: str
    text: str
    computation: list[ComputationRow]
    module: Optional[str] = None
    run_id: Optional[str] = None
    run_at: Optional[datetime] = None


def _n(x: float) -> str:
    """72.0 -> '72', 71.84 -> '71.8'."""
    return f"{float(x):.1f}".rstrip("0").rstrip(".")


def _count(n: int) -> str:
    return f"{int(n):,}"


def _money(x: float, currency: str) -> str:
    a = abs(x)
    body = f"{x / 1e6:.1f}m" if a >= 1e6 else f"{x / 1e3:.0f}k" if a >= 1e3 else f"{x:.0f}"
    return f"{currency} {body}"


def _plural(n: int, one: str, many: Optional[str] = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _when(d: Optional[datetime]) -> str:
    return d.strftime("%-d %b %Y") if d else "this run"


class _Ctx:
    """What one explanation reads: the run, the object's stored summary, the tenant's scoring config."""
    db: AsyncSession
    tenant: Tenant
    module: Optional[str]
    run_id: Optional[str]
    run_at: Optional[datetime]
    summary: dict
    cfg: dict
    configured: dict
    label: str

    def __init__(self, db: AsyncSession, tenant: Tenant):
        self.db, self.tenant = db, tenant
        self.module = self.run_id = self.run_at = None
        self.summary, self.cfg, self.configured, self.label = {}, {}, {}, ""

    @property
    def p(self) -> dict:
        return {"t": str(self.tenant.id), "v": self.run_id, "m": self.module}


async def _context(db: AsyncSession, tenant: Tenant, module: Optional[str], run: Optional[uuid.UUID],
                   need_run: bool) -> _Ctx:
    c = _Ctx(db, tenant)
    c.module = module
    raw = (await db.execute(text("SELECT dqs_weights FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).scalar() or {}
    c.cfg, c.configured = scoring_config(raw), effective_weights(raw)
    if not need_run:
        return c
    c.run_id = str(run) if run else await latest_run(db, tenant.id, module=module)
    if c.run_id is None:
        raise HTTPException(404, "There is no finished run to explain yet.")
    summary, _ = await _version_summary(db, tenant, c.run_id)
    c.run_at = (await db.execute(text("SELECT run_at FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                 {"v": c.run_id, "t": str(tenant.id)})).scalar()
    if module:
        c.summary = summary.get(module) or {}
        c.label = _label(module)
        if not c.summary:
            raise HTTPException(404, "Object not found for this run")
    return c


def _out(c: _Ctx, metric: str, title: str, sentences: list[str], rows: list[tuple]) -> dict:
    return {"metric": metric, "title": title, "text": " ".join(s for s in sentences if s),
            "computation": [{"label": r[0], "value": r[1], "unit": r[2] if len(r) > 2 else None} for r in rows],
            "module": c.module, "run_id": c.run_id, "run_at": c.run_at}


def _cap_for(n_breaches: int) -> int:
    return 70 if n_breaches >= 2 else 85


async def _breach_rows(c: _Ctx) -> list[dict]:
    ids = breach_ids(c.summary)
    if not ids:
        return []
    found = {r[0]: r for r in (await c.db.execute(text(
        "SELECT check_id, affected_count, total_count, dimension FROM findings WHERE version_id = :v AND tenant_id = :t "
        "AND module = :m AND check_id = ANY(:ids)"), {**c.p, "ids": ids})).fetchall()}
    names = await rule_names(c.db, c.tenant, ids)
    out = []
    for cid in ids:
        r = found.get(cid)
        out.append({"check_id": cid, "name": names.get(cid), "failing": int(r[1]) if r else None,
                    "population": int(r[2]) if r and r[2] else None, "dimension": r[3] if r else None,
                    "pct": round(r[1] / r[2] * 100, 2) if r and r[2] else None})
    return out


def _breach_phrase(b: dict) -> str:
    if b["failing"] is None:
        return b["check_id"]
    return f"{b['check_id']} fails {_count(b['failing'])} records" + (f" ({b['pct']:g}%)" if b["pct"] is not None else "")


# ── dqs ──────────────────────────────────────────────────────────────────────


async def _dqs(c: _Ctx) -> dict:
    s = c.summary
    score, raw = s.get("composite_score"), s.get("raw_score")
    dims = _measured_dimensions(s)
    shares, weighted, measured, reproduced = reweigh(s, c.configured)
    ids = breach_ids(s)
    n = critical_over_tolerance(s)
    cap = cap_level_of(s)
    if score is None:
        return _out(c, "dqs", f"{c.label} has no score", [
            f"No rule produced a result for {c.label} in the run of {_when(c.run_at)}, so there is nothing to score."], [])
    parts = [f"{d.capitalize()} {_n(dims[d])} × {shares[d]:.2f}" for d in DIMENSION_ORDER if d in dims and reproduced]
    sentences = [f"{c.label} scores {_n(score)} out of 100 in the run of {_when(c.run_at)}."]
    if reproduced:
        sentences.append(f"Its {_plural(len(dims), 'measured dimension')} {'adds' if len(dims) == 1 else 'add'} up to "
                         f"{_n(measured)}: " + "; ".join(parts) + ".")
    elif measured is not None:
        sentences.append(f"Its dimensions measure {_n(measured)} before any cap.")
    if cap is not None:
        held = f"{_plural(n, 'critical rule')} over tolerance" + (f" ({', '.join(ids)})" if ids else "")
        sentences.append(f"{held} hold it at {cap}; it measures {_n(raw)} before the cap." if raw is not None
                         else f"{held} hold it at {cap}.")
    elif n:
        sentences.append(f"{_plural(n, 'critical rule')} over tolerance would cap it at {_cap_for(n)}, "
                         "but the measured score is already below that.")
    else:
        sentences.append("No critical rule is over tolerance, so nothing caps it.")
    rules = s.get("total_checks")
    cov = s.get("coverage")
    if isinstance(rules, int):
        sentences.append(f"{_count(rules)} rules were measured" +
                         (f", {cov * 100:.1f}% of those attempted." if isinstance(cov, (int, float)) else "."))
    rows: list[tuple] = []
    for d in DIMENSION_ORDER:
        if d in dims:
            rows.append((f"{d.capitalize()} ({_n(dims[d])} × {shares[d]:.2f})" if reproduced else d.capitalize(),
                         round(dims[d] * shares[d], 1) if reproduced else dims[d], "points" if reproduced else None))
    rows.append(("Weighted score", weighted if weighted is not None else measured, "points"))
    if cap is not None:
        rows.append(("Cap", cap, "points"))
    rows.append(("Score", score, "points"))
    return _out(c, "dqs", f"Why {c.label} scores {_n(score)}", sentences, rows)


# ── dimension ────────────────────────────────────────────────────────────────


async def _dimension(c: _Ctx, dimension: Optional[str]) -> dict:
    if dimension not in DIMENSION_ORDER:
        raise HTTPException(422, f"dimension takes one of {', '.join(DIMENSION_ORDER)}")
    s = c.summary
    dims = _measured_dimensions(s)
    title = f"Why {c.label} {dimension} is {_n(dims[dimension])}" if dimension in dims else f"{c.label} {dimension} is not measured"
    if dimension not in dims:
        return _out(c, "dimension", title, [f"No rule measured {dimension} in {c.label} in this run, so it has no score "
                                           "and carries no weight."], [])
    shares, _w, _m, reproduced = reweigh(s, c.configured)
    cov = (s.get("dimension_coverage") or {}).get(dimension)
    # lifecycle and freshness rules score as timeliness (api/services/scoring.py DIMENSION_ALIASES)
    declared = dimensions_scored_as(dimension)
    by_sev = {r[0]: (int(r[1]), int(r[2])) for r in (await c.db.execute(text(
        "SELECT severity, count(*), count(*) FILTER (WHERE affected_count > 0) FROM findings WHERE version_id = :v "
        "AND tenant_id = :t AND module = :m AND dimension = ANY(:d) GROUP BY severity"), {**c.p, "d": declared})).fetchall()}
    population = (await c.db.execute(text(
        "SELECT max(total_count) FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "AND dimension = ANY(:d)"), {**c.p, "d": declared})).scalar()
    in_dim = [b for b in await _breach_rows(c) if scoring_dimension(b["dimension"]) == dimension]
    sw = c.cfg["severity_weights"]
    n_rules = cov if isinstance(cov, int) else sum(v[0] for v in by_sev.values()) or None
    sentence = f"{dimension.capitalize()} {_n(dims[dimension])} = weighted pass rate across "
    sentence += f"{_count(n_rules)} {dimension} rules" if n_rules else f"the {dimension} rules"
    if in_dim:
        sentence += (f"; {_plural(len(in_dim), 'critical rule')} over tolerance "
                     f"{'carries' if len(in_dim) == 1 else 'carry'} weight {_n(sw['critical'])}.")
    else:
        sentence += "; no critical rule over tolerance sits in it."
    sentences = [sentence,
                 "Each rule's pass rate is scaled by its severity (a failing critical rule loses more than a failing low one) "
                 "and counts in proportion to its weight: " +
                 ", ".join(f"{k} {_n(sw[k])}" for k in ("critical", "high", "medium", "low")) + "."]
    if reproduced and dimension in shares:
        sentences.append(f"{dimension.capitalize()} makes up {shares[dimension] * 100:.0f}% of the {c.label} score.")
    rows: list[tuple] = [(f"{dimension.capitalize()} score", dims[dimension], "points"),
                         ("Rules measured", n_rules, "rules"),
                         ("Records checked", int(population) if population else None, "records")]
    if reproduced and dimension in shares:
        rows += [("Share of the score", round(shares[dimension], 4), None),
                 ("Points contributed", round(dims[dimension] * shares[dimension], 1), "points")]
    for sev in ("critical", "high", "medium", "low"):
        if sev in by_sev:
            rows.append((f"{sev.capitalize()} rules failing (weight {_n(sw[sev])})", f"{by_sev[sev][1]} of {by_sev[sev][0]}", None))
    rows.append(("Critical rules over tolerance", len(in_dim), "rules"))
    return _out(c, "dimension", title, sentences, rows)


# ── cap / tolerance ──────────────────────────────────────────────────────────


def _tolerance_sentence(c: _Ctx) -> str:
    t = c.cfg["critical_tolerance"]
    return (f"A critical rule counts as over tolerance when it fails at least {_n(t['pct'])}% of its records "
            f"or at least {_n(t['rows'])} records.")


async def _cap(c: _Ctx) -> dict:
    s = c.summary
    breaches = await _breach_rows(c)
    n = critical_over_tolerance(s)
    cap, raw, score = cap_level_of(s), s.get("raw_score"), s.get("composite_score")
    rows: list[tuple] = [(f"{b['check_id']} {b['name'] or ''}".strip(),
                          (f"{_count(b['failing'])} records ({b['pct']:g}%)" if b["failing"] is not None and b["pct"] is not None
                           else f"{_count(b['failing'])} records" if b["failing"] is not None else None)) for b in breaches]
    if cap is not None:
        sentences = [f"{c.label} is capped at {cap}: it measures {_n(raw)} but {_plural(n, 'critical rule')} over tolerance "
                     f"hold the score down" + (": " + "; ".join(_breach_phrase(b) for b in breaches) if breaches else "") + ".",
                     "One critical rule over tolerance caps a score at 85, two or more at 70.", _tolerance_sentence(c),
                     f"Fix {'that rule' if n == 1 else f'those {n} rules'} and the score is released to its measured {_n(raw)}."
                     if n and raw is not None else ""]
        rows += [("Measured score", raw, "points"), ("Cap", cap, "points"), ("Score", score, "points")]
        return _out(c, "cap", f"Why {c.label} is capped at {cap}", sentences, rows)
    if n:
        sentences = [f"{_plural(n, 'critical rule')} over tolerance would cap {c.label} at {_cap_for(n)}, but it measures "
                     f"{_n(raw) if raw is not None else 'less'} already, so the cap does not change the score.", _tolerance_sentence(c)]
        rows += [("Measured score", raw, "points"), ("Score", score, "points")]
        return _out(c, "cap", f"{c.label} is not held by its cap", sentences, rows)
    sentences = [f"{c.label} is not capped: no critical rule is over tolerance.", _tolerance_sentence(c)]
    rows += [("Critical rules over tolerance", 0, "rules"), ("Score", score, "points")]
    return _out(c, "cap", f"{c.label} is not capped", sentences, rows)


async def _tolerance(c: _Ctx) -> dict:
    t = c.cfg["critical_tolerance"]
    rows: list[tuple] = [("Tolerance, share of records", t["pct"], "%"), ("Tolerance, records", t["rows"], "records")]
    sentences = [_tolerance_sentence(c), "Only critical rules count: when one is over tolerance it caps the score "
                                         "(85 for one rule, 70 for two or more); a critical rule within tolerance still lowers its dimension but never caps."]
    title = "When a critical rule caps the score"
    if c.module:
        failing = (await c.db.execute(text(
            "SELECT count(*) FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
            "AND severity = 'critical' AND affected_count > 0"), c.p)).scalar() or 0
        n = critical_over_tolerance(c.summary)
        sentences.append(f"In {c.label}, {_plural(int(failing), 'critical rule')} fail{'s' if failing == 1 else ''}, "
                         f"{n} of them over tolerance.")
        rows += [("Critical rules failing", int(failing), "rules"), ("Critical rules over tolerance", n, "rules")]
        title = f"Tolerance for {c.label}"
    return _out(c, "tolerance", title, sentences, rows)


# ── coverage ─────────────────────────────────────────────────────────────────


async def _coverage(c: _Ctx) -> dict:
    s = c.summary
    cov = s.get("coverage") if isinstance(s.get("coverage"), (int, float)) else None
    measured = s.get("total_checks") if isinstance(s.get("total_checks"), int) else None
    skipped, errored, na = s.get("skipped_checks"), s.get("errored_checks"), s.get("not_applicable_checks")
    records = records_checked_of(s)
    if cov is None and measured is None:
        return _out(c, "coverage", f"Coverage of {c.label} is not recorded", [
            "This run did not store how many rules ran."], [])
    sentences = []
    if cov is not None:
        sentences.append(f"{cov * 100:.1f}% of the rules attempted for {c.label} produced a result.")
    if measured is not None:
        extra = [f"{_count(v)} {w}" for v, w in ((skipped, "skipped (a table, field or value list was missing)"),
                                                   (errored, "errored"), (na, "had no records to check")) if isinstance(v, int) and v]
        sentences.append(f"{_count(measured)} rules were measured" + (f"; {', '.join(extra)}." if extra else "."))
    if s.get("low_confidence"):
        sentences.append("That is below 70%, so the score is marked low confidence: treat it as indicative until more rules run.")
    if records:
        sentences.append(f"They checked {_count(records)} records.")
    rows: list[tuple] = [("Rules measured", measured, "rules"), ("Rules skipped", skipped, "rules"),
                         ("Rules errored", errored, "rules"), ("Rules with no records", na, "rules"),
                         ("Coverage", round(cov * 100, 1) if cov is not None else None, "%"),
                         ("Records checked", records, "records")]
    return _out(c, "coverage", f"What {c.label} was checked against", sentences, rows)


# ── value at risk ────────────────────────────────────────────────────────────


async def _value_at_risk(c: _Ctx) -> dict:
    cost_model = (await c.db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": str(c.tenant.id)})).scalar()
    currency = str(effective_cost_model(cost_model if isinstance(cost_model, dict) else None)["currency"])
    rows_db = (await c.db.execute(text(
        "SELECT check_id, cost_at_risk, affected_count FROM findings WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "AND affected_count > 0 AND cost_at_risk IS NOT NULL ORDER BY cost_at_risk DESC, check_id"), c.p)).fetchall()
    if not rows_db:
        return _out(c, "value_at_risk", f"No value at risk is priced for {c.label}", [
            f"No failing rule of {c.label} has a cost priced in this run, so no value at risk is stated."],
            [("Value at risk", None, currency)])
    total = sum(float(r[1]) for r in rows_db)
    top = rows_db[:3]
    names = await rule_names(c.db, c.tenant, [r[0] for r in top])
    sentences = [f"The failing rules of {c.label} put {_money(total, currency)} at risk in the run of {_when(c.run_at)}.",
                 "Each rule's cost is its failing records times a per-record cost from the cost model (" + currency + "); "
                 "records that fail several rules count under each.",
                 "The largest: " + "; ".join(f"{r[0]}{' ' + names[r[0]] if r[0] in names else ''} {_money(float(r[1]), currency)}"
                                             for r in top) + "."]
    rows: list[tuple] = [(f"{r[0]} ({_count(r[2])} records)", float(r[1]), currency) for r in top]
    if len(rows_db) > len(top):
        rows.append((f"{len(rows_db) - len(top)} smaller rules", round(total - sum(float(r[1]) for r in top), 2), currency))
    rows.append(("Value at risk", round(total, 2), currency))
    return _out(c, "value_at_risk", f"Where the {_money(total, currency)} at risk in {c.label} comes from", sentences, rows)


# ── failing pct ──────────────────────────────────────────────────────────────


async def _failing_pct(c: _Ctx, check_id: Optional[str]) -> dict:
    if not check_id:
        raise HTTPException(422, "failing_pct needs check_id")
    if c.run_id is None:
        raise HTTPException(404, "There is no finished run to explain yet.")
    r = (await c.db.execute(text(
        "SELECT module, severity, affected_count, total_count, dimension FROM findings WHERE version_id = :v AND tenant_id = :t "
        "AND check_id = :c AND (CAST(:m AS text) IS NULL OR module = :m) ORDER BY module LIMIT 1"),
        {**c.p, "c": check_id})).fetchone()
    if r is None:
        raise HTTPException(404, "That rule has no result in this run.")
    module, severity, failing, total = r[0], r[1], int(r[2] or 0), int(r[3] or 0)
    names = await rule_names(c.db, c.tenant, [check_id])
    name = names.get(check_id)
    t = c.cfg["critical_tolerance"]
    c.module = module
    if not total:
        return _out(c, "failing_pct", f"{check_id} has no population", [
            f"{check_id} checked no records in this run, so it has no failing share."], [("Records failing", failing, "records")])
    pct = failing / total * 100
    over = severity == "critical" and (pct >= t["pct"] or failing >= t["rows"]) and failing > 0
    sentences = [f"{check_id}{' (' + name + ')' if name else ''} fails {_count(failing)} of {_count(total)} records, {pct:.2f}%.",
                 (f"It is critical and over tolerance (at least {_n(t['pct'])}% or {_n(t['rows'])} records), so it can cap the score."
                  if over else
                  f"It is critical but within tolerance ({_n(t['pct'])}% or {_n(t['rows'])} records), so it does not cap the score."
                  if severity == "critical" and failing else
                  f"It is a {severity} rule; only critical rules can cap the score." if failing else "Nothing fails.")]
    rows: list[tuple] = [("Records failing", failing, "records"), ("Records checked", total, "records"),
                         ("Failing share", round(pct, 2), "%"), ("Pass rate", round(100 - pct, 2), "%"),
                         ("Severity", severity), ("Over tolerance", "yes" if over else "no")]
    return _out(c, "failing_pct", f"How many records {check_id} fails", sentences, rows)


# ── open work ────────────────────────────────────────────────────────────────


async def _open_work(c: _Ctx) -> dict:
    built = (await c.db.execute(text("SELECT metadata ? 'worklist_built_at' FROM analysis_versions WHERE id = :v AND tenant_id = :t"),
                                {"v": c.run_id, "t": str(c.tenant.id)})).scalar()
    if not built:
        return _out(c, "open_work", f"The work list for {c.label} is not built", [
            "The work list of this run has not been built yet, so open work cannot be counted."], [("Open work", None, "records")])
    by = {r[0]: int(r[1]) for r in (await c.db.execute(text(
        "SELECT status, sum(count)::bigint FROM work_counts WHERE version_id = :v AND tenant_id = :t AND module = :m "
        "GROUP BY status HAVING sum(count) <> 0"),  # migration 108
        c.p)).fetchall()}
    open_n = sum(by.get(s, 0) for s in OPEN_WORK)
    labels = {"to_fix": "to fix", "proposed": "with a proposed fix", "approved": "approved",
              "awaiting_load": "exported and waiting for the SAP load", "sent": "sent to SAP"}
    parts = [f"{_count(by[s])} {labels[s]}" for s in OPEN_WORK if by.get(s)]
    sentences = [f"{_count(open_n)} {'record' if open_n == 1 else 'records'} of {c.label} still need work in the run of {_when(c.run_at)}"
                 + (f": {', '.join(parts)}." if parts else "."),
                 "A record stays open until a later run shows it passing, so approved and sent records count until SAP is fixed and the data re-extracted."]
    if by.get("fixed") or by.get("not_an_issue"):
        sentences.append(f"Records already fixed ({_count(by.get('fixed', 0))}) or signed off as not an issue "
                         f"({_count(by.get('not_an_issue', 0))}) do not count.")
    names = {"to_fix": "To fix", "proposed": "With a proposed fix", "approved": "Approved",
             "awaiting_load": "Exported, waiting for the SAP load", "sent": "Sent to SAP"}
    rows = [(names[s], by.get(s, 0), "records") for s in OPEN_WORK] + [("Open work", open_n, "records")]
    return _out(c, "open_work", f"What is left to do in {c.label}", sentences, rows)


@router.get("/{metric}", response_model=ExplainOut)
async def explain(metric: Metric,
                  module: Optional[str] = Query(None, max_length=100, pattern=r"^[a-z0-9_]+$"),
                  run: Optional[uuid.UUID] = Query(None, description="default: the object's latest finished run"),
                  dimension: Optional[str] = Query(None, max_length=32),
                  check_id: Optional[str] = Query(None, max_length=64),
                  db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    """The title, a plain-language text and the arithmetic behind one number."""
    if metric in _NEEDS_MODULE and not module:
        raise HTTPException(422, f"{metric} needs module")
    await _rls(db, tenant)
    c = await _context(db, tenant, module, run, need_run=metric != "tolerance" or bool(module))
    if metric == "dqs":
        return await _dqs(c)
    if metric == "dimension":
        return await _dimension(c, dimension)
    if metric == "cap":
        return await _cap(c)
    if metric == "coverage":
        return await _coverage(c)
    if metric == "value_at_risk":
        return await _value_at_risk(c)
    if metric == "failing_pct":
        return await _failing_pct(c, check_id)
    if metric == "tolerance":
        return await _tolerance(c)
    return await _open_work(c)

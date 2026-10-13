"""Process mining over ``process_events`` (spec §3).

Aggregates run in Postgres. Conformance and the roll-ups that need variant sequences run in Python.
Every query is scoped by ``(tenant_id, system_id, l1, case_type)`` and walks ``ix_pe_case``."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable, Iterable, Optional, Sequence

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.engine import Row
from sqlalchemy.orm import Session
from sqlalchemy.types import Text

from api.services.process_discovery.events import DEFAULT_TZ, ActivityMap
from api.services.process_discovery.filters import ProcessFilter, case_filter_sql

START, END, OTHER = "__START__", "__END__", "__OTHER__"
OTHER_HASH = "0" * 32
TOP_VARIANTS = 2000
SAMPLES = 5
CACHE_TTL = 600

# f: the filtered cases; pe: their events. Shared by every query below.
_CASES = """
WITH f AS (
    SELECT case_id FROM process_events
    WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 AND case_type = :ct
    GROUP BY case_id HAVING {having}),
pe AS (
    SELECT p.* FROM process_events p JOIN f USING (case_id)
    WHERE p.tenant_id = :t AND p.system_id = :s AND p.l1 = :l1 AND p.case_type = :ct)"""

_SEQ = """,
e AS (
    SELECT case_id, activity, ts, l5_id, automated,
           lead(activity) OVER w AS nxt, lead(ts) OVER w AS nxt_ts, row_number() OVER w AS rn
    FROM pe WINDOW w AS (PARTITION BY case_id ORDER BY ts, seq, id))"""

DFG_SQL = _CASES + _SEQ + """
SELECT activity AS src, coalesce(nxt, '__END__') AS tgt, count(*) AS n, count(DISTINCT case_id) AS cases,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM nxt_ts - ts)) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM nxt_ts - ts)) AS p90_s
FROM e GROUP BY 1, 2
UNION ALL
SELECT '__START__', activity, count(*), count(*), NULL, NULL FROM e WHERE rn = 1 GROUP BY activity"""

NODES_SQL = _CASES + _SEQ + """,
r AS (SELECT activity, count(*) FILTER (WHERE n > 1) AS rework
      FROM (SELECT case_id, activity, count(*) AS n FROM pe GROUP BY 1, 2) x GROUP BY activity)
SELECT e.activity, max(e.l5_id) AS l5_id, count(*) AS events, count(DISTINCT e.case_id) AS cases,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM e.nxt_ts - e.ts)) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM e.nxt_ts - e.ts)) AS p90_s,
       count(*) FILTER (WHERE e.automated) AS auto_n, count(e.automated) AS auto_known,
       max(r.rework) AS rework
FROM e JOIN r USING (activity) GROUP BY e.activity"""

VARIANTS_SQL = _CASES + """,
v AS (
    SELECT case_id, string_agg(activity, '>' ORDER BY ts, seq, id) AS path,
           extract(epoch FROM max(ts) - min(ts)) AS dur
    FROM pe GROUP BY case_id)
SELECT path, md5(path) AS hash, count(*) AS n,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY dur) AS median_s,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY dur) AS p90_s,
       (array_agg(case_id ORDER BY case_id))[1:5] AS samples
FROM v GROUP BY GROUPING SETS ((path), ())"""

CASE_TYPES_SQL = """
SELECT case_type, count(DISTINCT case_id) FROM process_events
WHERE tenant_id = :t AND system_id = :s AND l1 = :l1 GROUP BY case_type"""

INSERT_VARIANT_SQL = text("""
INSERT INTO process_discovery_variants (run_id, tenant_id, case_type, variant_hash, activities, case_count,
                                        share, median_seconds, p90_seconds, fitness, sample_case_ids)
VALUES (:run_id, :tenant_id, :case_type, :variant_hash, :activities, :case_count, :share, :median_seconds,
        :p90_seconds, :fitness, :sample_case_ids)""").bindparams(
    bindparam("activities", type_=ARRAY(Text)), bindparam("sample_case_ids", type_=ARRAY(Text)))


@dataclass(frozen=True)
class Scope:
    tenant_id: str
    system_id: str
    l1: str
    tz: str = DEFAULT_TZ  # sap_systems.timezone, or the default

    def params(self, case_type: str) -> dict[str, object]:
        return {"t": self.tenant_id, "s": self.system_id, "l1": self.l1, "ct": case_type}


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    count: int
    cases: int
    median_seconds: Optional[float]
    p90_seconds: Optional[float]


@dataclass(frozen=True)
class ActivityStats:
    activity: str
    l5_id: Optional[str]
    events: int
    cases: int
    share: float
    median_seconds: Optional[float]  # to the next event of the same case
    p90_seconds: Optional[float]
    rework_rate: float               # cases repeating it / cases containing it
    automation_rate: Optional[float]
    auto_events: int
    auto_known: int


@dataclass
class Variant:
    hash: str
    activities: tuple[str, ...]
    case_count: int
    share: float
    median_seconds: Optional[float]
    p90_seconds: Optional[float]
    sample_case_ids: tuple[str, ...]
    fitness: Optional[float] = None


@dataclass(frozen=True)
class Conformance:
    fitness: Optional[float]
    missing: dict[str, float]       # expected key (alternatives joined by "|") -> share of cases missing it
    out_of_order: dict[str, float]  # activity -> share of cases where it is out of order
    step_fitness: dict[str, float]  # expected activity -> step fitness (spec §3.5)


@dataclass
class CaseTypeResult:
    case_type: str
    cases: int
    events: int
    median_seconds: Optional[float]
    p90_seconds: Optional[float]
    edges: list[Edge]
    activities: dict[str, ActivityStats]
    variants: list[Variant]         # every variant, by case count; ``stored()`` is the top 2,000 plus other
    conformance: Conformance = field(default_factory=lambda: Conformance(None, {}, {}, {}))

    def stored(self) -> list[Variant]:
        return truncate(self.variants, self.cases)

    def happy_path(self) -> dict[str, object]:
        """Celonis's "happy path": the most common variant that follows the expected process exactly.

        A variant with ``fitness == 1.0`` has no missing expected step and no out-of-order
        activity. The case count of the top such variant is how many cases went right first
        time, and its share of all cases is the process's health measure — the higher it is,
        the less rework, reordering and exception handling the process incurs.
        """
        perfect = [v for v in self.variants if v.fitness is not None and v.fitness >= 1.0]
        if not perfect:
            return {"activities": [], "case_count": 0, "share": 0.0, "fitness": None}
        v = max(perfect, key=lambda x: x.case_count)
        return {"activities": list(v.activities), "case_count": v.case_count,
                "share": round(v.case_count / self.cases, 4) if self.cases else 0.0,
                "fitness": v.fitness}


@dataclass
class MiningResult:
    l1: str
    primary: str
    by_type: dict[str, CaseTypeResult]

    def stats(self, tables: Optional[dict[str, dict[str, object]]] = None, truncated: Sequence[str] = (),
              shared_objects: int = 0) -> dict[str, object]:
        """``process_discovery_runs.stats`` (spec §3.6). Throughput and conformance are the primary case type's."""
        acts = [a for r in self.by_type.values() for a in r.activities.values()]
        known = sum(a.auto_known for a in acts)
        p = self.by_type.get(self.primary)
        return {
            "cases": sum(r.cases for r in self.by_type.values()),
            "events": sum(r.events for r in self.by_type.values()),
            "variants": sum(len(r.variants) for r in self.by_type.values()),
            "case_types": {ct: r.cases for ct, r in sorted(self.by_type.items())},
            "throughput": {"median_seconds": p.median_seconds if p else None,
                           "p90_seconds": p.p90_seconds if p else None},
            "automation_rate": round(sum(a.auto_events for a in acts) / known, 4) if known else None,
            "conformance": {"fitness": p.conformance.fitness if p else None,
                            "missing": p.conformance.missing if p else {},
                            "out_of_order": p.conformance.out_of_order if p else {}},
            "happy_path": p.happy_path() if p else {"activities": [], "case_count": 0, "share": 0.0, "fitness": None},
            "rework": {a.activity: round(a.rework_rate, 4) for a in acts if a.rework_rate > 0},
            "tables": tables or {},
            "truncated_tables": list(truncated),
            "shared_objects": shared_objects,
            "unmapped": {a.activity: a.events for a in acts if is_unmapped(a.l5_id)},
        }


def is_unmapped(l5_id: Optional[str]) -> bool:
    """No reference L4: the ``<L1>-DSC-…`` branch of spec §4.2 rule 3, or no id at all."""
    return not l5_id or "-DSC-" in l5_id


def _f(v: Decimal | float | None) -> Optional[float]:
    return None if v is None else float(v)


def _query(session: Session, sql: str, scope: Scope, case_type: str, flt: ProcessFilter) -> Sequence[Row[tuple[object, ...]]]:
    having, p = case_filter_sql(flt, scope.tz)
    return session.execute(text(sql.format(having=having)), {**scope.params(case_type), **p}).all()


def mine_case_type(session: Session, scope: Scope, case_type: str, flt: ProcessFilter,
                   mapping: Sequence[ActivityMap]) -> CaseTypeResult:
    """DFG, node stats, variants and conformance for one case type under ``flt``."""
    vrows = _query(session, VARIANTS_SQL, scope, case_type, flt)
    total = next((r for r in vrows if r.path is None), None)
    cases = int(total.n) if total else 0
    variants = sorted(
        (Variant(r.hash, tuple(r.path.split(">")), int(r.n), round(r.n / cases, 6), _f(r.median_s), _f(r.p90_s),
                 tuple(r.samples)) for r in vrows if r.path is not None),
        key=lambda v: (-v.case_count, v.hash))  # hash is the variant key
    edges = sorted((Edge(r.src, r.tgt, int(r.n), int(r.cases), _f(r.median_s), _f(r.p90_s))
                    for r in _query(session, DFG_SQL, scope, case_type, flt)),
                   key=lambda e: (-e.count, e.source, e.target))
    acts = {r.activity: ActivityStats(
        r.activity, r.l5_id, int(r.events), int(r.cases), round(r.cases / cases, 6) if cases else 0.0,
        _f(r.median_s), _f(r.p90_s), round(r.rework / r.cases, 6) if r.cases else 0.0,
        round(r.auto_n / r.auto_known, 6) if r.auto_known else None, int(r.auto_n), int(r.auto_known))
        for r in sorted(_query(session, NODES_SQL, scope, case_type, flt), key=lambda r: r.activity)}
    result = CaseTypeResult(case_type, cases, sum(a.events for a in acts.values()),
                            _f(total.median_s) if total else None, _f(total.p90_s) if total else None,
                            edges, acts, variants)
    result.conformance = conformance(result.stored(), [m for m in mapping if m.case_type == case_type])
    return result


def mine(session: Session, scope: Scope, mapping: Sequence[ActivityMap], primary: str) -> MiningResult:
    """Unfiltered mining of every case type present for the scope (the run's model, spec §4)."""
    types = [r[0] for r in session.execute(text(CASE_TYPES_SQL), scope.params(""))]
    return MiningResult(scope.l1, primary, {ct: mine_case_type(session, scope, ct, ProcessFilter(case_type=ct),
                                                               mapping) for ct in sorted(types)})


def truncate(variants: Sequence[Variant], cases: int, top: int = TOP_VARIANTS) -> list[Variant]:
    """The top ``top`` variants, plus one ``__OTHER__`` row summing the rest (spec §3.3). Medians of the
    other bucket are unknown, so they are None."""
    keep = list(variants[:top])
    rest = variants[top:]
    if rest:
        n = sum(v.case_count for v in rest)
        keep.append(Variant(OTHER_HASH, (OTHER,), n, round(n / cases, 6) if cases else 0.0, None, None,
                            tuple(sorted(c for v in rest for c in v.sample_case_ids))[:SAMPLES], 0.0))
    return keep


def store_variants(session: Session, run_id: str, tenant_id: str, result: CaseTypeResult) -> int:
    """Write the stored variants of one case type. The caller's session has ``app.tenant_id`` set."""
    rows = [{"run_id": run_id, "tenant_id": tenant_id, "case_type": result.case_type, "variant_hash": v.hash,
             "activities": list(v.activities), "case_count": v.case_count, "share": v.share,
             "median_seconds": None if v.median_seconds is None else round(v.median_seconds),
             "p90_seconds": None if v.p90_seconds is None else round(v.p90_seconds),
             "fitness": None if v.fitness is None else round(v.fitness, 4),
             "sample_case_ids": list(v.sample_case_ids)} for v in result.stored()]
    if rows:
        session.execute(INSERT_VARIANT_SQL, rows)
    return len(rows)


# --- conformance (spec §3.5) ---------------------------------------------------------------------------


def _order_of(mapping: Sequence[ActivityMap]) -> Callable[[str], Optional[int]]:
    exact: dict[str, int] = {}
    for m in mapping:
        exact[m.key] = min(m.order, exact.get(m.key, m.order))
    # A runtime key (STATUS_TECO, POST_FB01) belongs to its template row (STATUS_<STAT>, POST_<TCODE>).
    # Longest prefix wins, then prefix text, then order, so the pick never depends on mapping order.
    prefixes = sorted((m.key[:m.key.index("<")], m.order) for m in mapping if "<" in m.key)
    prefixes.sort(key=lambda po: -len(po[0]))

    def order(activity: str) -> Optional[int]:
        if activity in exact:
            return exact[activity]
        return next((o for p, o in prefixes if activity.startswith(p)), None)
    return order


def expected_groups(mapping: Sequence[ActivityMap]) -> list[frozenset[str]]:
    """Expected activities sorted by Order; rows sharing an Order are alternatives (one group)."""
    by_order: dict[int, set[str]] = {}
    for m in mapping:
        if m.expected and "<" not in m.key:
            by_order.setdefault(m.order, set()).add(m.key)
    return [frozenset(by_order[o]) for o in sorted(by_order)]


def score_variant(activities: Sequence[str], groups: Sequence[frozenset[str]],
                  order: Callable[[str], Optional[int]]) -> tuple[float, list[frozenset[str]], set[str]]:
    """(fitness, missing groups, activities out of order) for one variant."""
    present = set(activities)
    missing = [g for g in groups if not g & present]
    extra = sum(1 for a in activities if order(a) is None)
    firsts = [(a, o) for i, a in enumerate(activities) if a not in activities[:i] and (o := order(a)) is not None]
    bad: set[str] = set()
    inversions = 0
    for i, (a, oa) in enumerate(firsts):
        for b, ob in firsts[i + 1:]:
            if oa > ob:
                inversions += 1
                bad.update((a, b))
    denom = len(groups) + len(activities)
    fit = 1.0 - (len(missing) + extra + inversions) / denom if denom else 1.0
    return max(0.0, min(1.0, fit)), missing, bad


def conformance(variants: Iterable[Variant], mapping: Sequence[ActivityMap]) -> Conformance:
    """Score each variant (sets ``Variant.fitness``) and weight by case count. Without expected rows for the
    case type there is no reference to conform to, so every value is None or empty."""
    groups = expected_groups(mapping)
    if not groups:
        return Conformance(None, {}, {}, {})
    order = _order_of(mapping)
    total = 0
    fits: list[float] = []
    missing: Counter[frozenset[str]] = Counter()
    bad: Counter[str] = Counter()
    for v in sorted(variants, key=lambda x: (-x.case_count, x.hash)):
        fit, miss, oo = score_variant(v.activities, groups, order)
        v.fitness = round(fit, 4)
        total += v.case_count
        fits.append(fit * v.case_count)
        missing.update({g: v.case_count for g in miss})
        bad.update({a: v.case_count for a in oo})
    if not total:
        return Conformance(None, {}, {}, {})

    def name(g: frozenset[str]) -> str:
        return "|".join(sorted(g))
    step = {k: round(1 - (missing[g] + bad[k]) / total, 4) for g in groups for k in sorted(g)}
    return Conformance(round(math.fsum(fits) / total, 4),
                       {name(g): round(missing[g] / total, 4) for g in groups if missing[g]},
                       {a: round(n / total, 4) for a, n in sorted(bad.items())},
                       {k: max(0.0, v) for k, v in step.items()})


def loops(edges: Iterable[Edge]) -> set[tuple[str, str]]:
    """Back-edges of the DFG: target ranks before source in ``bpmn_layout._ranks`` (spec §3.4).
    Self-loops are rework, not loops, and are left out."""
    from api.services.bpmn_layout import _ranks

    pairs = sorted({(e.source, e.target) for e in edges if e.source != e.target})  # DFS order must not vary
    flows = [(f"e{i}", s, t) for i, (s, t) in enumerate(pairs)]
    nodes = sorted({n for _, s, t in flows for n in (s, t)})
    rank = _ranks(nodes, flows, [START] if START in nodes else [])
    return {(s, t) for _, s, t in flows if rank[t] <= rank[s]}  # a kept edge always raises the rank


def cache_key(scope: Scope, flt: ProcessFilter, run_id: str) -> str:
    """Redis key of a filtered DFG (spec §3.7). A new run changes ``run_id``, which invalidates it."""
    return f"pd:dfg:{scope.tenant_id}:{scope.system_id}:{scope.l1}:{flt.digest()}:{run_id}"

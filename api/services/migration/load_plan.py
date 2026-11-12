"""Migration load plan: the order in which migration objects must be loaded into the target, derived from the DDIC.

An object depends on another when a field its rules read has a check table that the other object owns: a customer's
company-code data (KNB1.AKONT) points at a G/L account (SKB1), so G/L accounts load first. Nothing here is guessed:
every edge names the field, its check table and the DDIC text, and an edge is ``required`` only when SAP refuses the
record without the field (sap/dictionaries/migration/s4hana_mandatory.yaml). Other edges are ``reference``: the load
succeeds, but the reference is empty or rejected until the other object is in.

Key fields are ignored (MCHA.CHARG points at its own batch table, not at a dependency), and so are fields read from
another object's own tables (material rules read LFA1 for the vendor name; that is the vendor's data, not the
material's). Cycles are broken on reference edges, which are loaded as a delta after both objects; a cycle made only
of required edges is reported as one step loaded together. Check tables no object in the plan owns are listed as
prerequisites: configuration that must already be in the target, or master data from outside the plan.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

import yaml  # type: ignore[import-untyped]

from sap.ddic import Dictionary

# The tables each migration object owns. The first table is the object's anchor; an object is planned only when its
# anchor is in the dictionary. A table belongs to one object only.
OWNED_TABLES: dict[str, tuple[str, ...]] = {
    "fi_gl": ("SKA1", "SKB1"),
    "controlling": ("CSKS", "CEPC", "CSKA"),
    "business_partner": ("BUT000",),
    "sd_customer_master": ("KNA1", "KNB1", "KNVV"),
    "accounts_payable": ("LFA1", "LFB1"),
    "material_master": ("MARA", "MARC"),
    "batch_management": ("MCH1", "MCHA"),
    "asset_accounting": ("ANLA",),
    "production_planning": ("STKO", "PLKO", "CRHD"),
    "plant_maintenance": ("EQUI", "IFLOT"),
    "project_system": ("PROJ", "PRPS"),
    "internal_orders": ("AUFK",),
    "mm_purchasing": ("EKKO", "EINA"),
    "quality_management": ("QINF", "QALS"),
    "sd_sales_orders": ("VBAK",),
    "deliveries_billing": ("LIKP", "VBRK"),
    "accounts_receivable": ("BSID",),
}

_CUSTOMIZING = {"C", "G", "E", "S"}
_MANDATORY = Path(__file__).resolve().parents[3] / "sap" / "dictionaries" / "migration" / "s4hana_mandatory.yaml"


@lru_cache(maxsize=1)
def mandatory_fields() -> dict[str, str]:
    """TABLE.FIELD to the reason SAP refuses a record without it."""
    raw = yaml.safe_load(_MANDATORY.read_text()) or {}
    return {k: str((v or {}).get("reason") or "") for k, v in raw.items()}


@dataclass
class Evidence:
    field: str
    text: str
    check_table: str
    required: bool
    reason: Optional[str] = None


@dataclass
class Edge:
    before: str          # the object that loads first
    after: str           # the object that needs it
    kind: str            # required | reference
    evidence: list[Evidence]
    deferred: bool = False  # a reference edge inside a cycle: load as a delta after both objects


@dataclass
class Prerequisite:
    table: str
    text: str
    kind: str            # configuration | master_data | unclassified
    fields: list[str]


@dataclass
class PlanObject:
    module: str
    anchor: str
    anchor_text: str
    step: int = 0
    group: list[str] = field(default_factory=list)  # other objects in the same required cycle
    prerequisites: list[Prerequisite] = field(default_factory=list)


@dataclass
class LoadPlan:
    objects: list[PlanObject]
    edges: list[Edge]
    unknown: list[str]   # requested modules Meridian has no load object for, or whose anchor the dictionary lacks


def _scc(nodes: list[str], succ: dict[str, set[str]]) -> list[list[str]]:
    """Tarjan's strongly connected components, iterative, in a stable order."""
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    stack: list[str] = []
    on: set[str] = set()
    out: list[list[str]] = []
    counter = 0
    for root in nodes:
        if root in index:
            continue
        work = [(root, iter(sorted(succ.get(root, ()))))]
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on.add(root)
        while work:
            v, it = work[-1]
            nxt = next(it, None)
            if nxt is None:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[v])
                if low[v] == index[v]:
                    comp = []
                    while True:
                        w = stack.pop()
                        on.discard(w)
                        comp.append(w)
                        if w == v:
                            break
                    out.append(sorted(comp))
                continue
            if nxt not in index:
                index[nxt] = low[nxt] = counter
                counter += 1
                stack.append(nxt)
                on.add(nxt)
                work.append((nxt, iter(sorted(succ.get(nxt, ())))))
            elif nxt in on:
                low[v] = min(low[v], index[nxt])
    return out


def build_plan(modules: Iterable[str], dictionary: Dictionary, columns_of) -> LoadPlan:
    """The load plan of ``modules``. ``columns_of(module)`` returns the TABLE.FIELD set the module's rules read."""
    wanted = list(dict.fromkeys(modules))
    unknown = [m for m in wanted if m not in OWNED_TABLES or dictionary.table(OWNED_TABLES[m][0]) is None]
    planned = [m for m in wanted if m not in unknown]
    owner = {t: m for m in planned for t in OWNED_TABLES[m] if dictionary.table(t) is not None}
    all_owned = {t for ts in OWNED_TABLES.values() for t in ts}
    mandatory = mandatory_fields()

    objects: dict[str, PlanObject] = {}
    found: dict[tuple[str, str], list[Evidence]] = {}
    for m in planned:
        anchor = dictionary.table(OWNED_TABLES[m][0])
        obj = PlanObject(module=m, anchor=anchor.name if anchor else "", anchor_text=(anchor.description if anchor else "") or "")
        prereq: dict[str, list[str]] = {}
        for q in sorted(columns_of(m)):
            f = dictionary.resolve(q)
            if f is None or f.key or not f.check_table or f.table not in OWNED_TABLES[m]:
                continue  # unknown, a key, or read from a table this object does not own
            ct = f.check_table
            if ct in OWNED_TABLES[m]:
                continue  # a reference inside the object itself
            dep = owner.get(ct)
            if dep:
                req = q in mandatory
                found.setdefault((dep, m), []).append(Evidence(q, f.description or "", ct, req, mandatory.get(q) if req else None))
            elif ct not in all_owned:
                prereq.setdefault(ct, []).append(q)
        for ct, qs in sorted(prereq.items()):
            t = dictionary.table(ct)
            dc = t.delivery_class if t else None
            kind = "configuration" if dc in _CUSTOMIZING else "master_data" if dc == "A" else "unclassified"
            obj.prerequisites.append(Prerequisite(ct, (t.description if t else "") or "", kind, qs))
        objects[m] = obj

    edges = [Edge(b, a, "required" if any(e.required for e in ev) else "reference", ev)
             for (b, a), ev in sorted(found.items())]

    # Break cycles on reference edges first; whatever cycle is left is loaded together.
    def succ_of(es: list[Edge]) -> dict[str, set[str]]:
        s: dict[str, set[str]] = {}
        for e in es:
            if not e.deferred:
                s.setdefault(e.before, set()).add(e.after)
        return s

    for comp in _scc(planned, succ_of(edges)):
        if len(comp) > 1:
            members = set(comp)
            for e in edges:
                if e.kind == "reference" and e.before in members and e.after in members:
                    e.deferred = True
    comps = _scc(planned, succ_of(edges))
    comp_of = {m: i for i, c in enumerate(comps) for m in c}

    # Step = longest chain of predecessors over the condensed graph (components come out of Tarjan in reverse
    # topological order, so walk them backwards).
    preds: dict[int, set[int]] = {}
    for e in edges:
        if not e.deferred and comp_of[e.before] != comp_of[e.after]:
            preds.setdefault(comp_of[e.after], set()).add(comp_of[e.before])
    step: dict[int, int] = {}
    for i in reversed(range(len(comps))):
        step[i] = 1 + max((step[p] for p in preds.get(i, ())), default=0)
    for m, obj in objects.items():
        obj.step = step[comp_of[m]]
        obj.group = [x for x in comps[comp_of[m]] if x != m]

    ordered = sorted(objects.values(), key=lambda o: (o.step, planned.index(o.module)))
    return LoadPlan(objects=ordered, edges=edges, unknown=unknown)

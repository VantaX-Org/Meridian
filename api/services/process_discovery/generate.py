"""L1 to L5 generation from a mining result (spec §4).

Starts from the reference model of one L1 (with the tenant's config overlay already applied by the caller),
places every mined activity on an L5 by the four rules of spec §4.2, attaches ``DiscoveryStats`` at every
level, and rebuilds the diagram of every observed L4 from its as-is flow."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable, NamedTuple, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.models.process_model import (ID_PATTERN, L1, L2, L3, L4, L5, Diagram, DiscoveryEdge, DiscoveryStats, FieldRef,
                                      Flow, Node, ProcessModelDocument)
from api.services.process_discovery.events import ActivityMap
from api.services.process_discovery.mining import (END, START, CaseTypeResult, MiningResult, Scope, Variant,
                                                   is_unmapped)

EDGE_THRESHOLD = 0.01  # spec §4.3: keep an edge carrying at least 1% of the case type's cases
_ID = re.compile(ID_PATTERN)
_KEY = re.compile(r"[^A-Z0-9_]")
_REF = re.compile(r"^[A-Za-z0-9_/]+\.[A-Za-z0-9_/]+$")
_SLOT = re.compile(r"<[^>]+>")

WRITE_BACK_SQL = text("""
UPDATE process_events pe SET l5_id = v.l5_id
FROM unnest(CAST(:cts AS text[]), CAST(:acts AS text[]), CAST(:l5s AS text[])) AS v(case_type, activity, l5_id)
WHERE pe.tenant_id = :t AND pe.system_id = :s AND pe.l1 = :l1
  AND pe.case_type = v.case_type AND pe.activity = v.activity AND pe.l5_id IS DISTINCT FROM v.l5_id""")


class Generated(NamedTuple):
    document: ProcessModelDocument
    l5_of: dict[tuple[str, str], str]  # (case_type, activity) -> L5 id, for ``write_back``


def node_key(activity: str) -> str:
    """Activity key as an id segment: characters outside ``[A-Z0-9_]`` become ``_`` (spec §4.2 rule 2)."""
    return _KEY.sub("_", activity.upper()) or "NONE"


def unique_keys(activities: Iterable[str]) -> dict[str, str]:
    """``node_key`` per activity, made collision-free: activities sharing a key ("a.b", "a_b") are taken in
    sorted name order and a later one gets ``_<n>`` appended, so no two share a discovered L4."""
    out: dict[str, str] = {}
    used: set[str] = set()
    for a in sorted(set(activities)):
        base = key = node_key(a)
        n = 1
        while key in used:
            n += 1
            key = f"{base}_{n}"
        used.add(key)
        out[a] = key
    return out


def mapping_row(activity: str, mapping: Sequence[ActivityMap]) -> Optional[ActivityMap]:
    """The exact row, else the template row (``STATUS_<STAT>``) whose prefix the runtime key carries."""
    exact = next((m for m in mapping if m.key == activity), None)
    if exact:
        return exact
    return next((m for m in mapping if "<" in m.key and activity.startswith(m.key[:m.key.index("<")])), None)


def label_of(activity: str, row: Optional[ActivityMap]) -> str:
    if row is None:
        return activity
    if "<" not in row.key:
        return row.label
    return _SLOT.sub(activity[row.key.index("<"):] or "none", row.label, count=1)


def fields_of(row: Optional[ActivityMap]) -> list[FieldRef]:
    refs = dict.fromkeys(t for t in (row.source.split() if row else []) if _REF.match(t))
    return [FieldRef(field=r) for r in refs]


@dataclass
class _Index:
    """Parent links of one L1, kept current while discovered nodes are added."""
    l1: L1
    l2: dict[str, L2]
    l3: dict[str, L3]
    l4: dict[str, L4]
    l5: dict[str, L5]
    up: dict[str, str]  # child id -> parent id, for L2..L5

    @classmethod
    def of(cls, l1: L1) -> "_Index":
        ix = cls(l1, {}, {}, {}, {}, {})
        for b in l1.l2:
            ix.l2[b.id], ix.up[b.id] = b, l1.id
            for c in b.l3:
                ix.l3[c.id], ix.up[c.id] = c, b.id
                for d in c.l4:
                    ix.l4[d.id], ix.up[d.id] = d, c.id
                    for a in d.activities:
                        ix.l5[a.id], ix.up[a.id] = a, d.id
        return ix

    def add_l5(self, l4: L4, l5_id: str, name: str, fields: list[FieldRef]) -> L5:
        if l5_id not in self.l5:
            a = L5(id=l5_id, name=name, order=max((x.order for x in l4.activities), default=0) + 1,
                   fields=fields, source="discovered").with_derived()
            l4.activities.append(a)
            self.l5[l5_id], self.up[l5_id] = a, l4.id
        return self.l5[l5_id]

    def dsc_l4(self, key: str, name: str) -> L4:
        """``<L1>-DSC`` / ``<L1>-DSC-P1`` / ``<L1>-DSC-<KEY>`` (spec §4.2 rule 3)."""
        root = self.l1.id
        l2_id, l3_id, l4_id = f"{root}-DSC", f"{root}-DSC-P1", f"{root}-DSC-{key}"
        if l2_id not in self.l2:
            b = L2(id=l2_id, name="Discovered, not in reference", source="discovered",
                   order=max((x.order for x in self.l1.l2), default=0) + 1)
            self.l1.l2.append(b)
            self.l2[l2_id], self.up[l2_id] = b, root
        if l3_id not in self.l3:
            c = L3(id=l3_id, name="Discovered activities", order=1, source="discovered")
            self.l2[l2_id].l3.append(c)
            self.l3[l3_id], self.up[l3_id] = c, l2_id
        if l4_id not in self.l4:
            c = self.l3[l3_id]
            d = L4(id=l4_id, name=name, order=len(c.l4) + 1, source="discovered")
            c.l4.append(d)
            self.l4[l4_id], self.up[l4_id] = d, l3_id
        return self.l4[l4_id]

    def place(self, activity: str, l5_id: Optional[str], row: Optional[ActivityMap], key: str) -> str:
        """Spec §4.2 rules 1-3. Returns the L5 id the activity's events belong to."""
        if l5_id in self.l5 and not is_unmapped(l5_id):
            return l5_id                                                           # rule 1
        parent = l5_id.rsplit("-", 1)[0] if l5_id else ""
        if l5_id and not is_unmapped(l5_id) and _ID.match(l5_id) and parent in self.l4:
            return self.add_l5(self.l4[parent], l5_id, label_of(activity, row), fields_of(row)).id  # rule 2
        l4 = self.dsc_l4(key, label_of(activity, row))
        return self.add_l5(l4, f"{l4.id}-01", label_of(activity, row), fields_of(row)).id


def _roll(variants: Iterable[Variant], up: dict[str, str], raw_rework: bool) -> tuple[
        Counter[str], Counter[str], Counter[str], Counter[tuple[str, str]]]:
    """Cases, events, rework cases and transitions per node, with activities mapped through ``up``.

    Consecutive events under one node collapse to one visit; transitions run between visits and include
    ``__START__`` and ``__END__``. ``raw_rework`` (the L5 level) counts any repeat as rework, like the SQL."""
    cases: Counter[str] = Counter()
    events: Counter[str] = Counter()
    rework: Counter[str] = Counter()
    trans: Counter[tuple[str, str]] = Counter()
    for v in variants:
        n = v.case_count
        seq = [up[a] for a in v.activities]
        visits = [x for i, x in enumerate(seq) if i == 0 or seq[i - 1] != x]
        for x, k in Counter(seq).items():
            events[x] += k * n
        for x, k in Counter(visits).items():
            cases[x] += n
            if k > 1 or (raw_rework and seq.count(x) > 1):
                rework[x] += n
        for a, b in zip([START, *visits], [*visits, END]):
            trans[(a, b)] += n
    return cases, events, rework, trans


def _level_stats(r: CaseTypeResult, up: dict[str, str], parent: dict[str, str], level: int,
                 members: dict[str, list[str]]) -> dict[str, DiscoveryStats]:
    """DiscoveryStats per node of one level for one case type. ``members``: node -> its activities."""
    cases, events, rework, trans = _roll(r.variants, up, raw_rework=level == 5)
    dfg = {(e.source, e.target): e for e in r.edges}
    out: dict[str, DiscoveryStats] = {}
    for x in sorted(cases):
        acts = sorted(members[x], key=lambda a: (-r.activities[a].events, a))
        sib: Counter[str] = Counter()
        leave = entry = 0
        for (a, b), n in trans.items():
            if a == x and b != x:
                if b != END and parent.get(b) == parent[x]:
                    sib[b] += n
                else:
                    leave += n
            if b == x and a != x and (a == START or parent.get(a) != parent[x]):
                entry += n
        edges: list[DiscoveryEdge] = []
        for t, n in sorted(sib.items(), key=lambda kv: (-kv[1], kv[0])):
            med = None
            if level == 5 and len(acts) == 1 and len(members[t]) == 1:
                e = dfg.get((acts[0], members[t][0]))
                med = e.median_seconds if e else None
            edges.append(DiscoveryEdge(target=t, count=n, median_seconds=med))
        if leave:
            edges.append(DiscoveryEdge(target=END, count=leave))
        known = sum(r.activities[a].auto_known for a in acts)
        lead = r.activities[acts[0]]
        out[x] = DiscoveryStats(
            case_count=cases[x], share=round(cases[x] / r.cases, 6) if r.cases else 0.0, event_count=events[x],
            # ponytail: L2-L4 medians need per-case timestamps the variant roll-up lacks; None until a SQL roll-up.
            median_seconds=lead.median_seconds if level == 5 else None,
            p90_seconds=lead.p90_seconds if level == 5 else None,
            rework_rate=round(rework[x] / cases[x], 6),
            automation_rate=round(sum(r.activities[a].auto_events for a in acts) / known, 6) if known else None,
            fitness=r.conformance.step_fitness.get(lead.activity) if level == 5 else None,
            observed=True, case_type=r.case_type, edges=edges, entry_count=entry)
    return out


def keep_edges(edges: Sequence[tuple[str, str, int]], cases: int, starts: Iterable[str],
               threshold: float = EDGE_THRESHOLD) -> list[tuple[str, str, int]]:
    """Spec §4.3 pruning: keep an edge with ``count >= threshold * cases`` or the only outgoing edge of its
    source. A node left unreachable from ``starts`` gets back its strongest edge from a reachable node, so the
    diagram stays connected (``process_model_validator`` requires it)."""
    outdeg = Counter(s for s, _, _ in edges)
    kept = {e for e in edges if e[2] >= threshold * cases or outdeg[e[0]] == 1}
    nodes = {n for s, t, _ in edges for n in (s, t)}
    while True:
        seen, stack = set(starts), list(starts)
        while stack:
            x = stack.pop()
            for s, t, _ in kept:
                if s == x and t not in seen:
                    seen.add(t)
                    stack.append(t)
        back = [e for e in edges if e not in kept and e[0] in seen and e[1] not in seen]
        if not back or nodes <= seen:
            return [e for e in edges if e in kept]
        kept.add(min(back, key=lambda e: (-e[2], e[0], e[1])))


def _diagram(l4: L4, cases: int) -> Diagram:
    """The as-is L4 diagram (spec §4.3): observed tasks wired by kept edges, XOR gateways at fan-out and fan-in,
    not-observed reference tasks unconnected."""
    base = l4.id
    s_id, e_id = f"{base}-S", f"{base}-E"
    acts = sorted(l4.activities, key=lambda a: (a.order, a.id))
    seen = [(a, a.discovery) for a in acts if a.discovery and a.discovery.observed]
    cand: list[tuple[str, str, int]] = []
    for a, d in seen:
        if d.entry_count:
            cand.append((s_id, f"{a.id}-T", d.entry_count))
    for a, d in seen:
        for e in d.edges:
            cand.append((f"{a.id}-T", e_id if e.target == END else f"{e.target}-T", e.count))
    kept = keep_edges(cand, cases, [s_id])
    outdeg = Counter(s for s, _, _ in kept)
    indeg = Counter(t for _, t, _ in kept)

    def gw(node: str, side: str) -> str:
        return f"{base}-GS" if node == s_id else f"{node[:-2]}-G{side}"

    nodes: list[Node] = [Node(id=s_id, type="startEvent", label="Start")]
    nodes += [Node(id=f"{a.id}-T", type="task", activity_id=a.id) for a, _ in seen]
    nodes += [Node(id=e_id, type="endEvent", label="End")]
    flows: list[Flow] = []

    def link(src: str, dst: str, label: Optional[str] = None) -> None:
        flows.append(Flow(id=f"{base}-F{len(flows) + 1}", source=src, target=dst, label=label))

    for x in [s_id, *(f"{a.id}-T" for a, _ in seen)]:
        if outdeg[x] > 1:
            nodes.append(Node(id=gw(x, "O"), type="exclusiveGateway"))
            link(x, gw(x, "O"))
        if x != s_id and indeg[x] > 1:
            nodes.append(Node(id=gw(x, "I"), type="exclusiveGateway"))
            link(gw(x, "I"), x)
    for s, t, n in kept:
        src = gw(s, "O") if outdeg[s] > 1 else s
        dst = gw(t, "I") if t != e_id and indeg[t] > 1 else t
        link(src, dst, f"{n:,} cases")
    nodes += [Node(id=f"{a.id}-T", type="task", activity_id=a.id) for a in acts if a not in [x for x, _ in seen]]
    return Diagram(nodes=nodes, flows=flows)


def generate(base: ProcessModelDocument, mining: MiningResult, mapping: Sequence[ActivityMap],
             system_type: Optional[str] = None) -> Generated:
    """The as-is model of ``mining.l1`` (spec §4). ``base`` is ``reference_document()`` with the tenant's config
    overlay applied; it is not modified."""
    doc = base.model_copy(deep=True)
    doc.l1 = [x for x in doc.l1 if x.id == mining.l1]
    if not doc.l1:
        raise ValueError(f"{mining.l1} is not in the reference model")
    doc.source, doc.system_type = "discovered", system_type
    root = doc.l1[0]
    ix = _Index.of(root)

    l5_of: dict[tuple[str, str], str] = {}
    keys = unique_keys(a for r in mining.by_type.values() for a in r.activities)
    for ct, r in sorted(mining.by_type.items()):
        rows = {a: mapping_row(a, [m for m in mapping if m.case_type == ct]) for a in r.activities}
        for a in sorted(r.activities, key=lambda a: (rows[a].order if rows[a] else 1_000_000, a)):
            l5_of[(ct, a)] = ix.place(a, r.activities[a].l5_id, rows[a], keys[a])

    # Stats per level; a node seen by several case types keeps the one with the most cases.
    best: dict[str, DiscoveryStats] = {}
    for ct, r in sorted(mining.by_type.items()):
        up5 = {a: l5_of[(ct, a)] for a in r.activities}
        ups = [up5]
        for _ in range(3):  # L4, L3, L2
            ups.append({a: ix.up[x] for a, x in ups[-1].items()})
        for level, up in zip((5, 4, 3, 2), ups):
            members: dict[str, list[str]] = {}
            for a, x in up.items():
                members.setdefault(x, []).append(a)
            for x, st in _level_stats(r, up, ix.up, level, members).items():
                if x not in best or (st.case_count, best[x].case_type or "") > (best[x].case_count, ct):
                    best[x] = st

    p = mining.by_type.get(mining.primary)
    known = sum(a.auto_known for a in p.activities.values()) if p else 0
    root.discovery = DiscoveryStats(
        case_count=p.cases if p else 0, share=1.0 if p and p.cases else 0.0, event_count=p.events if p else 0,
        median_seconds=p.median_seconds if p else None, p90_seconds=p.p90_seconds if p else None,
        automation_rate=round(sum(a.auto_events for a in p.activities.values()) / known, 6) if known else None,
        fitness=p.conformance.fitness if p else None, observed=bool(p and p.cases), case_type=mining.primary)
    for nodes in (ix.l2, ix.l3, ix.l4, ix.l5):
        for x, node in nodes.items():
            node.discovery = best.get(x) or DiscoveryStats(observed=False)                # rule 4
    for x, l4 in ix.l4.items():
        d = l4.discovery
        if d and d.observed and d.case_type:
            l4.diagram = _diagram(l4, mining.by_type[d.case_type].cases)
    return Generated(ProcessModelDocument.model_validate(doc.model_dump()), l5_of)


def write_back(session: Session, scope: Scope, l5_of: dict[tuple[str, str], str]) -> int:
    """Point ``process_events.l5_id`` at the generated L5s in one statement per L1 (spec §4.2).
    The caller's session has ``app.tenant_id`` set."""
    if not l5_of:
        return 0
    keys = sorted(l5_of)
    return session.execute(WRITE_BACK_SQL, {
        "t": scope.tenant_id, "s": scope.system_id, "l1": scope.l1,
        "cts": [k[0] for k in keys], "acts": [k[1] for k in keys], "l5s": [l5_of[k] for k in keys]}).rowcount

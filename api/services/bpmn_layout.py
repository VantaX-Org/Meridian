"""BPMNDI layout for one diagram (pure, no dependencies).

Works on plain ids so the L4 diagrams and the L1-L3 call-activity landscapes share it.
Sizes: task 100x80, gateway 50x50, event 36x36; grid X0=60, COL=180, Y0=60, ROW=110.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

SIZES = {"task": (100, 80), "gateway": (50, 50), "event": (36, 36)}
X0, COL, Y0, ROW = 60, 180, 60, 110
LABEL_W, LABEL_H = 90, 20

Point = tuple[int, int]


@dataclass(frozen=True)
class Bounds:
    x: int
    y: int
    w: int
    h: int

    @property
    def cx(self) -> int:
        return self.x + self.w // 2

    @property
    def cy(self) -> int:
        return self.y + self.h // 2


@dataclass
class Layout:
    shapes: dict[str, Bounds] = field(default_factory=dict)
    edges: dict[str, list[Point]] = field(default_factory=dict)
    node_labels: dict[str, Bounds] = field(default_factory=dict)  # gateways and events
    edge_labels: dict[str, Bounds] = field(default_factory=dict)  # flows that have a name


def _ranks(order: list[str], flows: list[tuple[str, str, str]], starts: list[str]) -> dict[str, int]:
    out: dict[str, list[str]] = {n: [] for n in order}
    for _, s, t in flows:
        if s in out and t in out:
            out[s].append(t)
    # DFS from the start events (then any node left over) drops back-edges, so loops do not rank forever.
    state: dict[str, int] = {}
    back: set[tuple[str, str]] = set()
    topo: list[str] = []
    for root in [*starts, *order]:
        if root in state:
            continue
        state[root] = 1
        stack = [(root, iter(out[root]))]
        while stack:
            node, it = stack[-1]
            for nxt in it:
                if state.get(nxt) == 1:
                    back.add((node, nxt))
                elif nxt not in state:
                    state[nxt] = 1
                    stack.append((nxt, iter(out[nxt])))
                    break
            else:
                state[node] = 2
                topo.append(node)
                stack.pop()
    rank = {n: 0 for n in order}
    for n in reversed(topo):
        for t in out[n]:
            if (n, t) not in back:
                rank[t] = max(rank[t], rank[n] + 1)
    return rank


def _route(a: Bounds, b: Bounds) -> list[Point]:
    if b.x >= a.x + a.w:  # forward
        if a.cy == b.cy:
            return [(a.x + a.w, a.cy), (b.x, b.cy)]
        mid = (a.x + a.w + b.x) // 2
        return [(a.x + a.w, a.cy), (mid, a.cy), (mid, b.cy), (b.x, b.cy)]
    if b.x >= a.x - COL // 2 and b.x <= a.x + COL // 2:  # same column, different row
        bend = a.x + a.w + COL // 2
        return [(a.x + a.w, a.cy), (bend, a.cy), (bend, b.cy), (b.x + b.w, b.cy)]
    down = max(a.y + a.h, b.y + b.h) + ROW // 2  # back-edge runs under both shapes
    return [(a.cx, a.y + a.h), (a.cx, down), (b.cx, down), (b.cx, b.y + b.h)]


def layout_diagram(
    nodes: list[tuple[str, str]],
    flows: list[tuple[str, str, str]],
    flow_labels: Optional[dict[str, str]] = None,
    positions: Optional[dict[str, tuple[int, int]]] = None,
    starts: Optional[list[str]] = None,
) -> Layout:
    """``nodes`` = [(id, kind)] with kind task|gateway|event; ``flows`` = [(id, source, target)].

    ``positions`` (designer x,y per node id) is used 1:1, shifted to start at (X0, Y0), only when it
    covers every node; otherwise nodes are ranked and placed on the grid.
    """
    order = [n for n, _ in nodes]
    kind = dict(nodes)
    lay = Layout()
    if positions and all(n in positions for n in order):
        mx = min(positions[n][0] for n in order)
        my = min(positions[n][1] for n in order)
        for n in order:
            w, h = SIZES[kind[n]]
            lay.shapes[n] = Bounds(X0 + positions[n][0] - mx, Y0 + positions[n][1] - my, w, h)
    else:
        rank = _ranks(order, flows, starts or [n for n in order if kind[n] == "event" and not any(t == n for _, _, t in flows)])
        seen: list[str] = []
        for _, s, t in flows:
            for n in (s, t):
                if n in kind and n not in seen:
                    seen.append(n)
        seen += [n for n in order if n not in seen]
        used: dict[int, int] = {}
        for n in seen:
            w, h = SIZES[kind[n]]
            r, i = rank[n], used.get(rank[n], 0)
            used[r] = i + 1
            lay.shapes[n] = Bounds(X0 + r * COL + (COL - w) // 2, Y0 + i * ROW + (ROW - h) // 2, w, h)
    for n in order:
        b = lay.shapes[n]
        if kind[n] != "task":
            lay.node_labels[n] = Bounds(b.cx - LABEL_W // 2, b.y + b.h + 2, LABEL_W, LABEL_H)
    for fid, s, t in flows:
        pts = _route(lay.shapes[s], lay.shapes[t])
        lay.edges[fid] = pts
        if flow_labels and flow_labels.get(fid):
            bx, by = pts[1] if len(pts) > 2 else ((pts[0][0] + pts[1][0]) // 2, pts[0][1])
            lay.edge_labels[fid] = Bounds(bx + 4, by - LABEL_H - 2, 50, LABEL_H)
    return lay

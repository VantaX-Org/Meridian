"""Workload balancing for stewards (POST /api/v1/people/balance/plan and /apply).

``plan`` proposes moving open record issues between the people who can fix them so their open counts end within one of
each other (``by="owner"``), or within the smallest spread that moving whole objects allows (``by="object"``: a
person keeps all of one object's issues together). Unassigned issues are handed out first. Issues assigned to anyone
outside the candidates are left where they are.

Pure and deterministic: the same items and candidates give the same plan (ties break by user id, then module, then
issue id). The route applies a plan through the undo recorder, so one Undo puts every issue back.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any, Literal

By = Literal["owner", "object"]
MAX_MOVES = 5000


def _loads(items: list[Mapping[str, Any]], people: list[str]) -> dict[str, int]:
    load = {p: 0 for p in people}
    for i in items:
        if i.get("assigned_to") in load:
            load[i["assigned_to"]] += 1
    return load


def _least(load: dict[str, int]) -> str:
    """The least loaded person; the smallest id on a tie (min keeps the first of equals)."""
    return min(sorted(load), key=lambda p: load[p])


def _most(load: dict[str, int]) -> str:
    """The most loaded person; the smallest id on a tie (max keeps the first of equals)."""
    return max(sorted(load), key=lambda p: load[p])


def plan(items: Iterable[Mapping[str, Any]], candidates: Iterable[str], by: By = "owner") -> dict[str, Any]:
    """{by, before, after, moves: [{from, to, module, count, issue_ids}], moved} over the open issues ``items``
    ({id, module, assigned_to}) and the people who can take work."""
    people = sorted(set(candidates))
    pool = sorted((dict(i) for i in items if i.get("assigned_to") is None or i.get("assigned_to") in people),
                  key=lambda i: (str(i.get("module")), str(i["id"])))
    before = _loads(pool, people)
    if not people:
        return {"by": by, "before": {}, "after": {}, "moves": [], "moved": 0}
    load = dict(before)
    owner_of: dict[str, str | None] = {i["id"]: i.get("assigned_to") for i in pool}
    module_of = {i["id"]: str(i.get("module")) for i in pool}
    moves: list[tuple[str | None, str, str]] = []  # (from, to, issue id)

    # 1. unassigned work: whole objects to the least loaded in object mode, one issue at a time otherwise
    unassigned = [i for i in pool if i.get("assigned_to") is None]
    if by == "object":
        groups: dict[str, list[str]] = defaultdict(list)
        for i in unassigned:
            groups[module_of[i["id"]]].append(i["id"])
        for module in sorted(groups, key=lambda m: (-len(groups[m]), m)):
            to = _least(load)
            for iid in groups[module]:
                moves.append((None, to, iid))
                owner_of[iid] = to
            load[to] += len(groups[module])
    else:
        for i in unassigned:
            to = _least(load)
            moves.append((None, to, i["id"]))
            owner_of[i["id"]] = to
            load[to] += 1

    # 2. even out what is assigned
    if by == "owner":
        while len(moves) < MAX_MOVES:
            hi, lo = _most(load), _least(load)
            if load[hi] - load[lo] <= 1:
                break
            iid = max((x for x, o in owner_of.items() if o == hi), key=lambda x: (module_of[x], x))
            moves.append((hi, lo, iid))
            owner_of[iid] = lo
            load[hi] -= 1
            load[lo] += 1
    else:
        while len(moves) < MAX_MOVES:
            hi, lo = _most(load), _least(load)
            spread = load[hi] - load[lo]
            groups = defaultdict(list)
            for x, o in owner_of.items():
                if o == hi:
                    groups[module_of[x]].append(x)
            best = None
            for module in sorted(groups):
                n = len(groups[module])
                new = max(load[hi] - n, load[lo] + n, *(v for p, v in load.items() if p not in (hi, lo))) - \
                    min(load[hi] - n, load[lo] + n, *(v for p, v in load.items() if p not in (hi, lo)))
                if new < spread and (best is None or new < best[0]):
                    best = (new, module)
            if best is None:
                break
            for x in sorted(groups[best[1]]):
                moves.append((hi, lo, x))
                owner_of[x] = lo
            load[hi] -= len(groups[best[1]])
            load[lo] += len(groups[best[1]])

    # 3. fold to one row per (from, to, module); an issue moved twice counts once, from its first owner to its last
    first: dict[str, str | None] = {}
    last: dict[str, str] = {}
    for frm, to, iid in moves:
        first.setdefault(iid, frm)
        last[iid] = to
    folded: dict[tuple[str | None, str, str], list[str]] = defaultdict(list)
    for iid in sorted(last):
        if first[iid] != last[iid]:
            folded[(first[iid], last[iid], module_of[iid])].append(iid)
    rows = [{"from": f, "to": t, "module": m, "count": len(ids), "issue_ids": ids}
            for (f, t, m), ids in sorted(folded.items(), key=lambda kv: (kv[0][0] or "", kv[0][1], kv[0][2]))]
    return {"by": by, "before": before, "after": load, "moves": rows, "moved": sum(r["count"] for r in rows)}


def by_template(items: Iterable[Mapping[str, Any]], candidates: Iterable[str],
                assignments: Mapping[tuple[str, str], str], slice_kind: Mapping[str, str]) -> dict[str, Any]:
    """The plan that gives each open issue to the steward the assignment template names for its object and slice
    (``assignments`` maps (module, slice value or "*") to a user; ``slice_kind`` maps a module to its slice kind).
    Issues with no named steward, or whose steward cannot take work, stay where they are."""
    from api.services.stewardship import slice_of

    people = sorted(set(candidates))
    pool = sorted((dict(i) for i in items), key=lambda i: (str(i.get("module")), str(i["id"])))
    before = _loads(pool, people)
    after = dict(before)
    folded: dict[tuple[str | None, str, str], list[str]] = defaultdict(list)
    for i in pool:
        m = str(i.get("module"))
        value = slice_of(i.get("record_key"), slice_kind.get(m, "none"))
        to = assignments.get((m, value or "*")) or assignments.get((m, "*"))
        frm = i.get("assigned_to")
        if not to or to not in after or to == frm:
            continue
        folded[(frm, to, m)].append(i["id"])
        after[to] += 1
        if frm in after:
            after[frm] -= 1
    rows = [{"from": f, "to": t, "module": m, "count": len(ids), "issue_ids": ids}
            for (f, t, m), ids in sorted(folded.items(), key=lambda kv: (kv[0][0] or "", kv[0][1], kv[0][2]))]
    return {"by": "slice", "before": before, "after": after, "moves": rows, "moved": sum(r["count"] for r in rows)}

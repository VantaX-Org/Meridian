"""Steward assignment template and the object relationship map (migration 105).

Source: "Steward assignment and related objects", version 1 (sap/steward_template.yaml, sap/object_relationships.yaml).

  relationships()      the map, mirrored so each pair agrees from both sides (upstream <-> downstream)
  related()            one object's related objects with their relation kind and fixing-order tier
  fix_hint()           "Fix Business partner first: 3,640 upstream failures" for the Work ledger, or None
  default_template()   the template a tenant starts from
  validate_template()  what is wrong with an edited template, as sentences
  plan_apply()         the owner and steward assignments a template creates for the active slices (the dry-run diff)
  gaps()               the audit check "every object has one owner and at least one steward per active slice"
  slice_of()           the slice value of a record key (BUKRS, WERKS, VKORG, EKORG)

Pure: the routes read and write (api/routes/stewardship.py).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
SLICES: dict[str, str | None] = {"company_code": "BUKRS", "plant": "WERKS", "sales_org": "VKORG",
                                    "purchasing_org": "EKORG", "none": None}
SLICE_WORD = {"company_code": "company code", "plant": "plant", "sales_org": "sales organisation",
              "purchasing_org": "purchasing organisation", "none": "whole object"}
RELATIONS = ("upstream", "downstream", "shared-reference")
_MIRROR = {"upstream": "downstream", "downstream": "upstream", "shared-reference": "shared-reference"}
ALL = "*"


@lru_cache(maxsize=1)
def _raw_map() -> dict[str, Any]:
    return yaml.safe_load((ROOT / "sap" / "object_relationships.yaml").read_text()) or {}


@lru_cache(maxsize=1)
def relationships() -> dict[str, dict[str, str]]:
    """module -> {related module: relation from this module's side}. A pair declared twice keeps the first."""
    out: dict[str, dict[str, str]] = {}
    for a, rel in (_raw_map().get("related") or {}).items():
        for b, kind in (rel or {}).items():
            if kind not in RELATIONS:
                raise ValueError(f"object_relationships.yaml: {a} -> {b}: unknown relation {kind}")
            out.setdefault(a, {}).setdefault(b, kind)
            out.setdefault(b, {}).setdefault(a, _MIRROR[kind])
    return out


def tier(module: str) -> int | None:
    t = (_raw_map().get("tiers") or {}).get(module)
    return int(t) if t is not None else None


def related(module: str) -> list[dict[str, Any]]:
    """[{module, relation, tier}] upstream first, then shared-reference, then downstream; by tier, then id."""
    order = {"upstream": 0, "shared-reference": 1, "downstream": 2}
    rows = [{"module": m, "relation": k, "tier": tier(m)} for m, k in relationships().get(module, {}).items()]
    return sorted(rows, key=lambda r: (order[r["relation"]], r["tier"] or 9, r["module"]))


def fix_hint(module: str, failures: Mapping[str, int], label: Any = None) -> dict[str, Any] | None:
    """The upstream object with the most open critical failures, when there is one:
    {module, failures, sentence}. ``label`` maps a module id to its name (default: the id)."""
    name = label or (lambda m: m)
    ups = [(m, int(failures.get(m) or 0)) for m, k in relationships().get(module, {}).items() if k == "upstream"]
    ups = [u for u in ups if u[1] > 0]
    if not ups:
        return None
    m, n = min(ups, key=lambda u: (-u[1], u[0]))
    return {"module": m, "failures": n, "sentence": f"Fix {name(m)} first: {n:,} upstream failures"}


@lru_cache(maxsize=1)
def _default() -> dict[str, Any]:
    return yaml.safe_load((ROOT / "sap" / "steward_template.yaml").read_text()) or {}


def default_template() -> dict[str, Any]:
    import copy

    return copy.deepcopy(_default())


def validate_template(t: Any) -> list[str]:
    if not isinstance(t, Mapping) or not isinstance(t.get("objects"), Mapping):
        return ["The template needs an objects section."]
    errors = []
    for module, o in t["objects"].items():
        if not isinstance(o, Mapping):
            errors.append(f"{module}: expected owner_role, slice and stewards.")
            continue
        if not str(o.get("owner_role") or "").strip():
            errors.append(f"{module}: name the owner role.")
        if o.get("slice", "none") not in SLICES:
            errors.append(f"{module}: the slice must be one of {', '.join(SLICES)}.")
        ss = o.get("slice_stewards")
        if ss is not None and not isinstance(ss, Mapping):
            errors.append(f"{module}: slice_stewards maps a slice value to a person.")
    return errors


def slice_of(record_key: str | None, kind: str) -> str | None:
    field = SLICES.get(kind)
    if not field:
        return None
    parts = dict(p.split("=", 1) for p in (record_key or "").split("|") if "=" in p)
    return parts.get(field)


def _values(kind: str, active: Mapping[str, list[str]]) -> list[str]:
    return [ALL] if kind == "none" or not active.get(kind) else sorted(set(active[kind]))


def plan_apply(template: Mapping[str, Any], active: Mapping[str, list[str]], owners: Mapping[str, str | None],
               stewards: Mapping[tuple[str, str, str], str | None],
               modules: Iterable[str] | None = None) -> dict[str, Any]:
    """What Apply writes: {owners: [...], stewards: [...], totals}. Each row has change add|change|same and the
    before and after user ids. An object with nobody named in the template writes nothing (and stays a gap)."""
    keep = set(modules) if modules is not None else None
    own_rows, st_rows = [], []
    for module, o in sorted((template.get("objects") or {}).items()):
        if keep is not None and module not in keep:
            continue
        who = o.get("owner_user_id")
        if who:
            before = owners.get(module)
            own_rows.append({"module": module, "change": "same" if before == who else "change" if before else "add",
                             "before": before, "after": who})
        kind = o.get("slice", "none")
        per = o.get("slice_stewards") or {}
        for value in _values(kind, active):
            after = per.get(value) or o.get("steward_user_id")
            if not after:
                continue
            before = stewards.get((module, kind, value))
            st_rows.append({"module": module, "slice_kind": kind, "slice_value": value, "after": after, "before": before,
                            "change": "same" if before == after else "change" if before else "add"})
    totals = {c: sum(1 for r in own_rows + st_rows if r["change"] == c) for c in ("add", "change", "same")}
    return {"owners": own_rows, "stewards": st_rows, "totals": totals}


def gaps(objects: Iterable[str], template: Mapping[str, Any], active: Mapping[str, list[str]],
         owners: Mapping[str, str | None], stewards: Mapping[tuple[str, str, str], str | None]) -> list[dict[str, Any]]:
    """Every missing owner and every active slice of an object with no steward. A steward on ``*`` covers every
    slice of the object."""
    out = []
    tmpl = template.get("objects") or {}
    for module in sorted(set(objects)):
        if not owners.get(module):
            out.append({"module": module, "gap": "no_owner", "slice_kind": None, "slice_value": None,
                        "sentence": "No owner"})
        kind = (tmpl.get(module) or {}).get("slice", "none")
        whole = any(v for (m, _k, val), v in stewards.items() if m == module and val == ALL)
        for value in _values(kind, active):
            if whole or stewards.get((module, kind, value)):
                continue
            out.append({"module": module, "gap": "no_steward", "slice_kind": kind, "slice_value": value,
                        "sentence": "No steward" if value == ALL else f"No steward for {SLICE_WORD[kind]} {value}"})
    return out

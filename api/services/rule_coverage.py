"""Rule coverage: where the catalogue is deep and where it is thin.

Pure functions over (tenant rule rows, shipped YAML rules, latest finding per rule).
The routes in api/routes/rule_depth.py do the tenant-scoped queries and call these,
so the module x dimension matrix and the per-view table can never drift apart.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import yaml

from api.services.tenant_seed import raw_rules

DIMENSIONS = ("completeness", "consistency", "validity", "accuracy", "uniqueness",
              "timeliness", "lifecycle", "freshness")
THIN = 5  # a module x dimension cell with 1..4 rules

_VIEWS_DIR = Path(__file__).resolve().parents[2] / "checks" / "views"


@lru_cache(maxsize=1)
def shipped() -> dict[tuple[str, str], dict]:
    """(rule id, module) -> shipped YAML rule plus its `category`."""
    return {(str(r["id"]), module): {**r, "category": category} for category, _, module, r in raw_rules()}


@lru_cache(maxsize=None)
def view_map(module: str) -> Optional[dict]:
    path = _VIEWS_DIR / f"{module}.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else None


def rule_code(name: str) -> str:
    return name.split(":", 1)[0]


def _condition(conditions: Any) -> dict:
    if isinstance(conditions, str):
        conditions = json.loads(conditions)
    if isinstance(conditions, list):
        conditions = conditions[0] if conditions else {}
    return conditions if isinstance(conditions, dict) else {}


def describe(row: dict) -> dict:
    """Shipped metadata for a tenant rule row; mined and custom rows fall back to their own conditions."""
    code, module = rule_code(row["name"]), row["module"]
    y = shipped().get((code, module))
    if y:
        return {"check_id": code, "module": module, "field": y.get("field"), "dimension": y.get("dimension"),
                "check_class": y.get("check_class"), "authority": y.get("rule_authority"),
                "severity": y.get("severity"), "message": y.get("message")}
    c = _condition(row.get("conditions"))
    return {"check_id": code, "module": module, "field": c.get("field"), "dimension": c.get("dimension"),
            "check_class": c.get("check_class"), "authority": "customer_configured",
            "severity": row.get("severity"), "message": row["name"].split(":", 1)[-1].strip()}


def _keep(meta: dict, row: dict, system: Optional[str], authority: Optional[str],
          check_class: Optional[str], enabled: Optional[bool]) -> bool:
    return ((system is None or row["category"] == system)
            and (authority is None or meta["authority"] == authority)
            and (check_class is None or meta["check_class"] == check_class)
            and (enabled is None or row["enabled"] == enabled))


def _object(module: str, metas: list[tuple[dict, bool]]) -> dict:
    by_dim = Counter(m["dimension"] for m, _ in metas)
    return {"module": module, "by_dimension": {d: by_dim.get(d, 0) for d in DIMENSIONS},
            "total": len(metas), "never_run": sum(1 for _, never in metas if never)}


def coverage(rows: list[dict], last_runs: dict[tuple[str, str], Optional[float]], *,
             system: Optional[str] = None, authority: Optional[str] = None,
             check_class: Optional[str] = None, enabled: Optional[bool] = None) -> dict:
    """rows: tenant rules (name, module, category, enabled, source, severity, conditions).
    last_runs: (rule id, module) -> latest pass rate, for every rule with a finding."""
    by_module: dict[str, list[tuple[dict, bool]]] = defaultdict(list)
    classes: Counter = Counter()
    enabled_n = customer_n = 0
    for row in rows:
        meta = describe(row)
        if not _keep(meta, row, system, authority, check_class, enabled):
            continue
        never = row["enabled"] and (meta["check_id"], meta["module"]) not in last_runs
        by_module[row["module"]].append((meta, never))
        classes[meta["check_class"]] += 1
        if row["enabled"]:
            enabled_n += 1
            customer_n += row["source"] != "yaml"
    objects = sorted((_object(m, v) for m, v in by_module.items()), key=lambda o: (-o["total"], o["module"]))
    return {
        "objects": objects,
        "dimensions": list(DIMENSIONS),
        "check_classes": [{"check_class": c, "count": n} for c, n in sorted(classes.items(), key=lambda x: (-x[1], str(x[0])))],
        "totals": {
            "shipped": len(shipped()), "rules": sum(o["total"] for o in objects), "enabled": enabled_n,
            "customer": customer_n, "objects": len(objects),
            "thin_cells": sum(0 < n < THIN for o in objects for n in o["by_dimension"].values()),
            "never_run": sum(o["never_run"] for o in objects),
        },
    }


def _table(field: Optional[str]) -> Optional[str]:
    return field.split(".", 1)[0] if field and "." in field else None


def module_views(module: str, rows: list[dict], last_runs: dict[tuple[str, str], Optional[float]], *,
                 enabled: Optional[bool] = None) -> dict:
    """One module: its matrix row plus, where a view map exists, rules per view and table."""
    metas = []
    for row in rows:
        meta = describe(row)
        if row["module"] == module and _keep(meta, row, None, None, None, enabled):
            metas.append((meta, row["enabled"] and (meta["check_id"], module) not in last_runs))
    vm = view_map(module)
    views: list[dict] = []
    dim_by_view: dict[str, dict[str, int]] = {}
    if vm:
        assigned = {rid: v["id"] for v in vm["views"] for rid in v["rules"]}
        labels = {v["id"]: v["label"] for v in vm["views"]}
        order = [v["id"] for v in vm["views"]]
        groups: dict[str, list[dict]] = defaultdict(list)
        for meta, _ in metas:
            view = assigned.get(meta["check_id"]) or vm["default_view_by_table"].get(_table(meta["field"]) or "")
            if view is None:
                view = "other"
                labels["other"] = "Other"
                if "other" not in order:
                    order.append("other")
            groups[view].append(meta)
        for vid in order:
            ms = groups.get(vid, [])
            tables = Counter(t for m in ms if (t := _table(m["field"])))
            by_dim = Counter(m["dimension"] for m in ms)
            dim_by_view[vid] = {d: by_dim.get(d, 0) for d in DIMENSIONS}
            views.append({
                "view": vid, "label": labels[vid], "total": len(ms),
                "tables": [{"table": t, "count": n} for t, n in sorted(tables.items(), key=lambda x: (-x[1], x[0]))],
                "rules": [{"check_id": m["check_id"], "message": m["message"], "check_class": m["check_class"],
                           "severity": m["severity"], "dimension": m["dimension"], "field": m["field"],
                           "last_pass_rate": last_runs.get((m["check_id"], module))}
                          for m in sorted(ms, key=lambda m: m["check_id"])],
            })
    obj = _object(module, metas)
    return {
        "module": module, "has_view_map": bool(vm), "object": obj,
        "views": views, "dimension_by_view": dim_by_view,
        "totals": {"rules": obj["total"], "never_run": obj["never_run"],
                   "views": sum(v["total"] > 0 for v in views),
                   "views_total": len(views),
                   "tables": len({t["table"] for v in views for t in v["tables"]})},
    }

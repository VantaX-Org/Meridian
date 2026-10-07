"""Configuration load, per area and per system: progress, found counts, status, and where config lives.

Areas come from ``sap/config_areas.yaml``; object labels from the DDIC (ABAP) or the SPRO registry (cloud);
IMG paths from ``sap/spro_paths.yaml``. Pure functions over plain dicts (the stored ``config_loads.objects``).
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import yaml

_YAML = Path(__file__).resolve().parents[2] / "sap" / "config_areas.yaml"
NOT_AVAILABLE = "not_available"
OTHER = {"area": "other", "label": "Other"}


@lru_cache(maxsize=1)
def _doc() -> dict[str, dict]:
    return (yaml.safe_load(_YAML.read_text()) or {}).get("systems") or {}


def area_defs(system_type: str) -> list[dict]:
    return _doc().get(system_type, {}).get("areas") or []


def no_config_api(system_type: str) -> bool:
    """System types Meridian cannot read any configuration from."""
    from sap.config_loader import _NO_CONFIG_API

    return system_type in _NO_CONFIG_API or system_type not in _doc()


@lru_cache(maxsize=4096)
def object_label(system_type: str, obj: str) -> Optional[str]:
    """Plain name of a config object: DDIC table description (ABAP) or the SPRO registry description."""
    from sap.config_loader import ABAP_TYPES
    from sap.spro_tables import SPRO_REGISTRY

    if system_type in ABAP_TYPES:
        try:
            from sap.ddic import dictionary_for_system

            t = dictionary_for_system(system_type).table(obj)
            if t is not None and t.description:
                return t.description.strip('"')
        except Exception:
            pass
    for entries in SPRO_REGISTRY.values():
        for e in entries:
            if e["table"] == obj:
                return e["description"]
    return None


def _cause(state: str, detail: str, system_type: str) -> Optional[str]:
    """Why an object did not load: auth | timeout | error (failed), not_in_release | not_exposed (not available)."""
    from sap.config_loader import ABAP_TYPES

    if state == NOT_AVAILABLE:
        return "not_in_release" if system_type in ABAP_TYPES and "does not exist" in detail else "not_exposed"
    if state != "failed":
        return None
    if re.search(r"NOT_AUTHORI|authori[sz]|S_TABU|\b403\b|forbidden", detail, re.I):
        return "auth"
    if re.search(r"time[d ]?out|timed out", detail, re.I):
        return "timeout"
    return "error"


def build_areas(system_type: str, objects: Optional[list[dict]] = None, done: Optional[set[str]] = None,
                current: Optional[str] = None) -> list[dict[str, Any]]:
    """Areas of one load. ``objects`` = stored object states of a finished load; while a load runs, pass
    ``done`` (objects read so far) and ``current`` (the one being read) instead."""
    from sap.config_loader import planned_objects

    states = {o["object"]: o for o in objects or []}
    wildcard = states.get("*", {}).get("state") == NOT_AVAILABLE
    planned = [o for o in dict.fromkeys([*planned_objects(system_type), *states]) if o != "*"]
    defs = area_defs(system_type)
    owner = {o: d["area"] for d in defs for o in d["objects"]}
    groups: dict[str, list[str]] = {d["area"]: [] for d in defs}
    for o in planned:
        groups.setdefault(owner.get(o, OTHER["area"]), []).append(o)
    labels = {d["area"]: d["label"] for d in defs} | {OTHER["area"]: OTHER["label"]}

    out = []
    for area, objs in groups.items():
        row: dict[str, Any] = {"area": area, "label": labels[area], "tables_total": len(objs), "objects": []}
        if wildcard or not objs:
            row.update(status=NOT_AVAILABLE, tables_total=0, tables_done=0)
        elif objects is None:  # running
            n = sum(1 for o in objs if o in (done or set()))
            row.update(tables_done=n, status="loaded" if n == len(objs)
                       else "running" if n or current in objs else "waiting")
        else:
            rows = []
            for o in objs:
                s = states.get(o) or {"state": "failed", "rows": 0, "detail": "not read"}
                detail = s.get("detail") or ""
                rows.append({"object": o, "label": object_label(system_type, o), "state": s["state"],
                             "rows": int(s.get("rows") or 0), "detail": detail,
                             "cause": _cause(s["state"], detail, system_type)})
            st = {r["state"] for r in rows}
            row.update(tables_done=len(rows), objects=rows,
                       status="failed" if "failed" in st else NOT_AVAILABLE if st == {NOT_AVAILABLE} else "loaded")
        out.append(row)
    return out


def system_status(system_type: str, load: Optional[dict], job_areas: Optional[list[dict]] = None) -> dict[str, Any]:
    """Configuration status of one system: loaded | with_gaps | loading | not_loaded | failed | not_available.
    ``load`` = latest config_loads row as {status, objects, error}; ``job_areas`` = live areas of a running job."""
    if no_config_api(system_type):
        status, areas = NOT_AVAILABLE, build_areas(system_type, [{"object": "*", "state": NOT_AVAILABLE}])
    elif load is None:
        status, areas = "not_loaded", []
    elif load["status"] in ("running", "queued"):
        status, areas = "loading", job_areas or build_areas(system_type, done=set())
    elif load["status"] == "failed":
        status, areas = "failed", []
    else:
        areas = build_areas(system_type, load.get("objects") or [])
        status = "with_gaps" if any(a["status"] == "failed" for a in areas) else "loaded"
    counted = [a for a in areas if a["status"] != NOT_AVAILABLE]
    return {"status": status, "areas": areas, "areas_total": len(counted),
            "areas_loaded": sum(1 for a in counted if a["status"] == "loaded"),
            "current_area": next((a["label"] for a in areas if a["status"] == "running"), None)
            if status == "loading" else None}


def configured_in(system_type: str, objects: list[str]) -> list[dict[str, Any]]:
    """Where these config objects are maintained on this system type: IMG path + transaction (ECC, S/4HANA
    on-premise), the admin path (cloud), nothing when unknown. One entry per distinct location."""
    from sap.spro_paths import ABAP_ONPREM, spro_paths

    out: dict[tuple, dict] = {}
    if system_type in ABAP_ONPREM:
        for o in objects:
            p = spro_paths().get(o)
            if p:
                out.setdefault((p["path"], p["tcode"]), {"object": o, "kind": "img", "path": p["path"],
                                                         "tcode": p["tcode"]})
        return list(out.values())
    sys = _doc().get(system_type) or {}
    by_obj = {o: d.get("admin_path") for d in sys.get("areas") or [] for o in d["objects"]}
    for o in objects:
        path = by_obj.get(o) or sys.get("admin_path")
        if path:
            out.setdefault((path,), {"object": o if o in by_obj else None, "kind": "admin", "path": path,
                                     "tcode": None})
    return list(out.values())

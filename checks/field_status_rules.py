"""Rules generated from the source system's field-status customizing.

For every field an account group marks required (or suppressed) — resolved by
sap/field_status_config.py from T077K/T077D + TMODO/TMODU of THIS system —
one rule over the records of those account groups. Present only when the
system's customizing was read live; otherwise no rule is generated (the
SAP-standard null checks still run).
"""

from __future__ import annotations

from sqlalchemy import text

from sap.field_status_config import CONFIG_TABLES, Resolution, resolve_all


def load_config(session, system_id: str | None) -> dict[str, list[dict]]:
    if session is None or not system_id:
        return {}
    rows = session.execute(
        text("SELECT config_table, config_data FROM config_snapshots WHERE system_id = :sid "
             "AND source = 'live' AND config_table = ANY(:tables)"),
        {"sid": str(system_id), "tables": list(CONFIG_TABLES)},
    ).fetchall()
    return {t: list(d or []) for t, d in rows}


def generate(resolutions: list[Resolution], modules: list[str]) -> list[dict]:
    rules = []
    for res in resolutions:
        seg = res.segment
        if res.fauna is None or seg.module not in modules:
            continue
        by_field: dict[tuple[str, str], list[str]] = {}
        for group, statuses in res.groups.items():
            for col, st in statuses.items():
                by_field.setdefault((col, st), []).append(group)
        for (col, st), groups in sorted(by_field.items()):
            fld = col.split(".", 1)[1]
            rules.append({
                "id": f"FS-{seg.record_table}-{fld}-{'REQ' if st == 'required' else 'SUP'}",
                "module": seg.module,
                "check_class": "field_status_check",
                "field": col,
                "group_field": seg.group_source,
                "groups": sorted(groups),
                "kind": st,
                "grain": seg.record_table,
                "severity": "high" if st == "required" else "low",
                "dimension": "completeness" if st == "required" else "consistency",
                "config_table": seg.config_table,
                "fauna": res.fauna,
                "message": (f"{col} is required for account group(s) {', '.join(sorted(groups))} "
                            f"by this system's {seg.label} field status ({seg.config_table})")
                if st == "required" else
                (f"{col} is populated although account group(s) {', '.join(sorted(groups))} "
                 f"suppress it ({seg.config_table})"),
            })
    return rules


def generate_material(material: dict[str, dict[str, str]], modules: list[str]) -> list[dict]:
    """Rules from the material master field selection (sap/field_status_config.resolve_material)."""
    if "material_master" not in modules:
        return []
    rules = []
    for col, by_group in sorted(material.items()):
        for st in ("required", "suppressed"):
            groups = sorted(g for g, s in by_group.items() if s == st)
            if not groups:
                continue
            label = ", ".join(g.replace("|", "/") for g in groups[:6]) + (" …" if len(groups) > 6 else "")
            rules.append({
                "id": f"FS-{col.replace('.', '-')}-{'REQ' if st == 'required' else 'SUP'}",
                "module": "material_master", "check_class": "field_status_check", "field": col,
                "group_field": ["MARA.MTART", "MARA.MBRSH"], "groups": groups, "kind": st, "grain": "MARA",
                "severity": "high" if st == "required" else "low",
                "dimension": "completeness" if st == "required" else "consistency",
                "config_table": "T130A/T130F", "fauna": "material field selection",
                "message": (f"{col} is required for material type / industry sector {label} by this system's "
                            f"material master field selection") if st == "required" else
                           (f"{col} is populated although material type / industry sector {label} hide it"),
            })
    return rules


def material_fields(material: dict[str, dict[str, str]]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {"MARA": {"MTART", "MBRSH"}} if material else {}
    for col in material:
        t, f = col.split(".", 1)
        out.setdefault(t, set()).add(f)
    return out


def extra_fields(resolutions: list[Resolution]) -> dict[str, set[str]]:
    """Fields the extraction must read so the generated rules can be evaluated."""
    out: dict[str, set[str]] = {}
    for res in resolutions:
        if res.fauna is None:
            continue
        for cols in res.positions.values():
            for c in cols:
                t, f = c.split(".", 1)
                out.setdefault(t, set()).add(f)
        t, f = res.segment.group_source.split(".", 1)
        out.setdefault(t, set()).add(f)
    return out

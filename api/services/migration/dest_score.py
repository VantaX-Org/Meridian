"""Projected destination quality score: the source data's DQS in the target shape.

The source version's own findings are carried over for every rule whose fields survive the
migration field mappings (re-pointed at the target field they land in); rules on fields that
are not migrated drop out. The target system's rule packs (Business Partner, S/4HANA readiness,
S/4HANA master data) run on the target-shape frames built from ``engine.analyze``'s mapped values,
and every per-record migration gap (truncation, value mapping, target mandatory, key collision,
S/4 load simulation, ...) becomes one scored result per gap type and field. All of it goes through
``scoring.score_module``, the same formula as the source DQS, so the two scores are comparable.
Deterministic only.
"""

from __future__ import annotations

import pandas as pd

from api.services.migration.engine import Gap, Mapping
from api.services.scoring import score_module
from checks.base import CheckResult, pass_rate_of
from checks.frames import TableFrames
from sap.ddic import Dictionary

# rule packs judging data fit for an S/4HANA target (sap/ddic.RELEASE_FOR_SYSTEM targets)
TARGET_PACKS = ("business_partner", "s4_readiness", "s4hc_master_data")
S4_TARGETS = {"s4hana", "s4hana_onprem", "s4hana_cloud"}

GAP_DIMENSION = {
    "target_mandatory": "completeness", "key_missing": "completeness", "value_unmapped": "completeness",
    "field_status_blank_in_target": "completeness",
    "key_collision": "uniqueness", "target_key_exists": "uniqueness",
}  # every other per-record gap (truncation, conversion, domain, check table, S/4 load) is validity
_SEV = {"critical": 0, "high": 1, "medium": 2, "low": 3}
TOP_CONTRIBUTORS = 10


def target_frames(target_values: dict[tuple[str, str], dict[str, pd.Series]], target_dict: Dictionary) -> TableFrames:
    """One frame per target table with ``TABLE.FIELD`` columns; source tables feeding the same target stack."""
    parts: dict[str, list[pd.DataFrame]] = {}
    for (_, t_table), fields in target_values.items():
        parts.setdefault(t_table, []).append(pd.DataFrame({f"{t_table}.{f}": v for f, v in fields.items()}))
    return TableFrames({t: pd.concat(p, ignore_index=True) for t, p in parts.items()}, target_dict)


def surviving(mappings: list[Mapping], target_dict: Dictionary) -> dict[str, str]:
    """Source column -> the target column it lands in (its identity target first) for every migrated field."""
    out: dict[str, str] = {}
    for m in sorted(mappings, key=lambda m: m.target != m.source):
        if not m.target or m.source in out:
            continue
        t_table, t_name = m.target.split(".", 1)
        tt = target_dict.table(t_table)
        if target_dict.field(t_table, t_name) is None or (tt is not None and tt.obsolete_in == "s4hana"):
            continue
        out[m.source] = m.target
    return out


def gap_results(module: str, gaps: list[Gap], table_records: dict[str, int]) -> tuple[list[CheckResult], dict[str, str]]:
    """Per-record gaps as check results: one per (gap type or S4L rule, field), affected = distinct records."""
    groups: dict[str, dict] = {}
    for g in gaps:
        if g.record_key is None or not g.source_table:
            continue  # structural gaps (unmapped field, missing target field) have no record grain
        rule = g.detail.split(" ", 1)[0] if g.gap_type == "s4_load" else g.gap_type
        field = g.target_field or g.source_field or ""
        if g.gap_type == "s4_load" and g.target_table and g.target_field:
            field = f"{g.target_table}.{g.target_field}"
        cid = f"{rule}:{field}" if field else rule
        e = groups.setdefault(cid, {"keys": set(), "sev": g.severity, "type": g.gap_type, "field": field,
                                    "table": g.source_table, "detail": g.detail})
        e["keys"].add(g.record_key)
        if _SEV.get(g.severity, 3) < _SEV.get(e["sev"], 3):
            e["sev"] = g.severity
    out, details = [], {}
    for cid, e in groups.items():
        total = max(table_records.get(e["table"], 0), len(e["keys"]))
        out.append(CheckResult(
            check_id=cid, module=module, field=e["field"], severity=e["sev"],
            dimension=GAP_DIMENSION.get(e["type"], "validity"), passed=False, affected_count=len(e["keys"]),
            total_count=total, pass_rate=pass_rate_of(total, len(e["keys"])), message=e["detail"], details={},
            grain=e["table"]))
        details[cid] = e["detail"]
    return out, details


def project(module: str, *, target_type: str, target_values: dict[tuple[str, str], dict[str, pd.Series]],
            mappings: list[Mapping], gaps: list[Gap], source_results: list[CheckResult],
            table_records: dict[str, int], source_tables: list[str], source_dict: Dictionary,
            target_dict: Dictionary, tenant_id: str, raw_cfg: dict | None) -> dict:
    """The module's projected destination DQS and the rules that move it away from the source DQS."""
    from checks.runner import module_rules, rule_columns, run_checks

    rules = {r.get("id"): r for r in module_rules(module)}
    survive = surviving(mappings, target_dict)
    src_tables = set(source_tables)

    def lands(col: str) -> bool:
        return col.split(".", 1)[0] not in src_tables or col.split(".", 1)[-1] in ("MANDT", "CLIENT") or col in survive

    carried, dropped = [], []
    for r in source_results:
        rule = rules.get(r.check_id)
        try:
            cols = rule_columns(rule) if rule else [r.field]
        except Exception:
            cols = [r.field]
        cols = [c for c in cols if c]
        if all(lands(c) for c in cols):
            carried.append(r.model_copy(update={"field": survive.get(r.field, r.field)}))
        else:
            dropped.append(r)

    texts: dict[str, str] = {k: (v or {}).get("message", "") for k, v in rules.items()}
    target: list[CheckResult] = []
    packs_unlicensed: list[str] = []
    if target_type in S4_TARGETS and target_values:
        from api.middleware.licence import licensed_modules_of
        packs = [p for p in TARGET_PACKS if p != module]
        held = licensed_modules_of(packs)
        packs_unlicensed = [p for p in packs if p not in held]
        frames = target_frames(target_values, target_dict)
        carried_ids = {r.check_id for r in carried}
        for pack in held:
            texts.update({r.get("id"): r.get("message", "") for r in module_rules(pack)})
            # ponytail: re-runs whole packs on the module's target frames; rules on absent tables return
            # None cheaply. Restrict to the packs' columns present in the frames if a large run gets slow.
            target += [x.model_copy(update={"module": module}) for x in run_checks(pack, frames, tenant_id)
                       if x.check_id not in carried_ids]
    gap_res, gap_text = gap_results(module, gaps, table_records)
    texts.update(gap_text)

    cfg = raw_cfg or {}
    dest = score_module(carried + target + gap_res, cfg, module=module)
    src = score_module(source_results, cfg, module=module)

    def describe(field: str) -> str | None:
        t, _, f = field.partition(".")
        fd = target_dict.field(t, f) or source_dict.field(t, f) if f else None
        return fd.description if fd is not None else None

    rows = []
    for kind, results in (("dropped", dropped), ("target", target), ("gap", gap_res)):
        for r in results:
            if r.error or (r.passed and kind != "dropped") or (kind == "dropped" and r.passed):
                continue
            before = r.pass_rate if kind == "dropped" else None
            rows.append({
                "check_id": r.check_id, "kind": kind, "severity": r.severity, "dimension": r.dimension,
                "description": texts.get(r.check_id) or r.message or None,
                "field": r.field or None, "field_description": describe(r.field) if r.field else None,
                "source_affected": r.affected_count if kind == "dropped" else None,
                "dest_affected": None if kind == "dropped" else r.affected_count,
                "total": r.total_count,
                # pass-rate shortfall the rule adds to (+) or removes from (-) the destination
                "impact": round((r.pass_rate - 100.0) if before is None else (100.0 - before), 2),
            })
    rows.sort(key=lambda x: (_SEV.get(x["severity"], 3), -abs(x["impact"]), x["check_id"]))
    return {
        "composite_score": dest.composite_score,
        "raw_score": dest.raw_score,
        "dimension_scores": dest.dimension_scores,
        "critical_breaches": dest.critical_breaches,
        "source_score": src.composite_score,
        "rules_carried": len(carried),
        "rules_dropped": len(dropped),
        "rules_target": len(target),
        "gap_rules": len(gap_res),
        # target packs the licence does not cover: not run, so the projection leaves their rules out
        "packs_unlicensed": packs_unlicensed,
        "contributors": rows[:TOP_CONTRIBUTORS],
    }

"""Aletheia rule promotion: evidence-based, per-tenant enablement of the DDIC-derived rules.

The ``*.generated.yaml`` packs ship every rule switched off (mechanically sound, not validated
against any one customer). This service dry-runs each of them against the tenant's latest
extraction and sorts it into a bucket:

  promote          populated enough, failure rate within the threshold, enough records
  review           populated, but the failure rate is above the threshold
  skip_unused      the field is not extracted, is (nearly) empty, or has too few records
  needs_value_set  a value-list rule whose reference set is not in the system's live config
                   snapshots; judged against SAP's standard list it would flag every customer
                   Z-value, so it is never enabled automatically

Everything is deterministic and local: no LLM, and no record data leaves the process. Evidence
carries counts, rates and record KEYS only (never field values).

Enabling writes a tenant ``rules`` row with ``source='promotion'``; ``checks.overrides.load_overrides``
honours it for generated ids only. Revert removes it. Every enable and revert is audited.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import yaml
from sqlalchemy import text

from checks.base import is_blank
from checks.runner import GENERATED_SUFFIX, RULES_DIR, _with_reference, run_rule

BUCKETS = ("promote", "review", "skip_unused", "needs_value_set")
VALUE_LIST = ("referential_check", "domain_value_check")
SETTING = "rule_promotion.thresholds"
# ponytail: defaults, overridable per tenant through the `rule_promotion.thresholds` tenant setting.
# populated >= 20% of the table's records, failure rate <= 2%, at least 100 populated records,
# and a promoted rule drifts when its failure rate rises 5 points over its promotion baseline.
DEFAULTS = {"min_populated_pct": 20.0, "max_failure_rate": 0.02, "min_records": 100, "drift_delta": 0.05}
SAMPLE_KEYS = 5
_MODULE = re.compile(r"^[a-z0-9_]{1,64}$")


# ---------------------------------------------------------------- rule packs

def generated_modules() -> dict[str, Path]:
    """module -> its ``<module>.generated.yaml`` sidecar."""
    return {p.name[: -len(GENERATED_SUFFIX)]: p for p in sorted(RULES_DIR.glob(f"*/*{GENERATED_SUFFIX}"))}


def generated_rules(module: str) -> list[dict]:
    """The module's generated rules (all ship disabled)."""
    path = generated_modules().get(module)
    if path is None:
        raise KeyError(module)
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("rules") or []


def valid_module(module: str) -> bool:
    return bool(_MODULE.match(module)) and module in generated_modules()


# ---------------------------------------------------------------- classifier

def live_references(rows) -> dict[str, set[str]]:
    """``TABLE.COL`` -> values, from ``(config_table, config_data)`` live snapshot rows
    (the same shape workers/tasks/run_checks._live_reference_values builds)."""
    out: dict[str, set[str]] = {}
    for table, data in rows:
        for rec in data or []:
            for col, val in rec.items():
                if val not in (None, ""):
                    out.setdefault(f"{table}.{col}", set()).add(str(val).strip())
    return out


def _populated(frames, field: str) -> tuple[int, int] | None:
    """(populated, total) records of the field's table, or None when it was not extracted."""
    try:
        got = frames.frame_for([field])
    except Exception:
        return None
    if got is None or field not in got[0].columns:
        return None
    col = got[0][field]
    return int((~is_blank(col)).sum()), len(col)


def classify(rules: list[dict], frames, dictionary, refs: dict[str, set[str]], th: dict) -> list[dict]:
    """One evidence row per rule. ``frames`` may be None (module not extracted)."""
    out = []
    for rule in rules:
        field = rule.get("field") or ""
        fd = dictionary.resolve(field) if field else None
        row = {"id": rule["id"], "field": field, "field_text": fd.description if fd else "",
               "check_class": rule.get("check_class", ""), "severity": rule.get("severity", "medium"),
               "message": rule.get("message", ""), "reference_key": None, "bucket": "skip_unused",
               "reason": "not_extracted", "failing": 0, "total": 0, "rate": None, "populated_pct": None,
               "sample_keys": []}
        out.append(row)
        if row["check_class"] in VALUE_LIST:
            key = _with_reference(rule, dictionary, {})["_reference_key"]
            row["reference_key"] = key
            # ponytail: a check table that is a data table (not config) is never in the live
            # config snapshots, so it lands here too; promote those by hand with a reason.
            if not key or key not in refs:
                row.update(bucket="needs_value_set", reason="no_value_set")
                continue
        if frames is None:
            continue
        pop = _populated(frames, field)
        if pop is None:
            continue
        populated, records = pop
        row["populated_pct"] = round(100.0 * populated / records, 2) if records else 0.0
        if not populated or row["populated_pct"] < th["min_populated_pct"]:
            row["reason"] = "empty" if not populated else "sparse"
            continue
        try:
            _, res = run_rule({**rule, "enabled": True}, frames, refs)
        except Exception:
            res = None
        if res is None or res.error:
            row["reason"] = "not_evaluable"
            continue
        row.update(failing=int(res.affected_count), total=int(res.total_count),
                   sample_keys=[str(k) for k in list(res.failing_record_keys or [])[:SAMPLE_KEYS]])
        if res.total_count < th["min_records"]:
            row["reason"] = "few_records"
            continue
        row["rate"] = round(res.affected_count / res.total_count, 6)
        if row["rate"] <= th["max_failure_rate"]:
            row.update(bucket="promote", reason="within_threshold")
        else:
            row.update(bucket="review", reason="failure_rate_high")
    return out


def counts(rows: list[dict]) -> dict[str, int]:
    return {b: sum(1 for r in rows if r["bucket"] == b) for b in BUCKETS}


def drift(promoted: dict[str, dict], current: list[dict], th: dict, version_id: str | None) -> list[dict]:
    """Promoted rules whose failure rate rose by ``drift_delta`` over their promotion baseline.

    Compared only against a run other than the one that promoted the rule."""
    flags = []
    for r in current:
        base = promoted.get(r["id"])
        if not base or r["rate"] is None or base.get("rate") is None or base.get("version_id") == version_id:
            continue
        delta = round(r["rate"] - base["rate"], 6)
        if delta >= th["drift_delta"]:
            flags.append({"id": r["id"], "baseline_rate": base["rate"], "current_rate": r["rate"], "delta": delta,
                          "failing": r["failing"], "total": r["total"], "sample_keys": r["sample_keys"]})
    return flags


# ---------------------------------------------------------------- persistence

async def thresholds(db, tenant_id) -> dict:
    from api.services.tenant_settings import get_setting
    saved = await get_setting(db, tenant_id, SETTING)
    return {**DEFAULTS, **{k: saved[k] for k in DEFAULTS if isinstance(saved, dict) and isinstance(saved.get(k), (int, float))}}


def _key(module: str) -> str:
    return f"rule_promotion.{module}"


async def state(db, tenant_id, module: str) -> dict:
    """{"promoted": {rid: evidence}, "summary": {...}, "at": iso} for a module (empty when none)."""
    from api.services.tenant_settings import get_setting
    return (await get_setting(db, tenant_id, _key(module))) or {"promoted": {}}


async def save_state(db, tenant_id, user_id, module: str, st: dict) -> None:
    from api.services.tenant_settings import put_setting
    await put_setting(db, tenant_id, _key(module), st, user_id)


def evidence_of(row: dict, th: dict, version_id: str | None, mode: str, reason: str | None) -> dict:
    return {"rate": row["rate"], "populated_pct": row["populated_pct"], "failing": row["failing"],
            "total": row["total"], "sample_keys": row["sample_keys"], "bucket": row["bucket"], "mode": mode,
            "reason": reason, "version_id": version_id, "thresholds": th,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}


async def enable(db, tenant_id, request, module: str, rule: dict, ev: dict, st: dict) -> None:
    """Switch one generated rule on for the tenant and audit it (caller commits).

    The tenant's catalogue row (seeded by api/services/tenant_seed) is flipped in place;
    a row is created when the catalogue has none. ``st['promoted'][rid]['created']`` remembers
    which, so a revert deletes only a row this promotion made."""
    from api.services.rbac import write_audit
    rid = rule["id"]
    hit = (await db.execute(text(
        "UPDATE rules SET enabled = true, source = 'promotion', updated_at = now() "
        "WHERE tenant_id = :t AND module = :m AND split_part(name, ':', 1) = :r RETURNING id"),
        {"t": str(tenant_id), "m": module, "r": rid})).fetchone()
    if not hit:
        await db.execute(text(
            "INSERT INTO rules (tenant_id, name, description, module, category, severity, enabled, conditions, source) "
            "VALUES (:t, :n, :d, :m, 'promotion', :s, true, '[]'::jsonb, 'promotion') "
            "ON CONFLICT (tenant_id, name, module) DO UPDATE SET enabled = true, source = 'promotion'"),
            {"t": str(tenant_id), "n": f"{rid}: {rule.get('message', rid)}"[:255], "d": rule.get("message", ""),
             "m": module, "s": rule.get("severity", "medium")})
    st.setdefault("promoted", {})[rid] = {**ev, "created": not hit}
    await write_audit(db, tenant_id, request, "rule_promotion.enable", "rule", rid,
                      {"enabled": False}, {"enabled": True, "module": module, "evidence": ev})


async def revert(db, tenant_id, request, module: str, rule_ids: list[str], st: dict) -> list[str]:
    """Undo promotions (caller commits): a created row is deleted, a catalogue row goes back to
    its shipped state (yaml, disabled)."""
    from api.services.rbac import write_audit
    done = []
    for rid in rule_ids:
        ev = (st.get("promoted") or {}).pop(rid, None)
        if ev is None:
            continue
        p = {"t": str(tenant_id), "m": module, "r": rid}
        if ev.get("created"):
            await db.execute(text("DELETE FROM rules WHERE tenant_id = :t AND module = :m AND source = 'promotion' "
                                  "AND split_part(name, ':', 1) = :r"), p)
        else:
            await db.execute(text("UPDATE rules SET enabled = false, source = 'yaml', updated_at = now() "
                                  "WHERE tenant_id = :t AND module = :m AND source = 'promotion' "
                                  "AND split_part(name, ':', 1) = :r"), p)
        await write_audit(db, tenant_id, request, "rule_promotion.revert", "rule", rid,
                          {"enabled": True, "module": module, "evidence": ev}, {"enabled": False})
        done.append(rid)
    return done


def narrative(module: str, c: dict[str, int], flags: int) -> str:
    """Deterministic template summary of a module's evaluation (no LLM)."""
    total = sum(c.values())
    tail = f" {flags} promoted rule(s) drifted above their baseline." if flags else ""
    return (f"{module}: {total} generated rules evaluated. {c['promote']} ready to promote, {c['review']} need review "
            f"(failure rate above threshold), {c['needs_value_set']} wait for a value set, {c['skip_unused']} skipped "
            f"(field unused or not extracted).{tail}")

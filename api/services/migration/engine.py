"""Source → target transfer gap analysis (deterministic, vectorised).

Compares what a source SAP system actually holds (per-table frames at record
grain, the source's own live DDIC) with what the target will accept (the
target system's live DDIC and configuration when connected, else the SAP
S/4HANA standard dictionary). Every finding names the record, the source and
target field, the value involved and where the rule came from.

Gap types
  structural (per field): unmapped_field · target_field_missing · obsolete_target ·
                          target_config_unverified
  per record:             length_truncation · precision_loss · type_conversion ·
                          case_change · domain_value · check_table_value ·
                          value_unmapped · target_mandatory · key_missing ·
                          key_collision · target_key_exists
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

from checks.base import is_blank, record_keys
from checks.frames import TableFrames
from sap.ddic import Dictionary, Field

_DIR = Path(__file__).resolve().parents[3] / "sap" / "dictionaries" / "migration"
_NUMERIC = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP", "DF16_DEC", "DF34_DEC"}
_CHARLIKE = {"CHAR", "NUMC", "CUKY", "UNIT", "LANG", "CLNT", "ACCP", "SSTR", "STRING"}
_BLOCKING = ("critical", "high")
MAX_FINDINGS_PER_GAP = 50_000


def verdict_for(records: int, n_blocked: int, structural_critical: bool) -> tuple[float, str]:
    """Calculate score and verdict from record counts and structural criticality."""
    score = round((records - n_blocked) / records * 100, 2) if records else 0.0
    if n_blocked and score == 100.0:
        score = 99.99
    verdict = ("go" if records and n_blocked == 0 and not structural_critical
               else "conditional" if records and not structural_critical and score >= 90.0
               else "no-go")
    return score, verdict


@dataclass(frozen=True)
class Mapping:
    source: str                    # TABLE.FIELD in the source
    target: Optional[str]          # TABLE.FIELD in the target; None = intentionally not migrated
    value_map: bool = False        # target values are customer-specific → value mapping required
    origin: str = "identity"       # identity | sap_standard | steward
    note: Optional[str] = None


@dataclass
class Gap:
    module: str
    gap_type: str
    severity: str
    detail: str
    record_key: Optional[str] = None
    source_table: Optional[str] = None
    source_field: Optional[str] = None
    target_table: Optional[str] = None
    target_field: Optional[str] = None
    source_value: Optional[str] = None
    target_value: Optional[str] = None
    provenance: str = "target_dictionary"
    grounded: bool = True


@dataclass
class ModuleResult:
    module: str
    records: int
    blocked_records: int
    score: float
    verdict: str
    counts: dict[str, int] = field(default_factory=dict)
    ready_keys: dict[str, list[str]] = field(default_factory=dict)  # source table → keys


@lru_cache(maxsize=1)
def _standard() -> tuple[dict, set, dict]:
    doc = yaml.safe_load((_DIR / "ecc_to_s4hana.yaml").read_text())
    mandatory = yaml.safe_load((_DIR / "s4hana_mandatory.yaml").read_text())
    return doc.get("mappings", {}), set(doc.get("no_direct_target", [])), mandatory


def seed_mappings(source_tables: dict[str, list[str]], source_dict: Dictionary, target_dict: Dictionary
                  ) -> list[Mapping]:
    """Starting field map: identity where the target has the field, plus SAP-standard (CVI …)."""
    extra, no_target, _ = _standard()
    out: list[Mapping] = []
    for table, cols in source_tables.items():
        for col in cols:
            name = col.split(".", 1)[-1]
            src = f"{table}.{name}"
            if name in ("MANDT", "CLIENT"):
                continue
            if table not in no_target and target_dict.field(table, name) is not None:
                out.append(Mapping(src, src, origin="identity"))
            for m in extra.get(src, []):
                out.append(Mapping(src, m["target"], bool(m.get("value_map")), "sap_standard", m.get("note")))
    return out


def analyze(
    module: str,
    frames: TableFrames,
    source_tables: list[str],
    mappings: list[Mapping],
    target_dict: Dictionary,
    value_maps: dict[str, dict[str, str]] | None = None,
    target_config: dict[str, set[str]] | None = None,
    target_keys: dict[str, set[str]] | None = None,
    target_connected: bool = False,
) -> tuple[list[Gap], ModuleResult]:
    """Gap-analyse one module's source tables against the target."""
    value_maps = value_maps or {}
    target_config = target_config or {}
    _, no_target, mandatory = _standard()
    gaps: list[Gap] = []
    by_source: dict[str, list[Mapping]] = {}
    for m in mappings:
        by_source.setdefault(m.source, []).append(m)

    blocked: dict[str, set[str]] = {}
    all_keys: dict[str, pd.Series] = {}
    # (source table, target table) → target field → values, indexed like the source frame
    target_values: dict[tuple[str, str], dict[str, pd.Series]] = {}

    for table in source_tables:
        df = frames.frames.get(table)
        if df is None or df.empty:
            continue
        keys = [f"{table}.{k}" for k in frames.dictionary.keys(table) if f"{table}.{k}" in df.columns]
        rk = record_keys(df, keys)
        all_keys[table] = rk
        blocked.setdefault(table, set())

        for col in df.columns:
            name = col.split(".", 1)[-1]
            if name in ("MANDT", "CLIENT"):
                continue
            populated = ~is_blank(df[col])
            n_pop = int(populated.sum())
            maps = by_source.get(col, [])
            if not maps:
                if n_pop:
                    custom = name.startswith(("ZZ", "YY")) or table.startswith(("Z", "Y"))
                    gaps.append(Gap(module, "unmapped_field", "low" if custom else "medium",
                                    f"{col} holds values in {n_pop} record(s) but has no target mapping",
                                    source_table=table, source_field=col, provenance="field_map"))
                continue
            for m in maps:
                if m.target is None:
                    continue  # steward decided not to migrate this field
                t_table, t_name = m.target.split(".", 1)
                tf = target_dict.field(t_table, t_name)
                tt = target_dict.table(t_table)
                if tt is not None and tt.obsolete_in == "s4hana":
                    gaps.append(Gap(module, "obsolete_target", "critical",
                                    f"{m.target}: {t_table} is replaced in S/4HANA by {tt.note}",
                                    source_table=table, source_field=col, target_table=t_table,
                                    target_field=m.target, provenance="s4hana_simplification"))
                    continue
                if tf is None:
                    gaps.append(Gap(module, "target_field_missing", "critical",
                                    f"mapped target field {m.target} does not exist in the target dictionary",
                                    source_table=table, source_field=col, target_table=t_table,
                                    target_field=m.target, provenance="target_dictionary"))
                    continue
                values = df[col].astype("string").str.strip()
                mapped = values
                if m.value_map:
                    vm = value_maps.get(m.target, {})
                    mapped = values.map(lambda v, vm=vm: vm.get(v) if isinstance(v, str) else v)
                    miss = populated & mapped.isna()
                    _per_record(gaps, blocked[table], module, "value_unmapped", "critical", miss, rk, df, col,
                                values, None, table, m.target,
                                f"no value mapping from {col} to {m.target}", "value_map")
                target_values.setdefault((table, t_table), {})[t_name] = mapped.where(populated)
                _value_gaps(gaps, blocked[table], module, df, col, values, mapped, populated & mapped.notna(),
                            rk, table, m.target, tf, target_config, target_connected)

        # SAP hard mandatory fields of the target records this source table builds
        for mand, spec in mandatory.items():
            t_table, t_name = mand.split(".", 1)
            if t_table != table and table not in (spec.get("via") or []):
                continue
            vals = target_values.get((table, t_table), {}).get(t_name)
            missing = pd.Series(True, index=df.index) if vals is None else vals.isna()
            _per_record(gaps, blocked[table], module, "target_mandatory", "critical", missing, rk, df, None,
                        None, None, table, mand, spec["reason"], "sap_hard_constraint")

    # key checks per target table (records from every source table that feeds it)
    for (src_table, t_table), fields_ in target_values.items():
        keys = list(target_dict.keys(t_table))
        if not keys:
            continue
        rk = all_keys[src_table]
        if any(k not in fields_ for k in keys):
            continue  # target key not fed from this source — assigned in the target (e.g. internal numbering)
        key_df = pd.DataFrame({k: fields_[k] for k in keys})
        missing = key_df.isna().any(axis=1)
        _per_record(gaps, blocked[src_table], module, "key_missing", "critical", missing, rk, None, None,
                    None, None, src_table, f"{t_table}.{'+'.join(keys)}", "target key would be blank", "target_dictionary")
        dup = key_df[~missing].duplicated(keep=False).reindex(key_df.index, fill_value=False)
        joined = key_df.astype("string").fillna("").agg("|".join, axis=1)
        _per_record(gaps, blocked[src_table], module, "key_collision", "critical", dup, rk, None, None,
                    joined, None, src_table, f"{t_table}.{'+'.join(keys)}",
                    "two source records map to the same target key", "target_dictionary")
        existing = (target_keys or {}).get(t_table)
        if existing:
            hit = ~missing & joined.isin(existing)
            _per_record(gaps, blocked[src_table], module, "target_key_exists", "high", hit, rk, None, None,
                        joined, None, src_table, f"{t_table}.{'+'.join(keys)}",
                        "record already exists in the target — would be an update, not a create", "target_data")

    records = sum(len(k) for k in all_keys.values())
    n_blocked = sum(len(b) for b in blocked.values())
    structural_critical = any(g.severity == "critical" and g.record_key is None for g in gaps)
    score, verdict = verdict_for(records, n_blocked, structural_critical)
    counts: dict[str, int] = {}
    for g in gaps:
        counts[g.gap_type] = counts.get(g.gap_type, 0) + 1
    ready = {t: sorted(set(all_keys[t].tolist()) - blocked.get(t, set())) for t in all_keys}
    return gaps, ModuleResult(module, records, n_blocked, score, verdict, counts, ready)


def _value_gaps(gaps, blocked, module, df, col, values, mapped, scope, rk, table, target, tf: Field,
                target_config, target_connected) -> None:
    t = (tf.type or "").upper()
    v = mapped.astype("string")
    key_field = tf.key
    if t in _CHARLIKE and tf.length:
        bad = scope & (v.str.len() > tf.length)
        _per_record(gaps, blocked, module, "length_truncation", "critical" if key_field else "high", bad, rk, df,
                    col, values, mapped, table, target,
                    f"value longer than {target} ({t} {tf.length})", "target_dictionary")
    if t == "NUMC":
        bad = scope & ~v.str.fullmatch(r"\d+", na=False)
        _per_record(gaps, blocked, module, "type_conversion", "high", bad, rk, df, col, values, mapped, table,
                    target, f"{target} is NUMC — digits only", "target_dictionary")
    elif t == "DATS":
        ok = pd.to_datetime(v, format="%Y%m%d", errors="coerce").notna() | v.eq("00000000")
        _per_record(gaps, blocked, module, "type_conversion", "high", scope & ~ok, rk, df, col, values, mapped,
                    table, target, f"{target} is DATS — not a valid YYYYMMDD date", "target_dictionary")
    elif t == "TIMS":
        bad = scope & ~v.str.fullmatch(r"([01]\d|2[0-3])[0-5]\d[0-5]\d", na=False)
        _per_record(gaps, blocked, module, "type_conversion", "high", bad, rk, df, col, values, mapped, table,
                    target, f"{target} is TIMS — not a valid HHMMSS time", "target_dictionary")
    elif t in _NUMERIC:
        num = v.str.replace(",", "", regex=False).str.replace(r"-$", "", regex=True)
        parsed = pd.to_numeric(num, errors="coerce")
        _per_record(gaps, blocked, module, "type_conversion", "high", scope & parsed.isna(), rk, df, col, values,
                    mapped, table, target, f"{target} is {t} — value is not numeric", "target_dictionary")
        if tf.length and t not in ("FLTP", "INT1", "INT2", "INT4", "INT8"):
            parts = num.str.lstrip("+-").str.split(".", n=1, expand=True)
            ints = parts[0].str.lstrip("0").str.len().fillna(0)
            decs = (parts[1].str.rstrip("0").str.len() if parts.shape[1] > 1 else pd.Series(0, index=v.index)).fillna(0)
            bad = scope & parsed.notna() & ((ints > tf.length - tf.decimals) | (decs > tf.decimals))
            _per_record(gaps, blocked, module, "precision_loss", "high", bad, rk, df, col, values, mapped, table,
                        target, f"{target} holds {tf.length - tf.decimals} integer / {tf.decimals} decimal digits",
                        "target_dictionary")
    if t == "CHAR" and not tf.lowercase:
        bad = scope & v.ne(v.str.upper())
        _per_record(gaps, blocked, module, "case_change", "low", bad, rk, df, col, values, mapped, table, target,
                    f"{target} is upper-case only — SAP will convert the value on load", "target_dictionary")
    fixed = tf.allowed_values()
    if fixed is not None:
        bad = scope & ~v.isin(fixed)
        _per_record(gaps, blocked, module, "domain_value", "high", bad, rk, df, col, values, mapped, table, target,
                    f"not a fixed value of domain {tf.domain}", "target_dictionary")
    if tf.check_ref:
        allowed = target_config.get(tf.check_ref)
        if allowed is not None:
            bad = scope & ~v.isin(allowed)
            _per_record(gaps, blocked, module, "check_table_value", "high", bad, rk, df, col, values, mapped, table,
                        target, f"value not configured in the target's {tf.check_table}", "target_live_config")
        elif int(scope.sum()):
            gaps.append(Gap(module, "target_config_unverified", "medium",
                            f"{target} is checked against {tf.check_table} in the target; "
                            + ("the target's configuration could not be read" if target_connected else
                               "no target system connected — the values cannot be verified until it is"),
                            source_table=table, source_field=col, target_table=target.split(".")[0],
                            target_field=target, provenance="target_config", grounded=False))


def _per_record(gaps, blocked, module, gap_type, severity, mask, rk, df, col, values, mapped, table, target,
                detail, provenance) -> None:
    mask = mask.fillna(False).astype(bool) if hasattr(mask, "fillna") else mask
    if not bool(mask.any()):
        return
    idx = mask[mask].index
    if severity in _BLOCKING:
        blocked.update(rk.loc[idx].tolist())
    for i in idx[:MAX_FINDINGS_PER_GAP]:
        gaps.append(Gap(
            module, gap_type, severity, detail, record_key=str(rk.at[i]), source_table=table,
            source_field=col, target_table=target.split(".")[0] if target else None, target_field=target,
            source_value=None if values is None or pd.isna(values.at[i]) else str(values.at[i]),
            target_value=None if mapped is None or pd.isna(mapped.at[i]) else str(mapped.at[i]),
            provenance=provenance,
        ))

"""DDIC conformance: validate every extracted field against its data dictionary definition.

No YAML rules — the source system's own DDIC (live snapshot, else SAP
standard) says what each field may contain:

  type        NUMC digits only · DATS valid calendar date · TIMS valid time ·
              DEC/CURR/QUAN/INT/FLTP numeric
  length      value longer than the field (CHAR/NUMC …) or more integer /
              decimal digits than the packed field holds
  case        upper-case-only domains (lowercase flag off) holding lower case
  fixed_value value not in the domain's fixed values (DD07L)
  check_table value not in the check table's live configuration values

One result per (table, kind): population = populated cells of the checked
fields, failing = cells that violate; record keys identify every failing
record, details break the violations down per field. Blank cells are out of
scope (null detection is null_check's job). Fields a module rule already checks
against their allowed values (``value_checked``) are not value-checked again,
and a cell a specific rule already reports on that record (``reported``:
TABLE.FIELD → record keys) is not reported again: the same record would show
up twice.
"""

from __future__ import annotations

import pandas as pd

from checks.base import MAX_FAILING_KEYS, CheckResult, is_blank, pass_rate_of, record_keys, safe_json
from sap.ddic import Dictionary

_NUMERIC = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP", "DF16_DEC", "DF34_DEC"}
_CHARLIKE = {"CHAR", "NUMC", "CUKY", "UNIT", "LANG", "CLNT", "ACCP", "SSTR"}
_KINDS = {
    "type": ("high", "Value does not match the field's SAP data type"),
    "length": ("high", "Value exceeds the field's SAP length / precision"),
    "case": ("medium", "Lower-case value in an upper-case SAP field"),
    "fixed_value": ("high", "Value is not one of the domain's fixed values"),
    "check_table": ("high", "Value does not exist in the source system's check table"),
}
# Values SAP stores outside the check table: a condition's rate unit is a currency or '%'
_ALSO_VALID = {"KONWA": {"%"}}


def _violations(values: pd.Series, f, check_values: set[str] | None) -> dict[str, pd.Series]:
    s = values.astype("string").str.strip()
    t = (f.type or "").upper()
    out: dict[str, pd.Series] = {}
    if t == "NUMC":
        out["type"] = ~s.str.fullmatch(r"\d+", na=False)
    elif t == "DATS":
        ok = pd.to_datetime(s, format="%Y%m%d", errors="coerce").notna() | s.eq("00000000")
        out["type"] = ~ok
    elif t == "TIMS":
        out["type"] = ~s.str.fullmatch(r"([01]\d|2[0-3])[0-5]\d[0-5]\d", na=False)
    elif t in _NUMERIC:
        num = s.str.replace(",", "", regex=False).str.replace(r"-$", "", regex=True)
        parsed = pd.to_numeric(num, errors="coerce")
        out["type"] = parsed.isna()
        if f.length and t not in ("FLTP", "INT1", "INT2", "INT4", "INT8"):
            parts = num.str.lstrip("+-").str.split(".", n=1, expand=True)
            ints = parts[0].str.lstrip("0").str.len().fillna(0)
            decs = (parts[1].str.rstrip("0").str.len() if parts.shape[1] > 1 else pd.Series(0, index=s.index)).fillna(0)
            out["length"] = parsed.notna() & ((ints > (f.length - f.decimals)) | (decs > f.decimals))
    if t in _CHARLIKE and f.length:
        out["length"] = s.str.len() > f.length
    if t in ("CHAR",) and not f.lowercase:
        out["case"] = s.ne(s.str.upper())
    fixed = f.allowed_values()
    if fixed is not None:
        out["fixed_value"] = ~s.isin(fixed)
    if check_values is not None:
        out["check_table"] = ~s.isin(check_values)
    return out


def run_conformance(table: str, df: pd.DataFrame, dictionary: Dictionary, module: str,
                    key_cols: list[str], reference_values: dict[str, set[str]] | None = None,
                    value_checked: set[str] | None = None,
                    reported: dict[str, set[str]] | None = None) -> list[CheckResult]:
    t = dictionary.table(table)
    if t is None or t.category == "VIEW" or df.empty:
        return []
    reference_values = reference_values or {}
    keys = [k for k in key_cols if k in df.columns]
    kdf = df[keys]  # a lazily held table (checks/frames.ParquetTable) decodes each column once
    row_keys = record_keys(kdf, keys) if reported else None
    cells = {k: 0 for k in _KINDS}
    failing_rows = {k: pd.Series(False, index=kdf.index) for k in _KINDS}
    per_field: dict[str, dict[str, int]] = {k: {} for k in _KINDS}
    check_tables: dict[str, str] = {}  # field → live check table its values were judged against
    for col in df.columns:
        name = col.split(".", 1)[-1]
        f = t.fields.get(name)
        if f is None or name in ("MANDT", "CLIENT"):
            continue
        s = df[col]
        populated = ~is_blank(s)
        if not populated.any():
            continue
        check_values = reference_values.get(f.check_ref) if f.check_ref else None
        if check_values is not None:
            check_tables[f.name] = f.check_ref
        if check_values is not None and name in _ALSO_VALID:
            check_values = check_values | _ALSO_VALID[name]
        for kind, bad in _violations(s, f, check_values).items():
            if kind in ("fixed_value", "check_table") and col in (value_checked or ()):
                continue
            bad = bad.fillna(True).astype(bool) & populated
            if reported and col in reported:
                bad &= ~row_keys.isin(reported[col])
            cells[kind] += int(populated.sum())
            n = int(bad.sum())
            if n:
                per_field[kind][f.name] = n
                failing_rows[kind] |= bad

    # check-table values only ever come from the extracted live configuration; the
    # other kinds judge against the field definition, live DDIC or SAP standard
    definition = sorted({f.provenance for f in t.fields.values()})
    results = []
    for kind, (severity, message) in _KINDS.items():
        if not cells[kind]:
            continue
        affected_cells = sum(per_field[kind].values())
        rows = failing_rows[kind]
        fk = record_keys(kdf[rows], keys) if rows.any() else pd.Series(dtype="string")
        shown = [f"{table}.{fld}" for fld in per_field[kind] if f"{table}.{fld}" in df.columns]
        sample = df[list(dict.fromkeys(keys + shown))].loc[kdf[rows].head(10).index]
        results.append(CheckResult(
            check_id=f"DDIC-{table}-{kind.upper()}",
            module=module,
            field=f"{table}.*",
            severity=severity,
            dimension="validity",
            passed=affected_cells == 0,
            affected_count=affected_cells,
            total_count=cells[kind],
            pass_rate=pass_rate_of(cells[kind], affected_cells),
            message=f"{message} ({table})",
            details=safe_json({
                "kind": kind,
                "table": table,
                "fields_failing": per_field[kind],
                "failing_record_count": int(rows.sum()),
                "record_key_fields": keys,
                "baseline": "live_config" if kind == "check_table" or "live" in definition else "sap_standard",
                "definition_provenance": definition,
                **({"check_tables": {fld: check_tables[fld] for fld in per_field[kind]},
                    "check_values_source": "live_config"} if kind == "check_table" else {}),
                "sample_failing_records": [
                    {**{c: str(sample.at[i, c]) for c in keys},
                     **{c: str(sample.at[i, c]) for c in shown},
                     "record_key": str(fk.at[i])}
                    for i in sample.index
                ],
            }),
            failing_record_keys=[str(k) for k in fk.head(MAX_FAILING_KEYS)],
            grain=table,
        ))
    return results

"""
checks/config_signals.py — deterministic configuration signal extractor.

Reads a DataFrame and returns observable configuration patterns that describe
how a customer has set up their SAP environment. No LLM, no external calls.
Never raises — returns {} on any error.
"""
from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from checks.base import find_id_field

logger = logging.getLogger(__name__)

# ── Module category membership ───────────────────────────────────────────────

_ECC_MODULES = frozenset({
    "business_partner", "material_master", "fi_gl", "accounts_payable",
    "accounts_receivable", "asset_accounting", "mm_purchasing",
    "plant_maintenance", "production_planning", "sd_customer_master",
    "sd_sales_orders",
})

_SF_MODULES = frozenset({
    "employee_central", "compensation", "benefits", "payroll_integration",
    "performance_goals", "succession_planning", "recruiting_onboarding",
    "learning_management", "time_attendance",
})

_WH_MODULES = frozenset({
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data",
    "grc_compliance", "fleet_management", "transport_management",
    "wm_interface", "cross_system_integration",
})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _find_col(df: pd.DataFrame, *fragments: str) -> str | None:
    """Return first column whose upper-case name exactly or partially matches
    any of the given fragments. Exact match wins over substring match."""
    upper_cols = {c.upper(): c for c in df.columns}
    for frag in fragments:
        frag_up = frag.upper()
        if frag_up in upper_cols:
            return upper_cols[frag_up]
    for frag in fragments:
        frag_up = frag.upper()
        for col_up, col in upper_cols.items():
            if frag_up in col_up:
                return col
    return None


def _top_n_pct(df: pd.DataFrame, col: str, n: int) -> dict[str, float] | None:
    """Return top-N value -> fraction dict for a column, or None if col absent."""
    if col not in df.columns:
        return None
    series = df[col].dropna()
    if series.empty:
        return {}
    counts = series.value_counts(normalize=True).head(n)
    return {str(k): round(float(v), 4) for k, v in counts.items()}


def _top_n_pct_col(df: pd.DataFrame, col: str | None, n: int) -> dict[str, float] | None:
    if col is None:
        return None
    return _top_n_pct(df, col, n)


def _unique_vals(df: pd.DataFrame, col: str | None, max_vals: int | None = None) -> list | None:
    if col is None or col not in df.columns:
        return None
    vals = df[col].dropna().unique().tolist()
    vals = [str(v) for v in vals]
    if max_vals is not None:
        vals = vals[:max_vals]
    return vals


# ── Universal signals ─────────────────────────────────────────────────────────

def _universal_signals(df: pd.DataFrame) -> dict[str, Any]:
    signals: dict[str, Any] = {}

    signals["total_rows"] = len(df)

    # dominant_countries
    country_col = _find_col(df, "LAND1", "COUNTRY")
    signals["dominant_countries"] = _top_n_pct_col(df, country_col, 3)

    # dominant_currencies
    currency_col = _find_col(df, "WAERS", "CURRENCY")
    signals["dominant_currencies"] = _top_n_pct_col(df, currency_col, 3)

    # custom_fields_present
    custom = [
        c for c in df.columns
        if c.upper().startswith(("ZZ", "Z_", "Y_", "YY"))
    ]
    signals["custom_fields_present"] = custom

    # null_rate_by_column (only cols with >5% nulls)
    if len(df) > 0:
        null_rates = (df.isnull().mean() * 100).round(2)
        signals["null_rate_by_column"] = {
            col: float(rate)
            for col, rate in null_rates.items()
            if rate > 5.0
        }
    else:
        signals["null_rate_by_column"] = {}

    # number_range_pattern
    try:
        if df.empty or len(df.columns) == 0:
            signals["number_range_pattern"] = None
        else:
            id_col = find_id_field(df)
            series = df[id_col].dropna().astype(str)
            if series.empty:
                signals["number_range_pattern"] = {
                    "length_mode": None,
                    "all_numeric": None,
                    "prefix_pattern": None,
                }
            else:
                lengths = series.str.len()
                length_mode = int(lengths.mode().iloc[0]) if not lengths.empty else None
                all_numeric = bool(series.str.match(r"^\d+$").all())
                prefix_pattern: str | None = None
                if not all_numeric:
                    prefixes = series.str[:2]
                    if not prefixes.empty:
                        prefix_pattern = str(prefixes.mode().iloc[0])
                signals["number_range_pattern"] = {
                    "length_mode": length_mode,
                    "all_numeric": all_numeric,
                    "prefix_pattern": prefix_pattern,
                }
    except Exception:
        signals["number_range_pattern"] = None

    return signals


# ── ECC signals ───────────────────────────────────────────────────────────────

def _ecc_signals(df: pd.DataFrame) -> dict[str, Any]:
    signals: dict[str, Any] = {}

    bukrs_col = _find_col(df, "BUKRS")
    signals["company_codes"] = _unique_vals(df, bukrs_col, 10)

    werks_col = _find_col(df, "WERKS")
    signals["plant_codes"] = _unique_vals(df, werks_col, 10)

    ktopl_col = _find_col(df, "KTOPL")
    signals["chart_of_accounts"] = _unique_vals(df, ktopl_col, None)

    # sales_areas: unique combos of VKORG+VTWEG+SPART
    vkorg_col = _find_col(df, "VKORG")
    vtweg_col = _find_col(df, "VTWEG")
    spart_col = _find_col(df, "SPART")
    if vkorg_col and vtweg_col and spart_col:
        combos = (
            df[[vkorg_col, vtweg_col, spart_col]]
            .dropna()
            .drop_duplicates()
            .head(5)
        )
        signals["sales_areas"] = [
            {vkorg_col: str(r[vkorg_col]), vtweg_col: str(r[vtweg_col]), spart_col: str(r[spart_col])}
            for _, r in combos.iterrows()
        ]
    else:
        signals["sales_areas"] = None

    akont_col = _find_col(df, "AKONT")
    signals["recon_accounts"] = _top_n_pct_col(df, akont_col, 3)

    zterm_col = _find_col(df, "ZTERM")
    signals["payment_terms"] = _top_n_pct_col(df, zterm_col, 5)

    return signals


# ── SuccessFactors signals ────────────────────────────────────────────────────

def _sf_signals(df: pd.DataFrame) -> dict[str, Any]:
    signals: dict[str, Any] = {}

    legal_col = _find_col(df, "COMPANY_ID", "COMP_CODE")
    signals["legal_entities"] = _unique_vals(df, legal_col, None)

    pay_col = _find_col(df, "ABKRS", "PAY_GROUP")
    signals["pay_groups"] = _unique_vals(df, pay_col, None)

    molga_col = _find_col(df, "MOLGA")
    signals["country_groupings"] = _unique_vals(df, molga_col, None)

    # position_patterns: prefix pattern of PLANS or POSITION_ID
    pos_col = _find_col(df, "PLANS", "POSITION_ID")
    if pos_col and pos_col in df.columns:
        series = df[pos_col].dropna().astype(str)
        if not series.empty:
            prefixes = series.str[:2]
            prefix_pattern: str | None = str(prefixes.mode().iloc[0]) if not prefixes.empty else None
        else:
            prefix_pattern = None
        signals["position_patterns"] = prefix_pattern
    else:
        signals["position_patterns"] = None

    return signals


# ── Warehouse signals ─────────────────────────────────────────────────────────

def _wh_signals(df: pd.DataFrame) -> dict[str, Any]:
    signals: dict[str, Any] = {}

    lgnum_col = _find_col(df, "LGNUM")
    signals["warehouse_numbers"] = _unique_vals(df, lgnum_col, None)

    lgtyp_col = _find_col(df, "LGTYP")
    signals["storage_types"] = _unique_vals(df, lgtyp_col, 10)

    charg_col = _find_col(df, "CHARG")
    if charg_col and charg_col in df.columns:
        series = df[charg_col].dropna().astype(str)
        if not series.empty:
            prefixes = series.str[:6]
            batch_prefix: str | None = str(prefixes.mode().iloc[0]) if not prefixes.empty else None
        else:
            batch_prefix = None
        signals["batch_prefix_pattern"] = batch_prefix
    else:
        signals["batch_prefix_pattern"] = None

    return signals


# ── Public API ────────────────────────────────────────────────────────────────

def extract_config_signals(module: str, df: pd.DataFrame) -> dict:
    """Extract observable configuration signals from a module DataFrame.

    Parameters
    ----------
    module:
        Module name exactly as used in checks/rules/ (e.g. "business_partner").
    df:
        Raw module DataFrame (may be empty).

    Returns
    -------
    dict
        signal_name -> observed_value(s). Always returns a dict; never raises.
    """
    try:
        signals: dict[str, Any] = {}

        signals.update(_universal_signals(df))

        module_lower = module.lower()
        if module_lower in _ECC_MODULES:
            signals.update(_ecc_signals(df))
        elif module_lower in _SF_MODULES:
            signals.update(_sf_signals(df))
        elif module_lower in _WH_MODULES:
            signals.update(_wh_signals(df))
        else:
            logger.warning("extract_config_signals: unknown module %r — only universal signals extracted", module)

        return signals

    except Exception as exc:  # noqa: BLE001
        logger.warning("extract_config_signals failed for module %r: %s", module, exc, exc_info=True)
        return {}

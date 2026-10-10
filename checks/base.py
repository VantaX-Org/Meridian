from abc import ABC, abstractmethod
from typing import Any, Optional

import pandas as pd
from pydantic import BaseModel

# Exact SAP primary key fields — highest priority.
SAP_PRIMARY_KEYS = [
    "BUT000.PARTNER", "MARA.MATNR", "SKA1.SAKNR", "KNA1.KUNNR",
    "LFA1.LIFNR", "EQUI.EQUNR", "ANLA.ANLN1", "EKKO.EBELN",
    "EMPEMPLOYMENT.USERID", "STKO.STLNR", "CRHD.ARBPL",
]

# Short name suffixes — second priority, column name must end with one.
SAP_KEY_SUFFIXES = [
    "PARTNER", "MATNR", "SAKNR", "KUNNR", "LIFNR", "EQUNR",
    "ANLN1", "EBELN", "USERID", "PLNNR", "STLNR",
]

# Generic fragments — lowest priority, only used for short column names.
SAP_KEY_GENERIC = ["ID", "NUMBER", "KEY"]


def safe_json(obj: Any) -> Any:
    """Recursively convert a dict/list to JSON-safe Python types."""
    if isinstance(obj, dict):
        return {k: safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe_json(v) for v in obj]
    if hasattr(obj, "item"):  # numpy scalar
        return obj.item()
    if hasattr(obj, "isoformat"):  # datetime / Timestamp
        return obj.isoformat()
    if obj != obj:  # NaN check
        return None
    return obj


def find_id_field(df: pd.DataFrame) -> str:
    """Find the best identifier column — prefer exact SAP primary keys,
    then suffix matches, then generic fragments on short column names."""
    cols = list(df.columns)
    col_upper = {c.upper(): c for c in cols}

    # Priority 1: exact match against known primary keys
    for pk in SAP_PRIMARY_KEYS:
        if pk.upper() in col_upper:
            return col_upper[pk.upper()]

    # Priority 2: column name ends with a known SAP key suffix
    for suffix in SAP_KEY_SUFFIXES:
        for c in cols:
            if c.upper().endswith(suffix):
                return c

    # Priority 3: generic fragments, only for short column names (<20 chars)
    for frag in SAP_KEY_GENERIC:
        for c in cols:
            if frag in c.upper() and len(c) < 20:
                return c

    return cols[0]


class CheckResult(BaseModel):
    check_id: str
    module: str
    field: str
    severity: str  # critical | high | medium | low
    dimension: str  # completeness | accuracy | consistency | timeliness | uniqueness | validity
    passed: bool
    affected_count: int
    total_count: int
    pass_rate: float  # 0.0 to 100.0
    message: str
    details: dict
    error: Optional[str] = None
    rule_context: Optional[dict] = None
    value_fix_map: Optional[dict] = None
    record_fixes: Optional[list] = None
    # Every failing record's SAP key ("BUKRS=1000|LIFNR=0000100001"), capped at
    # MAX_FAILING_KEYS. Persisted to finding_records — not part of details JSON.
    failing_record_keys: Optional[list[str]] = None
    # The rule's column values of each failing record, parallel to failing_record_keys.
    # Privacy-sensitive columns (checks.profiling.is_sensitive) are never kept: MASKED.
    failing_record_values: Optional[list[dict]] = None
    grain: Optional[str] = None  # table whose records were evaluated (e.g. LFB1)
    # Cost of poor data quality (checks/cost.py): amount at risk and how it was computed.
    cost_at_risk: Optional[float] = None
    cost_formula: Optional[str] = None


# Record-level output cap per check. Beyond this the count stays exact but the
# key list is truncated (details["failing_keys_truncated"] = True).
MAX_FAILING_KEYS = 100_000
SAMPLE_SIZE = 10
MASKED = "\u2022\u2022\u2022"


def failing_values(failing_df: pd.DataFrame, columns: list[str]) -> list[dict]:
    """The failing records' values of ``columns`` ("TABLE.FIELD"), sensitive ones masked."""
    from checks.profiling import is_sensitive  # profiling imports this module
    cols = [c for c in dict.fromkeys(columns) if c in failing_df.columns]
    if not cols:
        return [{} for _ in range(len(failing_df))]
    out = failing_df[cols].astype("string").fillna("")
    for c in cols:
        table, _, field = c.rpartition(".")
        if is_sensitive(table, field):
            out[c] = out[c].where(out[c].str.strip() == "", MASKED)  # a blank reveals nothing
    return out.to_dict("records")


def _sensitive_field(column: str) -> bool:
    """Field-name sensitivity only: names, tax IDs, contact data. Coded values on an
    HR table (status, reason codes) stay countable for value-level fix guidance."""
    from checks.profiling import is_sensitive
    return is_sensitive("", column.rpartition(".")[2])


def is_blank(series: pd.Series) -> pd.Series:
    """SAP-aware blank: NaN/None, empty or whitespace-only.

    ``0`` / ``0.000`` are values, not blanks. Initial SAP dates
    (``00000000``) and times (``000000``) are blank.
    """
    s = series.astype("string").str.strip()
    return series.isna() | s.isna() | (s == "") | s.isin(("00000000", "000000"))


# Decimal comma vs thousands comma is decided per column, from unambiguous values:
# '12,5' / '1.234,50' / '1.234.567' prove a European column; '1,234.50' / '1,234,567'
# an English one. Without European evidence a comma groups thousands ('12,500' =
# 12500). A single dot is always a decimal point — RFC writes QUAN "1.000" for 1.0.
_EU_PROOF = r"^\d{1,3}(?:\.\d{3})+,\d+$|^\d+,(?:\d{1,2}|\d{4,})$|^\d{1,3}(?:\.\d{3}){2,}$"
_EN_PROOF = r"^\d{1,3}(?:,\d{3})+\.\d+$|^\d{1,3}(?:,\d{3}){2,}$"


def sap_number(series: pd.Series) -> pd.Series:
    """Numbers as SAP and spreadsheets write them: RFC puts the sign last
    (``1234.50-``), uploads may use thousands separators (``1,234.50``) or the
    European form (``1.234,50``). Anything else non-numeric becomes NaN."""
    s = series.astype("string").str.strip()
    neg = s.str.endswith("-", na=False)
    s = s.str.rstrip("-").str.lstrip("+")
    european = s.str.match(_EU_PROOF, na=False).any() and not s.str.match(_EN_PROOF, na=False).any()
    if european:
        grouped = s.str.contains(",", regex=False, na=False) | s.str.match(r"^\d{1,3}(?:\.\d{3}){2,}$", na=False)
        s = s.where(~grouped, s.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    else:
        s = s.str.replace(",", "", regex=False)
    n = pd.to_numeric(s, errors="coerce")
    return n.where(~neg, -n)


def as_of_time(as_of: Any = None) -> pd.Timestamp:
    """The date that date-relative rules measure age against, as tz-naive UTC.

    A run passes the version's snapshot date so that ageing rules do not age a
    stale extract by the wall clock; without one it is now."""
    t = pd.Timestamp.now(tz="UTC") if as_of is None else pd.Timestamp(as_of)
    return t.tz_convert("UTC").tz_localize(None) if t.tzinfo else t


def pass_rate_of(total: int, affected: int) -> float:
    """Percentage of passing records, never rounded up to 100 while failures exist."""
    if total <= 0:
        return 100.0
    rate = round((total - affected) / total * 100, 2)
    return min(rate, 99.99) if affected > 0 else rate


def record_keys(df: pd.DataFrame, key_cols: list[str]) -> pd.Series:
    """Stable per-row SAP key string, e.g. ``BUKRS=1000|LIFNR=0000100001``."""
    if not key_cols:
        return pd.Series([f"row:{i}" for i in range(len(df))], index=df.index)
    parts = [
        (c.split(".")[-1] + "=") + df[c].astype("string").fillna("").str.strip()
        for c in key_cols
    ]
    out = parts[0]
    for p in parts[1:]:
        out = out + "|" + p
    return out


class Evaluation:
    """What a check type computes: which rows are in scope and which fail."""

    __slots__ = ("population", "failing", "details", "invalid_values_field")

    def __init__(self, population: pd.Series, failing: pd.Series, details: dict | None = None,
                 invalid_values_field: str | None = None):
        self.population = population.astype(bool)
        self.failing = (failing.astype(bool) & self.population)
        self.details = details or {}
        self.invalid_values_field = invalid_values_field


def _dedupe_evaluation(df: pd.DataFrame, ev: "Evaluation", cols: list[str]) -> "Evaluation":
    """Collapse one finding per ``cols`` key (e.g. per employee) when a rule's grain
    fans out across a child table (COMPINFO's many pay-component rows per EMPEMPLOYMENT).
    New engine feature (rule key ``dedupe_on``, added with the SF employee_central
    depth pack; EC444 and EC449 use it). Each key keeps one representative row: its
    first failing row if any row failed, else its first in-scope row. So the failing
    sample only ever shows rows that actually failed, never a passing sibling."""
    key = df[cols].astype("string").fillna("").agg("|".join, axis=1).reset_index(drop=True)
    rank = 2 - ev.failing.astype(int).to_numpy() - ev.population.astype(int).to_numpy()
    rep = pd.Series(rank).groupby(key, sort=False).idxmin().to_numpy()  # positions
    chosen_s = pd.Series(False, index=df.index)
    chosen_s.iloc[rep] = True
    return Evaluation(ev.population & chosen_s, ev.failing & chosen_s, ev.details, ev.invalid_values_field)


class BaseCheck(ABC):
    check_class: str = ""
    default_dimension: str = "validity"

    def __init__(self, rule: dict):
        self.rule = rule

    # Columns the check reads; a missing one means "not in this extract" → skip.
    def columns(self) -> list[str]:
        cols = [self.rule["field"]] if self.rule.get("field") else []
        return cols + [c for c in (self.rule.get("fields") or []) if c not in cols]

    def optional_columns(self) -> list[str]:
        """Columns read when present, never required: ``columns()`` decides whether the rule runs."""
        return list(self.rule.get("dedupe_on") or [])

    @abstractmethod
    def evaluate(self, df: pd.DataFrame) -> Evaluation | None:
        """Return scope + failing masks, or None to skip the rule."""
        ...

    def run(self, df: pd.DataFrame, key_cols: list[str] | None = None,
            grain: str | None = None) -> CheckResult | None:
        """Evaluate and build the result. Return None to skip (field not in extract)."""
        if any(c not in df.columns for c in self.columns()):
            return None
        try:
            ev = self.evaluate(df)
        except Exception as e:  # rule-level error is visible, never silent
            return self._error(df, str(e))
        if ev is None:
            return None
        dedupe_on = self.rule.get("dedupe_on")
        if dedupe_on and all(c in df.columns for c in dedupe_on):
            ev = _dedupe_evaluation(df, ev, dedupe_on)
        return self._result(df, ev, key_cols, grain)

    # ── result construction (single implementation for every check type) ──

    def _result(self, df: pd.DataFrame, ev: Evaluation, key_cols: list[str] | None,
                grain: str | None) -> CheckResult:
        total = int(ev.population.sum())
        affected = int(ev.failing.sum())
        field = self.rule.get("field") or (self.rule.get("fields") or [""])[0]

        keys = [c for c in (key_cols or []) if c in df.columns]
        if not keys:
            keys = [find_id_field(df)] if len(df.columns) else []
        failing_df = df[ev.failing]
        all_keys = record_keys(failing_df, keys) if affected else pd.Series(dtype="string")

        shown = [c for c in dict.fromkeys(keys + self.columns()) if c in df.columns]
        sample = failing_df.head(SAMPLE_SIZE)
        samples = []
        for idx, rec in zip(sample.index, failing_values(sample, shown)):
            rec["record_key"] = str(all_keys.at[idx])
            if ev.invalid_values_field:
                rec["invalid_value"] = rec.get(ev.invalid_values_field, "")
            samples.append(rec)

        details = {
            "field_checked": field,
            "id_field_used": keys[0] if keys else None,
            "record_key_fields": keys,
            "failing_record_count": affected,
            "message": self.rule.get("message", ""),
            "sample_failing_records": samples,
            **ev.details,
        }
        if ev.invalid_values_field and affected and not _sensitive_field(ev.invalid_values_field):
            details["distinct_invalid_values"] = (
                failing_df[ev.invalid_values_field].astype("string").str.strip()
                .value_counts().head(10).to_dict()
            )
        if affected > MAX_FAILING_KEYS:
            details["failing_keys_truncated"] = True
        from checks.cost import price
        cost, formula = price(self.rule.get("_cost"), affected, failing_df)

        return CheckResult(
            check_id=self.rule["id"],
            module=self.rule.get("module", ""),
            field=field,
            severity=self.rule.get("severity", "medium"),
            dimension=self.rule.get("dimension", self.default_dimension),
            passed=affected == 0,
            affected_count=affected,
            total_count=total,
            pass_rate=pass_rate_of(total, affected),
            message=self.rule.get("message", ""),
            details=safe_json(details),
            failing_record_keys=[str(k) for k in all_keys.head(MAX_FAILING_KEYS)] if affected else [],
            failing_record_values=failing_values(failing_df.head(MAX_FAILING_KEYS), self.columns()) if affected else [],
            grain=grain,
            cost_at_risk=cost,
            cost_formula=formula,
        )

    def _error(self, df: pd.DataFrame, error: str) -> CheckResult:
        return CheckResult(
            check_id=self.rule.get("id", "UNKNOWN"),
            module=self.rule.get("module", ""),
            field=self.rule.get("field", ""),
            severity=self.rule.get("severity", "medium"),
            dimension=self.rule.get("dimension", self.default_dimension),
            passed=False,
            affected_count=0,
            total_count=len(df),
            pass_rate=0.0,
            message=self.rule.get("message", ""),
            details={},
            error=error,
        )

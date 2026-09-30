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
    grain: Optional[str] = None  # table whose records were evaluated (e.g. LFB1)


# Record-level output cap per check. Beyond this the count stays exact but the
# key list is truncated (details["failing_keys_truncated"] = True).
MAX_FAILING_KEYS = 100_000
SAMPLE_SIZE = 10


def is_blank(series: pd.Series) -> pd.Series:
    """SAP-aware blank: NaN/None, empty or whitespace-only.

    ``0`` / ``0.000`` are values, not blanks. Initial SAP dates
    (``00000000``) and times (``000000``) are blank.
    """
    s = series.astype("string").str.strip()
    return series.isna() | s.isna() | (s == "") | s.isin(("00000000", "000000"))


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


class BaseCheck(ABC):
    check_class: str = ""
    default_dimension: str = "validity"

    def __init__(self, rule: dict):
        self.rule = rule

    # Columns the check reads; a missing one means "not in this extract" → skip.
    def columns(self) -> list[str]:
        cols = [self.rule["field"]] if self.rule.get("field") else []
        return cols + [c for c in (self.rule.get("fields") or []) if c not in cols]

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
        for idx in sample.index:
            rec = {c: ("" if pd.isna(sample.at[idx, c]) else str(sample.at[idx, c])) for c in shown}
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
        if ev.invalid_values_field and affected:
            details["distinct_invalid_values"] = (
                failing_df[ev.invalid_values_field].astype("string").str.strip()
                .value_counts().head(10).to_dict()
            )
        if affected > MAX_FAILING_KEYS:
            details["failing_keys_truncated"] = True

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
            grain=grain,
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

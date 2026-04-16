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


class BaseCheck(ABC):
    check_class: str = ""

    def __init__(self, rule: dict):
        self.rule = rule

    @abstractmethod
    def run(self, df: pd.DataFrame) -> CheckResult | None:
        """Run the check. Return None to skip (e.g. field not in partial extract)."""
        ...

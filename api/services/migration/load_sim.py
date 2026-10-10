"""S/4HANA load dry run. Pure, deterministic simulation over source TableFrames.
Emits engine.Gap rows (gap_type 's4_load') whose detail starts with the S4L rule id."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd
import yaml

from api.services.migration.engine import Gap
from checks.base import record_keys
from checks.frames import TableFrames

_FILE = Path(__file__).resolve().parents[3] / "sap" / "dictionaries" / "migration" / "s4_load_rules.yaml"

# Record-key columns per source table, plain (unprefixed) names — TableFrames in this
# module holds flat per-table frames (e.g. MARA["MATNR"]), not "TABLE.FIELD" columns.
_KEYS: dict[str, list[str]] = {
    "MARA": ["MATNR"], "MBEW": ["MATNR", "BWKEY", "BWTAR"], "MARD": ["MATNR", "WERKS", "LGORT"],
    "LFA1": ["LIFNR"], "KNA1": ["KUNNR"], "KNVK": ["PARNR"], "KNKK": ["KUNNR", "KKBER"],
    "KONV": ["KNUMV", "KPOSN", "STUNR", "ZAEHK"], "NAST": ["KAPPL", "OBJKY", "KSCHL", "PARNR"],
}
# Characters the MATN1 conversion exit accepts unchanged: upper-case letters, digits,
# and the common separators. Anything else (including lower-case) is rejected.
_ALLOWED = r"^[A-Z0-9\-_/\.\s]*$"


@dataclass(frozen=True)
class S4LRule:
    id: str
    area: str
    severity: str
    reason: str
    target: str
    related: tuple[str, ...]


@lru_cache(maxsize=1)
def rules() -> dict[str, S4LRule]:
    doc = yaml.safe_load(_FILE.read_text())
    return {r["id"]: S4LRule(r["id"], r["area"], r["severity"], r["reason"], r["target"],
                             tuple(r.get("related") or ())) for r in doc["rules"]}


def _frame(frames: TableFrames, table: str) -> pd.DataFrame | None:
    df = frames.frames.get(table)
    return df if df is not None and not df.empty else None


def _gaps(rule_id: str, module: str, table: str, field: str | None, mask: pd.Series,
          df: pd.DataFrame, values: pd.Series | None = None) -> list[Gap]:
    """Shared emitter: every later S4L check builds its findings through this."""
    rule = rules()[rule_id]
    if not mask.any():
        return []
    keys = record_keys(df, [k for k in _KEYS[table] if k in df.columns])[mask]
    vals = (values if values is not None else pd.Series([None] * len(df), index=df.index))[mask]
    t_table, _, t_field = rule.target.partition(".")
    return [Gap(module=module, gap_type="s4_load", severity=rule.severity,
                detail=f"{rule_id} {rule.reason}", record_key=k, source_table=table,
                source_field=field, target_table=t_table, target_field=t_field or None,
                source_value=None if v is None or pd.isna(v) else str(v)[:200],
                provenance="s4_load_sim")
            for k, v in zip(keys.tolist(), vals.tolist())]


def check_matnr(frames: TableFrames, module: str) -> list[Gap]:
    """S/4 MATNR load checks: 40-char overflow, ALPHA-conversion collision (leading
    zeros make two source numbers resolve to the same internal key), and characters
    the MATN1 conversion exit would reject (lower-case or non-SAP punctuation)."""
    df = _frame(frames, "MARA")
    if df is None or "MATNR" not in df.columns:
        return []
    m = df["MATNR"].astype("string").fillna("").str.strip()
    numeric = m.str.fullmatch(r"\d+")
    alpha = m.where(~numeric, m.str.lstrip("0"))
    collide = numeric & alpha.duplicated(keep=False) & numeric.groupby(alpha).transform("sum").gt(1)
    out = _gaps("S4L-MM-MATNR-LEN", module, "MARA", "MATNR", m.str.len() > 40, df, m)
    out += _gaps("S4L-MM-MATNR-ALPHA", module, "MARA", "MATNR", collide, df, m)
    out += _gaps("S4L-MM-MATNR-CHARS", module, "MARA", "MATNR",
                  ~numeric & ~m.str.fullmatch(_ALLOWED), df, m)
    return out

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


def _norm(s: pd.Series) -> pd.Series:
    return s.astype("string").fillna("").str.strip()


def check_cvi(frames: TableFrames, module: str, grouping_map: dict[str, str]) -> list[Gap]:
    """S/4 CVI business-partner load checks: vendor/customer number overlap onto one
    BP, account-group to BU_GROUP mapping gaps, mandatory BP fields, tax-id collisions
    across parties, and KNVK contact rows that orphan on both the customer and vendor
    side once CVI retires the separate vendor/customer number ranges."""
    out: list[Gap] = []
    lfa1, kna1 = _frame(frames, "LFA1"), _frame(frames, "KNA1")
    sides = [(t, df, num, grp) for t, df, num, grp in
             (("LFA1", lfa1, "LIFNR", "KTOKK"), ("KNA1", kna1, "KUNNR", "KTOKD")) if df is not None]
    for table, df, num, grp in sides:
        if grp in df.columns:
            g = _norm(df[grp])
            out += _gaps("S4L-BP-GROUPING", module, table, grp, ~g.isin(list(grouping_map)), df, g)
        blank = pd.Series(False, index=df.index)
        for f in ("NAME1", "LAND1"):
            if f in df.columns:
                blank |= _norm(df[f]).eq("")
        out += _gaps("S4L-BP-MANDATORY", module, table, "NAME1/LAND1", blank, df)
    if lfa1 is not None and kna1 is not None:
        v = lfa1.assign(_n=_norm(lfa1["LIFNR"]).str.lstrip("0"), _m=_norm(lfa1.get("NAME1", "")).str.upper())
        c = kna1.assign(_n=_norm(kna1["KUNNR"]).str.lstrip("0"), _m=_norm(kna1.get("NAME1", "")).str.upper())
        clash = v.merge(c, on="_n", suffixes=("_v", "_c"))
        clash = set(clash.loc[clash["_m_v"] != clash["_m_c"], "_n"])
        out += _gaps("S4L-BP-NUM-OVERLAP", module, "LFA1", "LIFNR", v["_n"].isin(clash), lfa1)
        out += _gaps("S4L-BP-NUM-OVERLAP", module, "KNA1", "KUNNR", c["_n"].isin(clash), kna1)
    tax = [(t, df, num) for t, df, num, _ in sides if "STCD1" in df.columns]
    if tax:
        allp = pd.concat([pd.DataFrame({"tax": _norm(df["STCD1"]), "party": t + ":" + _norm(df[num])})
                          for t, df, num in tax])
        allp = allp[allp["tax"] != ""]
        # ponytail: a vendor and a customer with the same number and tax id are one party (CVI same-number
        # case); only distinct parties that share a tax id are flagged. Upgrade: use match_scores clusters.
        party_id = allp["party"].str.split(":").str[1].str.lstrip("0")
        dup_tax = set(allp.assign(p=party_id).groupby("tax")["p"].nunique().loc[lambda s: s > 1].index)
        for t, df, _ in tax:
            out += _gaps("S4L-BP-TAX", module, t, "STCD1", _norm(df["STCD1"]).isin(dup_tax), df, _norm(df["STCD1"]))
    knvk = _frame(frames, "KNVK")
    if knvk is not None:
        cust = set(_norm(kna1["KUNNR"])) if kna1 is not None else set()
        vend = set(_norm(lfa1["LIFNR"])) if lfa1 is not None else set()
        k = _norm(knvk.get("KUNNR", pd.Series("", index=knvk.index)))
        l = _norm(knvk.get("LIFNR", pd.Series("", index=knvk.index)))
        orphan = ~((k != "") & k.isin(cust)) & ~((l != "") & l.isin(vend))
        out += _gaps("S4L-BP-KNVK-ORPHAN", module, "KNVK", "KUNNR", orphan, knvk)
    return out


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

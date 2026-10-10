"""S/4HANA load dry run. Pure, deterministic simulation over source TableFrames.
Emits engine.Gap rows (gap_type 's4_load') whose detail starts with the S4L rule id."""
from __future__ import annotations

from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypedDict

import pandas as pd
import yaml

from api.services.migration.engine import Gap, ModuleResult, _BLOCKING, verdict_for
from checks.base import record_keys
from checks.frames import TableFrames

_FILE = Path(__file__).resolve().parents[3] / "sap" / "dictionaries" / "migration" / "s4_load_rules.yaml"
_AFLE_EDGE = 0.95 * 10 ** 11  # flag amounts at or above 95% of the 11-digit CURR 13,2 limit

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


class RecordStatus(TypedDict):
    record_key: str
    source_table: str
    status: Literal["load_ready", "load_fail"]
    reasons: list[str]


def simulate(frames: TableFrames, module: str, grouping_map: dict[str, str]) -> list[Gap]:
    """Run checks relevant to the module's tables."""
    return (check_matnr(frames, module) + check_cvi(frames, module, grouping_map) + check_credit(frames, module)
            + check_mrp_area(frames, module) + check_material_ledger(frames, module)
            + check_simplification(frames, module))


def fold(res: ModuleResult, sim: list[Gap]) -> ModuleResult:
    """Update ModuleResult with simulation gaps."""
    blocked: dict[str, set[str]] = {}
    for g in sim:
        if g.severity in _BLOCKING and g.record_key and g.source_table:
            blocked.setdefault(g.source_table, set()).add(g.record_key)
    ready = {t: [k for k in ks if k not in blocked.get(t, set())] for t, ks in res.ready_keys.items()}
    n_blocked = res.records - sum(len(v) for v in ready.values())
    score, verdict = verdict_for(res.records, n_blocked, res.verdict == "no-go" and res.blocked_records == 0)
    counts = {**res.counts, "s4_load": res.counts.get("s4_load", 0) + len(sim)}
    return replace(res, blocked_records=n_blocked, score=score, verdict=verdict, counts=counts, ready_keys=ready)


def record_status(gaps: list[Gap]) -> list[RecordStatus]:
    """Convert gaps to record status entries."""
    out: dict[tuple[str, str], RecordStatus] = {}
    for g in gaps:
        if not g.record_key:
            continue
        r = out.setdefault((g.source_table or "", g.record_key),
                           RecordStatus(record_key=g.record_key, source_table=g.source_table or "",
                                        status="load_ready", reasons=[]))
        if g.severity in _BLOCKING:
            r["status"] = "load_fail"
            r["reasons"].append(g.detail)
    return sorted(out.values(), key=lambda r: (r["status"] != "load_fail", r["source_table"], r["record_key"]))


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


def check_credit(frames: TableFrames, module: str) -> list[Gap]:
    """S/4 credit management load checks: KNKK credit segment records with missing
    credit control area or customer number not in KNA1."""
    knkk = _frame(frames, "KNKK")
    kna1 = _frame(frames, "KNA1")
    if knkk is None:
        return []
    cust = set(_norm(kna1["KUNNR"])) if kna1 is not None else set()
    bad = _norm(knkk["KKBER"]).eq("") | ~_norm(knkk["KUNNR"]).isin(cust)
    return _gaps("S4L-CRM-KNKK", module, "KNKK", "KKBER", bad, knkk, _norm(knkk["KKBER"]))


def check_mrp_area(frames: TableFrames, module: str) -> list[Gap]:
    """S/4 MRP area load checks: MARD storage location-material combinations with
    MRP exclusion set (DISKZ) but the storage location itself not configured as
    MRP-excluded in T001L/MDLG."""
    mard = _frame(frames, "MARD")
    t001l = _frame(frames, "T001L")
    if mard is None or "DISKZ" not in mard.columns:
        return []
    # Collect storage locations that are MRP-excluded in T001L
    loc_excl = set()
    if t001l is not None and "DISKZ" in t001l.columns:
        t = t001l[_norm(t001l["DISKZ"]) != ""]
        loc_excl = set(_norm(t["WERKS"]) + "|" + _norm(t["LGORT"]))
    loc = _norm(mard["WERKS"]) + "|" + _norm(mard["LGORT"])
    bad = (_norm(mard["DISKZ"]) != "") & ~loc.isin(loc_excl)
    return _gaps("S4L-MRP-AREA", module, "MARD", "DISKZ", bad, mard, _norm(mard["DISKZ"]))


def check_material_ledger(frames: TableFrames, module: str) -> list[Gap]:
    """S/4 material ledger load checks: MBEW valuation records with stock but missing
    valuation class or missing price/cost valuation strategy."""
    mbew = _frame(frames, "MBEW")
    if mbew is None:
        return []
    # Handle missing LBKUM column by returning zero Series
    lbkum = pd.to_numeric(mbew["LBKUM"], errors="coerce").fillna(0) if "LBKUM" in mbew.columns else pd.Series(0, index=mbew.index)
    stock = lbkum > 0
    bklas = _norm(mbew["BKLAS"]) if "BKLAS" in mbew.columns else pd.Series("", index=mbew.index)
    vprsv = _norm(mbew["VPRSV"]) if "VPRSV" in mbew.columns else pd.Series("", index=mbew.index)
    # Handle missing STPRS/VERPR columns by returning zero Series
    stprs = pd.to_numeric(mbew["STPRS"], errors="coerce").fillna(0) if "STPRS" in mbew.columns else pd.Series(0, index=mbew.index)
    verpr = pd.to_numeric(mbew["VERPR"], errors="coerce").fillna(0) if "VERPR" in mbew.columns else pd.Series(0, index=mbew.index)
    price = stprs + verpr
    no_class = stock & bklas.eq("")
    out = _gaps("S4L-ML-BKLAS", module, "MBEW", "BKLAS", no_class, mbew)
    out += _gaps("S4L-ML-PRICE", module, "MBEW", "VPRSV", stock & ~no_class & (vprsv.eq("") | price.le(0)), mbew)
    return out


def check_simplification(frames: TableFrames, module: str) -> list[Gap]:
    """S/4 simplification load checks: KONV orphans, AFLE edge cases, NAST open output
    determination records."""
    out: list[Gap] = []
    konv = _frame(frames, "KONV")
    if konv is not None:
        heads = set()
        for t in ("VBAK", "EKKO"):
            h = _frame(frames, t)
            if h is not None and "KNUMV" in h.columns:
                heads |= set(_norm(h["KNUMV"]))
        if heads and "KNUMV" in konv.columns:  # only judge orphans when at least one header table was extracted and KONV has KNUMV
            out += _gaps("S4L-SD-KONV-ORPHAN", module, "KONV", "KNUMV", ~_norm(konv["KNUMV"]).isin(heads), konv)
        if "KWERT" in konv.columns:
            kw = pd.to_numeric(konv["KWERT"], errors="coerce").abs()
            out += _gaps("S4L-FI-AFLE", module, "KONV", "KWERT", kw.ge(_AFLE_EDGE).fillna(False), konv, kw)
    nast = _frame(frames, "NAST")
    if nast is not None and "VSTAT" in nast.columns:
        out += _gaps("S4L-OUT-NAST-OPEN", module, "NAST", "VSTAT", _norm(nast["VSTAT"]).eq("0"), nast)
    return out

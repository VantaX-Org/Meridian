"""Material 360: one material read out of an analysis version's extracted tables.

Pure functions over ``{TABLE: DataFrame}`` (plain field names, one frame per SAP
table) so every rule of the page is testable without MinIO or Postgres. The
routes in api/routes/materials.py load the tables and the tenant's
finding_records and call these.

The supersession walk mirrors MM544-MM552 (follow-up material inside one plant)
so the diagram and the rule results always agree.
"""

from __future__ import annotations

import io
import re
import os
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import pandas as pd
import yaml

from checks.frames import unprefix

_ROOT = Path(__file__).resolve().parents[2]
MODULE = "material_master"
CHAIN_DEPTH = 3          # MM552 limit
DUP_THRESHOLD = 60
DUP_ALGORITHM = ("similarity_check: sorted-word description keys, difflib ratio; "
                 "different numbers never match; plus EAN, old material number and manufacturer part number")

# Tables the endpoints read. T134, T134T, T023T, T006A, STPO, MAST are optional.
CORE_TABLES = ("MARA", "MAKT", "MARM", "MEAN", "MARC", "MVKE", "MBEW", "MARD", "MLGN")
OPTIONAL_TABLES = ("T134", "T134T", "T023T", "T006A", "STPO", "MAST")

# SAP field lists returned per table (a whitelist: the page never ships a whole row).
_FIELDS = {
    "MARA": ("MATNR", "MTART", "MATKL", "MEINS", "ERSDA", "ERNAM", "LAEDA", "LVORM", "MSTAE", "MSTDE", "VPSTA",
             "PSTAT", "BISMT", "MFRPN", "MFRNR", "BRGEW", "NTGEW", "GEWEI"),
    "MAKT": ("SPRAS", "MAKTX"),
    "MARM": ("MEINH", "UMREZ", "UMREN"),
    "MEAN": ("MEINH", "EAN11", "EANTP"),
    "MARC": ("WERKS", "PSTAT", "MMSTA", "MMSTD", "LVORM", "KZAUS", "AUSDT", "NFMAT", "DISMM", "DISPO", "BESKZ"),
    "MVKE": ("VKORG", "VTWEG", "VMSTA", "VMSTD", "LVORM"),
    "MBEW": ("BWKEY", "BWTAR", "BKLAS", "VPRSV", "LVORM"),
    "MARD": ("WERKS", "LGORT", "LVORM"),
    "MLGN": ("LGNUM", "LVORM"),
}
_DATES = {"ERSDA", "LAEDA", "MSTDE", "MMSTD", "AUSDT", "VMSTD"}

# MM01 maintenance views of the matrix, in screen order. ids match checks/views/material_master.yaml.
MATRIX_VIEWS = (("basic_data", "Basic data"), ("classification", "Classification"), ("sales", "Sales"),
                ("purchasing", "Purchasing"), ("mrp", "MRP"), ("work_scheduling", "Work scheduling"),
                ("storage", "Storage"), ("quality", "Quality"), ("accounting", "Accounting"))
# MARA.VPSTA / MARC.PSTAT letters (DDIC domain PSTAT_D) to the matrix row that shows them.
PSTAT_ROW = {"K": "basic_data", "C": "classification", "V": "sales", "E": "purchasing", "D": "mrp", "P": "mrp",
             "A": "work_scheduling", "L": "storage", "S": "storage", "X": "storage", "Z": "storage",
             "Q": "quality", "B": "accounting", "G": "accounting"}
# Which levels carry which rows. A level that does not carry a row shows "none".
_CARRIES = {"client": {"basic_data", "classification"},
            "plant": {"purchasing", "mrp", "work_scheduling", "storage", "quality"},
            "sales": {"sales"}, "valuation": {"accounting"}, "sloc": {"storage"}, "warehouse": {"storage"}}
_LEVEL_ORDER = ("client", "plant", "sales", "valuation", "sloc", "warehouse")


# ── value helpers ────────────────────────────────────────────────────────────

def norm_matnr(m: str) -> str:
    """SAP internal form: numeric material numbers are zero-padded to 18."""
    m = (m or "").strip()
    return m.zfill(18) if m.isdigit() and len(m) < 18 else m


def _s(v: Any) -> Optional[str]:
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if isinstance(v, pd.Timestamp):
        return v.date().isoformat()
    t = str(v).strip()
    return t or None


def _d(v: Any) -> Optional[str]:
    """Date value to ISO yyyy-mm-dd; blank and SAP's 00000000 become None."""
    t = _s(v)
    if not t or set(t) <= set("0-"):
        return None
    if t.isdigit() and len(t) == 8:
        return f"{t[:4]}-{t[4:6]}-{t[6:]}"
    return t[:10]


def _rows(df: Optional[pd.DataFrame], table: str) -> list[dict]:
    if df is None or df.empty:
        return []
    cols = [c for c in _FIELDS[table] if c in df.columns]
    return [{c: (_d(r[c]) if c in _DATES else _s(r[c])) for c in cols} for r in df[cols].to_dict("records")]


def _for(tables: dict[str, pd.DataFrame], t: str, matnr: str, col: str = "MATNR") -> pd.DataFrame:
    df = tables.get(t)
    if df is None or col not in df.columns:
        return pd.DataFrame()
    s = df[col].astype("string").str.strip()
    return df[(s == matnr) | (s == matnr.lstrip("0")) | (s.str.zfill(18) == matnr)]


def _blank(v: Any) -> bool:
    return _s(v) is None


# ── view map (single source: checks/views/material_master.yaml) ──────────────

@lru_cache(maxsize=1)
def rule_catalogue() -> dict[str, dict]:
    """Material master rules: id -> {id, message, severity, dimension, field, table, view, view_label}."""
    rules = yaml.safe_load((_ROOT / "checks" / "rules" / "ecc" / "material_master.yaml").read_text("utf-8"))["rules"]
    vm = yaml.safe_load((_ROOT / "checks" / "views" / "material_master.yaml").read_text("utf-8"))
    labels = {v["id"]: v["label"] for v in vm["views"]}
    listed = {rid: v["id"] for v in vm["views"] for rid in v["rules"]}
    fallback = vm.get("default_view_by_table") or {}
    out = {}
    for r in rules:
        f = r.get("field") or ""
        f = f[0] if isinstance(f, list) else f
        table = f.split(".")[0] if "." in f else ""
        view = listed.get(r["id"]) or fallback.get(table) or "basic_data"
        out[str(r["id"])] = {
            "id": str(r["id"]), "message": r.get("message") or r["id"], "severity": r.get("severity", "medium"),
            "dimension": r.get("dimension"), "field": f or None, "table": table or None,
            "view": view, "view_label": labels.get(view, view), "template": r.get("record_fix_template"),
            "check_class": r.get("check_class"),
        }
    return out


@lru_cache(maxsize=1)
def view_order() -> tuple[tuple[str, str], ...]:
    vm = yaml.safe_load((_ROOT / "checks" / "views" / "material_master.yaml").read_text("utf-8"))
    return tuple((v["id"], v["label"]) for v in vm["views"])


# ── levels and the view matrix ───────────────────────────────────────────────

def _levels(slices: dict[str, pd.DataFrame], extra_sales: tuple = ()) -> list[dict]:
    """Organisational levels the material exists at. id = kind:code, e.g. plant:1000, sales:2000/10."""
    out = [{"id": "client", "kind": "client", "plant": None}]
    marc, mvke, mbew = slices["MARC"], slices["MVKE"], slices["MBEW"]
    for _, r in marc.iterrows():
        out.append({"id": f"plant:{_s(r['WERKS'])}", "kind": "plant", "plant": _s(r["WERKS"])})
    for _, r in mvke.iterrows():
        out.append({"id": f"sales:{_s(r['VKORG'])}/{_s(r['VTWEG'])}", "kind": "sales", "plant": None})
    for _, r in mbew.iterrows():
        bw = _s(r["BWKEY"])
        split = _s(r["BWTAR"]) if "BWTAR" in mbew.columns else None
        out.append({"id": f"valuation:{bw}" + (f"/{split}" if split else ""), "kind": "valuation", "plant": bw})
    for org in extra_sales:  # sales orgs used elsewhere in the extract: shown so a missing sales view is visible
        out.append({"id": f"sales:{org}", "kind": "sales", "plant": None})
    for _, r in slices["MARD"].iterrows():
        out.append({"id": f"sloc:{_s(r['WERKS'])}/{_s(r['LGORT'])}", "kind": "sloc", "plant": _s(r["WERKS"])})
    for _, r in slices["MLGN"].iterrows():
        out.append({"id": f"warehouse:{_s(r['LGNUM'])}", "kind": "warehouse", "plant": None})
    seen, uniq = set(), []
    for lv in out:
        if lv["id"] not in seen:
            seen.add(lv["id"])
            uniq.append(lv)
    return sorted(uniq, key=lambda lv: _LEVEL_ORDER.index(lv["kind"]))


def _letters(v: Any) -> set[str]:
    return set(_s(v) or "")


def _maintained(level: dict, slices: dict[str, pd.DataFrame]) -> set[str]:
    """Matrix rows that are maintained at this level."""
    kind, lid = level["kind"], level["id"]
    if kind == "client":
        return {PSTAT_ROW[c] for c in _letters(slices["MARA"]["VPSTA"].iloc[0] if "VPSTA" in slices["MARA"] else None)
                if c in PSTAT_ROW and PSTAT_ROW[c] in _CARRIES["client"]}
    if kind == "plant":
        marc = slices["MARC"]
        row = marc[marc["WERKS"].astype("string").str.strip() == level["plant"]]
        letters = _letters(row["PSTAT"].iloc[0]) if len(row) and "PSTAT" in row else set()
        return {PSTAT_ROW[c] for c in letters if c in PSTAT_ROW and PSTAT_ROW[c] in _CARRIES["plant"]}
    if kind == "sales":
        mvke = slices["MVKE"]
        have = {f"{_s(r['VKORG'])}/{_s(r['VTWEG'])}" for _, r in mvke.iterrows()}
        return {"sales"} if lid.split(":", 1)[1] in have else set()
    return set(_CARRIES[kind])  # a valuation, valuation, storage location or warehouse row exists = its view is maintained


def expected_views(tables: dict[str, pd.DataFrame], mtart: Optional[str]) -> Optional[list[str]]:
    """Matrix rows SAP expects for the material type (T134.PSTAT), None when T134 is not loaded."""
    t134 = tables.get("T134")
    if t134 is None or mtart is None or "MTART" not in t134.columns or "PSTAT" not in t134.columns:
        return None
    row = t134[t134["MTART"].astype("string").str.strip() == mtart]
    if row.empty:
        return None
    return sorted({PSTAT_ROW[c] for c in _letters(row["PSTAT"].iloc[0]) if c in PSTAT_ROW})


def matrix(levels: list[dict], slices: dict[str, pd.DataFrame], expected: Optional[list[str]]) -> list[dict]:
    """[{view, label, expected, cells: [{level, state}]}]. states: ok, missing, na, none (failing is added client-side)."""
    done = {lv["id"]: _maintained(lv, slices) for lv in levels}
    rows = []
    for vid, label in MATRIX_VIEWS:
        cells = []
        for lv in levels:
            if vid not in _CARRIES[lv["kind"]]:
                state = "none"
            elif vid in done[lv["id"]]:
                state = "ok"
            elif expected is None:
                state = "none"
            else:
                state = "missing" if vid in expected else "na"
            cells.append({"level": lv["id"], "state": state})
        is_expected = None if expected is None else vid in expected
        if any(c["state"] in ("ok", "missing") for c in cells) or is_expected:
            rows.append({"view": vid, "label": label, "expected": is_expected, "cells": cells})
    return rows


def _label(tables: dict[str, pd.DataFrame], table: str, key: str, value: Optional[str], text_col: str,
           extra: Optional[tuple[str, str]] = None) -> Optional[str]:
    df = tables.get(table)
    if df is None or value is None or key not in df.columns or text_col not in df.columns:
        return None
    m = df[df[key].astype("string").str.strip() == value]
    if extra and extra[0] in m.columns:
        m = m[m[extra[0]].astype("string").str.strip() == extra[1]]
    return _s(m[text_col].iloc[0]) if len(m) else None


def pick_description(makt: pd.DataFrame) -> tuple[Optional[str], Optional[str]]:
    """(MAKT.MAKTX, SPRAS) in the logon language: English, else the first description."""
    if makt.empty or "MAKTX" not in makt.columns:
        return None, None
    lang = makt["SPRAS"].astype("string").str.strip().str.upper() if "SPRAS" in makt.columns else pd.Series("", index=makt.index)
    pick = makt[lang.isin(["E", "EN"])]
    row = (pick if len(pick) else makt).iloc[0]
    return _s(row["MAKTX"]), _s(row["SPRAS"]) if "SPRAS" in makt.columns else None


def slices_of(tables: dict[str, pd.DataFrame], matnr: str) -> dict[str, pd.DataFrame]:
    return {t: _for(tables, t, matnr) for t in CORE_TABLES}


def phasing(marc: pd.DataFrame) -> dict:
    """Plants with KZAUS set, and whether any has a follow-up (Tally 'Plants phasing out')."""
    if marc.empty or "KZAUS" not in marc.columns:
        return {"plants": len(marc), "phasing_out": 0, "with_followup": 0, "first": None}
    out = marc[~marc["KZAUS"].map(_blank)]
    follow = out[~out["NFMAT"].map(_blank)] if "NFMAT" in out.columns else out.iloc[0:0]
    first = out.iloc[0] if len(out) else None
    return {"plants": len(marc), "phasing_out": len(out), "with_followup": len(follow),
            "first": None if first is None else {
                "plant": _s(first["WERKS"]), "ausdt": _d(first["AUSDT"]) if "AUSDT" in out.columns else None,
                "nfmat": _s(first["NFMAT"]) if "NFMAT" in out.columns else None}}


def build_material(tables: dict[str, pd.DataFrame], matnr: str) -> Optional[dict]:
    """The Material360 payload, or None when the material is not in MARA."""
    sl = slices_of(tables, matnr)
    if sl["MARA"].empty:
        return None
    mara = _rows(sl["MARA"], "MARA")[0]
    desc, lang = pick_description(sl["MAKT"])
    exp = expected_views(tables, mara.get("MTART"))
    extra: tuple = ()
    mv = tables.get("MVKE")
    if exp and "sales" in exp and mv is not None and {"VKORG", "VTWEG"} <= set(mv.columns):
        mine = {f"{_s(r['VKORG'])}/{_s(r['VTWEG'])}" for _, r in sl["MVKE"].iterrows()}
        # ponytail: every sales org in the extract counts; narrow by the plant's assigned sales orgs (TVKWZ) when loaded
        extra = tuple(sorted({f"{_s(r['VKORG'])}/{_s(r['VTWEG'])}" for _, r in mv.iterrows()} - mine))
    levels = _levels(sl, extra)
    p = phasing(sl["MARC"])
    fu = p["first"]
    nf_desc = None
    if fu and fu["nfmat"]:
        nf_desc = pick_description(_for(tables, "MAKT", norm_matnr(fu["nfmat"])))[0]
    return {
        "matnr": mara.get("MATNR") or matnr, "description": desc, "language": lang, "mara": mara,
        "makt": _rows(sl["MAKT"], "MAKT"), "marm": _rows(sl["MARM"], "MARM"), "mean": _rows(sl["MEAN"], "MEAN"),
        "marc": _rows(sl["MARC"], "MARC"), "mvke": _rows(sl["MVKE"], "MVKE"), "mbew": _rows(sl["MBEW"], "MBEW"),
        "mard": _rows(sl["MARD"], "MARD"), "mlgn": _rows(sl["MLGN"], "MLGN"),
        "labels": {
            "MTART": _label(tables, "T134T", "MTART", mara.get("MTART"), "MTBEZ"),
            "MATKL": _label(tables, "T023T", "MATKL", mara.get("MATKL"), "WGBEZ"),
            "MEINS": _label(tables, "T006A", "MSEHI", mara.get("MEINS"), "MSEHT"),
        },
        "expected_views": exp, "expected_known": exp is not None,
        "levels": levels,
        "views": matrix(levels, sl, exp),
        "phasing": {"plants": p["plants"], "phasing_out": p["phasing_out"], "with_followup": p["with_followup"],
                    "plant": fu and fu["plant"], "ausdt": fu and fu["ausdt"], "nfmat": fu and fu["nfmat"],
                    "followup_description": nf_desc},
    }


def cap_levels(levels: list[dict], plant: Optional[str], cap: int = 12) -> tuple[list[dict], int]:
    """(shown levels, total). ``plant`` keeps client, sales and warehouse levels plus that plant's own."""
    if plant:
        levels = [lv for lv in levels if lv["plant"] in (None, plant)]
    return levels[:cap], len(levels)


# ── supersession ─────────────────────────────────────────────────────────────

def _marc_row(marc: pd.DataFrame, plant: str) -> Optional[pd.Series]:
    if marc.empty or "WERKS" not in marc.columns:
        return None
    m = marc[marc["WERKS"].astype("string").str.strip() == plant]
    return m.iloc[0] if len(m) else None


def _node(tables: dict, matnr: str, plant: str, row: Optional[pd.Series], this: bool = False) -> dict:
    mara = _for(tables, "MARA", matnr)
    flags: list[str] = []
    if row is None:
        flags.append("MM544")
        if mara.empty:
            flags.append("MM545")
    else:
        if not mara.empty and "LVORM" in mara.columns and _s(mara["LVORM"].iloc[0]) == "X":
            flags.append("MM546")
        if "LVORM" in row.index and _s(row["LVORM"]) == "X":
            flags.append("MM547")
        if "MMSTA" in row.index and not _blank(row["MMSTA"]) and not this:
            flags.append("MM548")
        if "DISMM" in row.index and _s(row["DISMM"]) == "ND" and not this:
            flags.append("MM549")
    g = (lambda c: _s(row[c]) if row is not None and c in row.index else None)
    return {"matnr": matnr, "maktx": pick_description(_for(tables, "MAKT", matnr))[0], "this": this,
            "dismm": g("DISMM"), "mmsta": g("MMSTA"), "kzaus": g("KZAUS"),
            "ausdt": _d(row["AUSDT"]) if row is not None and "AUSDT" in row.index else None,
            "nfmat": g("NFMAT"), "flags": flags}


def walk_chain(tables: dict[str, pd.DataFrame], matnr: str, plant: str, depth: int = CHAIN_DEPTH) -> dict:
    """Follow MARC.NFMAT inside one plant. Links = arrows, a closing loop arrow included."""
    marc = tables.get("MARC", pd.DataFrame())
    start = _node(tables, matnr, plant, _marc_row(_for(tables, "MARC", matnr), plant), this=True)
    chain, seen = [start], [matnr]
    loop_at, dead_end, truncated, links = None, False, False, 0
    cur = start
    while cur["nfmat"]:
        if links == depth:
            truncated = True
            break
        nxt = norm_matnr(cur["nfmat"])
        links += 1
        if nxt in seen:
            loop_at = nxt
            cur["flags"].append("MM551")
            break
        seen.append(nxt)
        cur = _node(tables, nxt, plant, _marc_row(_for(tables, "MARC", nxt), plant))
        chain.append(cur)
    else:
        if cur is not start and cur["kzaus"]:
            dead_end = True
            cur["flags"].append("MM550")
    if truncated:
        cur["flags"].append("MM552")
    return {"chain": chain, "links": links, "loop_at": loop_at, "dead_end": dead_end, "truncated": truncated,
            "depth": depth}


def bom_usage(tables: dict[str, pd.DataFrame], matnr: str) -> Optional[list[dict]]:
    """STPO rows that use this material as a component; None when STPO is not in the extract."""
    stpo = tables.get("STPO")
    if stpo is None or "IDNRK" not in stpo.columns:
        return None
    rows = _for(tables, "STPO", matnr, "IDNRK")
    marc = _for(tables, "MARC", matnr)
    discontinued = "KZAUS" in marc.columns and bool((~marc["KZAUS"].map(_blank)).any())
    mast = tables.get("MAST")
    plants = {}
    if mast is not None and {"STLNR", "WERKS"} <= set(mast.columns):
        plants = {_s(r["STLNR"]): _s(r["WERKS"]) for r in mast.to_dict("records")}
    g = lambda r, c: _s(r.get(c))  # noqa: E731
    out = []
    for r in rows.to_dict("records"):
        flags = []
        if discontinued and not g(r, "NFGRP") and not g(r, "LKENZ"):
            flags.append("MM560")
        if g(r, "KZNFP") == "X" and not g(r, "NFGRP"):
            flags.append("MM563")
        out.append({"stlnr": g(r, "STLNR"), "posnr": g(r, "POSNR") or g(r, "STLKN"),
                    "werks": plants.get(g(r, "STLNR")), "nfeag": g(r, "NFEAG"), "nfgrp": g(r, "NFGRP"),
                    "flags": flags})
    return out


def build_supersession(tables: dict[str, pd.DataFrame], matnr: str, plant: Optional[str] = None,
                       depth: int = CHAIN_DEPTH) -> Optional[dict]:
    """{plants: [{werks, kzaus, ausdt, chain, ...}], bom_usage}; None when the material is unknown."""
    if _for(tables, "MARA", matnr).empty:
        return None
    marc = _for(tables, "MARC", matnr)
    plants = []
    for _, r in marc.iterrows():
        w = _s(r["WERKS"])
        if plant and w != plant:
            continue
        walked = walk_chain(tables, matnr, w, depth)
        plants.append({"werks": w, "kzaus": _s(r["KZAUS"]) if "KZAUS" in marc.columns else None,
                       "ausdt": _d(r["AUSDT"]) if "AUSDT" in marc.columns else None, **walked})
    return {"plants": plants, "bom_usage": bom_usage(tables, matnr)}


# ── duplicates ───────────────────────────────────────────────────────────────

def _desc_key(s: Optional[str]) -> str:
    from checks.types.similarity_check import _key
    return str(_key(pd.Series([s or ""])).iloc[0])


def _descriptions(makt: pd.DataFrame) -> dict[str, str]:
    """MATNR -> MAKT.MAKTX in English, else the first one found."""
    if makt.empty or "MAKTX" not in makt.columns:
        return {}
    df = makt.assign(_m=makt["MATNR"].astype("string").str.strip())
    pref = df["SPRAS"].astype("string").str.strip().str.upper().isin(["E", "EN"]) if "SPRAS" in df.columns else False
    df = df.assign(_p=~pref).sort_values("_p", kind="stable").drop_duplicates("_m")
    return {r["_m"]: _s(r["MAKTX"]) or "" for r in df.to_dict("records")}


def score_pair(desc_a: str, desc_b: str) -> Optional[float]:
    """Description similarity 0-100, None when the names carry different numbers or are too short to compare."""
    ka, kb = _desc_key(desc_a), _desc_key(desc_b)
    if len(ka.replace(" ", "")) < 5 or len(kb.replace(" ", "")) < 5:
        return None
    if "".join(c for c in ka if c.isdigit()) != "".join(c for c in kb if c.isdigit()):
        return None
    return round(100 * SequenceMatcher(None, ka, kb).ratio(), 1)


def build_duplicates(tables: dict[str, pd.DataFrame], matnr: str, limit: int = 20) -> Optional[dict]:
    """Other materials that match on description, EAN, old material number or manufacturer part number."""
    mara = tables.get("MARA", pd.DataFrame())
    mine = _for(tables, "MARA", matnr)
    if mine.empty:
        return None
    me = mine.iloc[0]
    descs = _descriptions(tables.get("MAKT", pd.DataFrame()))
    my_desc = descs.get(matnr) or descs.get(matnr.lstrip("0")) or ""
    mean = tables.get("MEAN", pd.DataFrame())
    my_eans = set(_for(tables, "MEAN", matnr)["EAN11"].map(_s).dropna()) if "EAN11" in mean.columns and len(mean) else set()
    ean_of: dict[str, set[str]] = {}
    if my_eans:
        for r in mean[mean["EAN11"].map(_s).isin(my_eans)].to_dict("records"):
            ean_of.setdefault(_s(r["MATNR"]), set()).add(_s(r["EAN11"]))
    m = mara.assign(_m=mara["MATNR"].astype("string").str.strip())
    mine_key = str(me["MATNR"]).strip()
    my_bismt, my_mfr = _s(me.get("BISMT")), (_s(me.get("MFRPN")), _s(me.get("MFRNR")))
    cand: dict[str, dict] = {}
    # ponytail: description scan is limited to the same material group (5,000 materials); wider blocking if groups are huge
    block = m[(m["_m"] != mine_key)]
    if "MATKL" in block.columns and _s(me.get("MATKL")):
        same = block[block["MATKL"].astype("string").str.strip() == _s(me["MATKL"])]
    else:
        same = block.iloc[0:0]
    for r in same.head(5000).to_dict("records"):
        s = score_pair(my_desc, descs.get(r["_m"], ""))
        if s is not None and s >= DUP_THRESHOLD:
            cand.setdefault(r["_m"], {"row": r, "evidence": {}})["evidence"]["description"] = s
    for k in ean_of:
        if k != mine_key and k in set(m["_m"]):
            cand.setdefault(k, {"row": m[m["_m"] == k].iloc[0].to_dict(), "evidence": {}})["evidence"]["ean"] = 100.0
    for r in block.to_dict("records"):
        if my_bismt and _s(r.get("BISMT")) and norm_matnr(_s(r["BISMT"])) == mine_key or \
                (_s(r.get("BISMT")) and my_bismt and norm_matnr(my_bismt) == r["_m"]):
            cand.setdefault(r["_m"], {"row": r, "evidence": {}})["evidence"]["old_number"] = 90.0
        if my_mfr[0] and my_mfr[1] and (_s(r.get("MFRPN")), _s(r.get("MFRNR"))) == my_mfr:
            cand.setdefault(r["_m"], {"row": r, "evidence": {}})["evidence"]["mfr_part"] = 90.0
    items = []
    for k, c in cand.items():
        r, ev = c["row"], c["evidence"]
        score = max(ev.values())
        if score < DUP_THRESHOLD:
            continue
        on = []
        if "description" in ev:
            on.append(f"Description {round(ev['description'])} %")
        if "ean" in ev:
            on.append("EAN same")
        if "old_number" in ev:
            on.append("Old material number")
        if "mfr_part" in ev:
            on.append("Manufacturer part same")
        eans = sorted(ean_of.get(k, set()) or set(_for(tables, "MEAN", k)["EAN11"].map(_s).dropna())
                      if "EAN11" in mean.columns and len(mean) else [])
        items.append({"matnr": k, "maktx": descs.get(k), "mtart": _s(r.get("MTART")), "matkl": _s(r.get("MATKL")),
                      "meins": _s(r.get("MEINS")), "ean11": eans[0] if eans else None, "matches_on": on,
                      "score": int(round(score))})
    items.sort(key=lambda i: (-i["score"], i["matnr"]))
    return {"algorithm": DUP_ALGORITHM, "threshold": DUP_THRESHOLD, "source": "computed", "items": items[:limit]}


# ── findings per view ────────────────────────────────────────────────────────

def parse_key(record_key: str) -> dict[str, str]:
    return dict(p.split("=", 1) for p in (record_key or "").split("|") if "=" in p)


def level_of(key: dict[str, str]) -> str:
    if key.get("LGORT") and key.get("WERKS"):
        return f"sloc:{key['WERKS']}/{key['LGORT']}"
    if key.get("VKORG"):
        return f"sales:{key['VKORG']}/{key.get('VTWEG', '')}"
    if key.get("BWKEY"):
        return f"valuation:{key['BWKEY']}" + (f"/{key['BWTAR']}" if key.get("BWTAR") else "")
    if key.get("LGNUM"):
        return f"warehouse:{key['LGNUM']}"
    if key.get("WERKS"):
        return f"plant:{key['WERKS']}"
    return "client"


# Tables without a material key column: the table whose rows tell whether the material has this data at all.
_PROXY = {"KLAH": "KSSK", "CABN": "KSSK", "CAWN": "KSSK", "EINE": "EINA"}
_KEY_COL = {"STPO": "IDNRK", "AUSP": "OBJEK", "KSSK": "OBJEK", "INOB": "OBJEK"}


def present_tables(tables: dict[str, pd.DataFrame], matnr: str) -> set[str]:
    """Tables in which this material has at least one row (rules anchored there are 'evaluated')."""
    have = set()
    for t, df in tables.items():
        col = _KEY_COL.get(t, "MATNR")
        if col == "OBJEK":
            if col in df.columns and df[col].astype("string").str.strip().str.startswith(matnr).any():
                have.add(t)
        elif len(_for(tables, t, matnr, col)):
            have.add(t)
    return have | {t for t, p in _PROXY.items() if p in have}


def build_findings(failing: list[dict], issues: dict[tuple[str, str], dict], present: set[str],
                   known_tables: set[str]) -> dict:
    """Group failing records by view; passing and not-evaluated counts make the three sum to every enabled rule.

    ``failing``: [{check_id, record_key, field_values}], ``issues``: (check_id, record_key) -> {id, status}.
    ``present``: tables the material has rows in; ``known_tables``: tables the extract holds at all.
    """
    cat = rule_catalogue()
    by_rule: dict[str, list[dict]] = {}
    for f in failing:
        if f["check_id"] in cat:
            by_rule.setdefault(f["check_id"], []).append(f)
    views = {vid: {"view": vid, "label": label, "failing": [], "passing_count": 0, "not_evaluated": []}
             for vid, label in view_order()}
    for rid, meta in cat.items():
        v = views[meta["view"]]
        if rid in by_rule:
            for f in by_rule[rid]:
                key = parse_key(f["record_key"])
                vals = f.get("field_values") or {}
                actual = vals.get(meta["field"]) if meta["field"] in vals else next(iter(vals.values()), None)
                iss = issues.get((rid, f["record_key"])) or {}
                v["failing"].append({
                    "check_id": rid, "message": meta["message"], "severity": meta["severity"], "field": meta["field"],
                    "level": level_of(key), "actual_value": None if actual is None else str(actual),
                    "record_key": f["record_key"], "issue_id": iss.get("id"), "issue_status": iss.get("status"),
                    "record_fix": _fix_text(meta.get("template"), vals, actual, key)})
        elif meta["table"] and meta["table"] in known_tables and meta["table"] not in present:
            v["not_evaluated"].append(rid)
        else:
            v["passing_count"] += 1
    sev = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    for v in views.values():
        v["failing"].sort(key=lambda r: (sev.get(r["severity"], 4), r["check_id"], r["level"]))
        v["rules"] = sum(1 for m in cat.values() if m["view"] == v["view"])
    return {"by_view": list(views.values()), "rules_total": len(cat)}


def _fix_text(template: Optional[str], vals: dict, actual: Any, key: Optional[dict] = None) -> Optional[str]:
    """Fill {TABLE.FIELD} and {actual_value} in a record-fix template; a name with no value reads as 'this record'."""
    if not template:
        return None
    pool = {**(key or {}), **{str(k): v for k, v in vals.items()}}

    def fill(m: "re.Match[str]") -> str:
        name = m.group(1).strip()
        if name == "actual_value":
            return "blank" if actual in (None, "") else str(actual)
        for cand in (name, name.split(".")[-1]):
            if pool.get(cand) not in (None, ""):
                return str(pool[cand])
        return "this record"

    return re.sub(r"\{([^{}]*)\}", fill, template)


# ── dataset loading ──────────────────────────────────────────────────────────

def load_tables(path: str, dictionary, tables: set[str]) -> dict[str, pd.DataFrame]:
    """Plain-field frames for the named tables. Bundles read only those tables' parquet objects."""
    from workers.dataset import _client, _read, load_dataset, parquet_name
    out: dict[str, pd.DataFrame] = {}
    if path.endswith("/"):
        client, bucket = _client(), os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
        for t in tables:
            try:
                out[t] = unprefix(t, pd.read_parquet(io.BytesIO(_read(client, bucket, path + parquet_name(t)))))
            except Exception:  # noqa: BLE001 - table not in this extract (MinIO NoSuchKey)
                continue
    else:
        frames, _, _, _ = load_dataset(path, dictionary, [MODULE])
        out = {t: unprefix(t, f) for t, f in frames.frames.items() if t in tables}
    return out
    # ponytail: whole tables are read per request; push a MATNR filter into read_parquet or cache by version when extracts get large

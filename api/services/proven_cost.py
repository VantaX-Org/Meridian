"""Cost proven from transactions. Pure pandas, deterministic, no estimation rates:
every amount is a document value already in the extract. Each costed document is
anchored to a master-data key so attribution (finding_records) can name the check_ids."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import TypedDict

import pandas as pd

from checks.frames import TableFrames


class CostItem(TypedDict):
    doc_key: str
    master_key: str
    amount: float
    detail: str


@dataclass(frozen=True)
class MetricResult:
    metric: str
    amount: float = 0.0
    currency: str | None = None
    by_currency: dict[str, float] = field(default_factory=dict)
    documents: int = 0
    items: list[CostItem] = field(default_factory=list)


def _s(df: pd.DataFrame, col: str) -> pd.Series:
    return (df[col] if col in df.columns else pd.Series("", index=df.index)).astype("string").fillna("").str.strip()


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_numeric(df[col], errors="coerce").fillna(0.0) if col in df.columns else pd.Series(0.0, index=df.index)


def _date(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_datetime(_s(df, col).where(lambda s: ~s.isin(["", "00000000"])), format="%Y%m%d", errors="coerce")


def _get(frames: TableFrames, *names: str) -> list[pd.DataFrame] | None:
    out = [frames.frames.get(n) for n in names]
    return None if any(d is None or d.empty for d in out) else out


def _result(metric: str, rows: pd.DataFrame) -> MetricResult:
    """rows: doc_key, master_key, amount, currency, detail."""
    if rows.empty:
        return MetricResult(metric)
    by_cur = rows.groupby("currency")["amount"].sum().round(2).to_dict()
    cur = next(iter(by_cur)) if len(by_cur) == 1 else None
    items = [CostItem(doc_key=r.doc_key, master_key=r.master_key, amount=round(float(r.amount), 2), detail=r.detail)
             for r in rows.sort_values("amount", ascending=False).itertuples()]
    return MetricResult(metric, round(float(rows["amount"].sum()), 2), cur, by_cur,
                        int(rows["doc_key"].nunique()), items)


def late_pos(frames: TableFrames, today: date) -> MetricResult:
    got = _get(frames, "EKKO", "EKPO", "EKET")
    if got is None:
        return MetricResult("late_po")
    ekko, ekpo, eket = got
    sched = eket.assign(EBELN=_s(eket, "EBELN"), EBELP=_s(eket, "EBELP"), eindt=_date(eket, "EINDT"))
    due = sched.groupby(["EBELN", "EBELP"], as_index=False)["eindt"].min()
    ekbe = frames.frames.get("EKBE")
    if ekbe is not None and not ekbe.empty:
        gr = ekbe[_s(ekbe, "VGABE") == "1"].assign(EBELN=lambda d: _s(d, "EBELN"), EBELP=lambda d: _s(d, "EBELP"),
                                                   budat=lambda d: _date(d, "BUDAT"))
        first = gr.groupby(["EBELN", "EBELP"], as_index=False)["budat"].min()
        due = due.merge(first, on=["EBELN", "EBELP"], how="left")
    else:
        due["budat"] = pd.NaT
    ref = due["budat"].fillna(pd.Timestamp(today))
    due["days"] = (ref - due["eindt"]).dt.days
    late = due[due["days"] > 0]
    po = ekpo.assign(EBELN=_s(ekpo, "EBELN"), EBELP=_s(ekpo, "EBELP"), MATNR=_s(ekpo, "MATNR"),
                     WERKS=_s(ekpo, "WERKS"), amount=_num(ekpo, "NETWR"))
    hdr = ekko.assign(EBELN=_s(ekko, "EBELN"), LIFNR=_s(ekko, "LIFNR"), currency=_s(ekko, "WAERS"))
    df = late.merge(po, on=["EBELN", "EBELP"]).merge(hdr[["EBELN", "LIFNR", "currency"]], on="EBELN")
    df = df[df["MATNR"] != ""]
    marc = frames.frames.get("MARC")
    plifz_bad = pd.Series(True, index=df.index)
    if marc is not None and not marc.empty:
        m = marc.assign(MATNR=_s(marc, "MATNR"), WERKS=_s(marc, "WERKS"), plifz=_num(marc, "PLIFZ"))
        ok = set((m.loc[m["plifz"] > 0, "MATNR"] + "|" + m.loc[m["plifz"] > 0, "WERKS"]))
        plifz_bad = ~(df["MATNR"] + "|" + df["WERKS"]).isin(ok)
    eina, eine = frames.frames.get("EINA"), frames.frames.get("EINE")
    has_info = set()
    if eina is not None and eine is not None and not eina.empty:
        a = eina.assign(INFNR=_s(eina, "INFNR"), MATNR=_s(eina, "MATNR"), LIFNR=_s(eina, "LIFNR"))
        a = a[a["INFNR"].isin(set(_s(eine, "INFNR")))]
        has_info = set(a["MATNR"] + "|" + a["LIFNR"])
    no_eine = ~(df["MATNR"] + "|" + df["LIFNR"]).isin(has_info)
    df = df[plifz_bad | no_eine].assign(_p=plifz_bad, _e=no_eine)
    rows = pd.DataFrame({
        "doc_key": "EBELN=" + df["EBELN"] + "|EBELP=" + df["EBELP"],
        "master_key": "MATNR=" + df["MATNR"] + "|WERKS=" + df["WERKS"],
        "amount": df["amount"], "currency": df["currency"],
        "detail": df["days"].astype(int).astype(str) + " days late"
                  + df["_p"].map({True: "; PLIFZ blank/0", False: ""})
                  + df["_e"].map({True: "; no EINE info record", False: ""}),
    })
    return _result("late_po", rows)

"""Cost proven from transactions. Pure pandas, deterministic, no estimation rates:
every amount is a document value already in the extract. Each costed document is
anchored to a master-data key so attribution (finding_records) can name the check_ids."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from itertools import combinations
from typing import TypedDict

import pandas as pd

from api.services.lineage import parse_record_key
from checks.frames import TableFrames

logger = logging.getLogger("meridian.proven_cost")


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


@lru_cache(maxsize=256)
def _missing(col: str) -> None:
    """Logged once per field: an absent column reads as blank/0, which silently zeroes a metric
    if the frame shape is wrong (bare-name reads over TABLE.FIELD frames did exactly that)."""
    logger.warning(f"proven_cost: column {col} absent from the extract; read as blank")


def _s(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        _missing(col)
        return pd.Series("", index=df.index, dtype="string")
    return df[col].astype("string").fillna("").str.strip()


def _num(df: pd.DataFrame, col: str) -> pd.Series:
    if col not in df.columns:
        _missing(col)
        return pd.Series(0.0, index=df.index)
    return pd.to_numeric(df[col], errors="coerce").fillna(0.0)


def _date(df: pd.DataFrame, col: str) -> pd.Series:
    return pd.to_datetime(_s(df, col).where(lambda s: ~s.isin(["", "00000000"])), format="%Y%m%d", errors="coerce")


def _get(frames: TableFrames, *names: str) -> list[pd.DataFrame] | None:
    out = [frames.plain(n) for n in names]
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


def grir_uom_variance(frames: TableFrames) -> MetricResult:
    got = _get(frames, "EKKO", "EKPO", "EKBE", "RSEG", "MARA")
    if got is None:
        return MetricResult("grir_uom_variance")
    ekko, ekpo, ekbe, rseg, mara = got
    k = ["EBELN", "EBELP"]
    gr = ekbe[_s(ekbe, "VGABE") == "1"]
    gr = gr.assign(EBELN=_s(gr, "EBELN"), EBELP=_s(gr, "EBELP"),
                   v=_num(gr, "DMBTR") * _s(gr, "SHKZG").map({"H": -1.0}).fillna(1.0))
    ir = rseg.assign(EBELN=_s(rseg, "EBELN"), EBELP=_s(rseg, "EBELP"), v=_num(rseg, "WRBTR"))
    bal = (gr.groupby(k)["v"].sum().rename("gr").to_frame()
           .join(ir.groupby(k)["v"].sum().rename("ir"), how="outer").fillna(0.0).reset_index())
    bal["amount"] = (bal["gr"] - bal["ir"]).abs()
    bal = bal[bal["amount"] > 0.01]
    po = ekpo.assign(EBELN=_s(ekpo, "EBELN"), EBELP=_s(ekpo, "EBELP"), MATNR=_s(ekpo, "MATNR"),
                     meins=_s(ekpo, "MEINS"), bprme=_s(ekpo, "BPRME"))
    base = dict(zip(_s(mara, "MATNR"), _s(mara, "MEINS")))
    marm = frames.plain("MARM")
    conv: dict[str, tuple[float, float]] = {}
    if marm is not None and not marm.empty:
        conv = dict(zip(_s(marm, "MATNR") + "|" + _s(marm, "MEINH"), zip(_num(marm, "UMREZ"), _num(marm, "UMREN"))))
    df = bal.merge(po[k + ["MATNR", "meins", "bprme"]], on=k).merge(
        ekko.assign(EBELN=_s(ekko, "EBELN"), currency=_s(ekko, "WAERS"))[["EBELN", "currency"]], on="EBELN")

    def defect(r: pd.Series) -> str:
        def check_unit(unit: str, matnr: str) -> str:
            base_unit = base.get(matnr, "")
            if unit == "" or unit == base_unit:
                return ""
            c = conv.get(f"{matnr}|{unit}")
            if c is None:
                return f"no MARM {unit}"
            return "" if c[0] > 0 and c[1] > 0 else f"MARM {unit} UMREZ/UMREN <= 0"
        reasons = []
        meins_defect = check_unit(r["meins"], r["MATNR"])
        if meins_defect:
            reasons.append(meins_defect)
        bprme_defect = check_unit(r["bprme"], r["MATNR"])
        if bprme_defect and bprme_defect not in reasons:
            reasons.append(bprme_defect)
        return "; ".join(reasons)

    # ponytail: row-wise apply over variance lines only (already filtered); vectorise if >1e6 lines.
    df["why"] = df.apply(defect, axis=1) if not df.empty else pd.Series(dtype="string")
    df = df[df["why"] != ""]
    rows = pd.DataFrame({
        "doc_key": "EBELN=" + df["EBELN"] + "|EBELP=" + df["EBELP"], "master_key": "MATNR=" + df["MATNR"],
        "amount": df["amount"], "currency": df["currency"],
        "detail": "GR " + df["gr"].round(2).astype(str) + " vs IR " + df["ir"].round(2).astype(str) + "; " + df["why"],
    })
    return _result("grir_uom_variance", rows)


def blocked_sales(frames: TableFrames) -> MetricResult:
    got = _get(frames, "VBAK")
    if got is None:
        return MetricResult("blocked_sales")
    (vbak,) = got
    area = ["KUNNR", "VKORG", "VTWEG", "SPART"]
    so = vbak.assign(**{c: _s(vbak, c) for c in ["VBELN", *area, "LIFSK", "FAKSK", "CMGST"]},
                     amount=_num(vbak, "NETWR"), currency=_s(vbak, "WAERK"))
    vbak_cmgst_values = so["CMGST"].to_numpy()
    vbuk = frames.plain("VBUK")
    if vbuk is not None and not vbuk.empty:
        so = so.drop(columns="CMGST").merge(vbuk.assign(VBELN=_s(vbuk, "VBELN"), CMGST=_s(vbuk, "CMGST"))[["VBELN", "CMGST"]],
                                            on="VBELN", how="left")
        so["CMGST"] = so["CMGST"].fillna(pd.Series(vbak_cmgst_values, index=so.index))
    credit, deliv, bill = so["CMGST"].isin(["B", "C"]), so["LIFSK"] != "", so["FAKSK"] != ""
    so = so[credit | deliv | bill].assign(_c=credit[so.index], _d=deliv[so.index], _b=bill[so.index])
    knvv = frames.plain("KNVV")
    if knvv is not None and not knvv.empty:
        kv = knvv.assign(**{c: _s(knvv, c) for c in [*area, "AUFSD", "LIFSD"]})
        kv = kv.groupby(area, as_index=False).agg({
            "AUFSD": lambda x: "" if (x == "").all() else "B",
            "LIFSD": lambda x: "" if (x == "").all() else "B",
        })
    else:
        kv = pd.DataFrame(columns=[*area, "AUFSD", "LIFSD"])
    so = so.merge(kv, on=area, how="left", indicator=True)
    kna1 = frames.plain("KNA1")
    central: set[str] = set()
    if kna1 is not None and not kna1.empty:
        central = set(_s(kna1, "KUNNR")[(_s(kna1, "AUFSD") != "") | (_s(kna1, "LIFSD") != "")])
    no_area = so["_merge"] == "left_only"
    area_block = (so["AUFSD"].fillna("") != "") | (so["LIFSD"].fillna("") != "")
    cen = so["KUNNR"].isin(central)
    so = so.assign(_no_area=no_area, _area_block=area_block, _cen=cen)
    so = so[so["_no_area"] | so["_area_block"] | so["_cen"]]
    def _make_detail(row: pd.Series) -> str:
        parts = []
        if row["_c"]:
            parts.append("credit block")
        if row["_d"]:
            parts.append("delivery block")
        if row["_b"]:
            parts.append("billing block")
        if row["_no_area"]:
            parts.append("no KNVV for sales area")
        if row["_area_block"]:
            parts.append("KNVV order/delivery block")
        if row["_cen"]:
            parts.append("KNA1 central block")
        return "; ".join(parts)
    why = so.apply(_make_detail, axis=1) if not so.empty else pd.Series(dtype="string")
    rows = pd.DataFrame({"doc_key": "VBELN=" + so["VBELN"],
                         "master_key": "KUNNR=" + so["KUNNR"] + "|VKORG=" + so["VKORG"] + "|VTWEG=" + so["VTWEG"]
                                       + "|SPART=" + so["SPART"],
                         "amount": so["amount"], "currency": so["currency"], "detail": why})
    return _result("blocked_sales", rows)


def _lifnr(k: str) -> str:
    return k.split("=", 1)[-1].strip().lstrip("0")


def vendor_clusters(pairs: list[tuple[str, str]]) -> dict[str, str]:
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        ra, rb = find(_lifnr(a)), find(_lifnr(b))
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    return {k: find(k) for k in parent}


def duplicate_payments(frames: TableFrames, clusters: dict[str, str]) -> MetricResult:
    got = _get(frames, "BSAK")
    if got is None:
        return MetricResult("duplicate_payment")
    (bsak,) = got
    p = bsak[_s(bsak, "SHKZG") == "S"]
    p = p.assign(lif=_s(p, "LIFNR").str.lstrip("0"), BELNR=_s(p, "BELNR"), BUKRS=_s(p, "BUKRS"),
                 GJAHR=_s(p, "GJAHR"), currency=_s(p, "WAERS"), amt=_num(p, "WRBTR"),
                 ref=_s(p, "XBLNR").str.upper().str.replace(r"[^A-Z0-9]", "", regex=True))
    p = p[p["lif"] != ""]
    p = p[p["amt"] > 0]
    # ponytail: reversed payments still count; exclude via BKPF.STBLG once extracted.
    p = p.assign(cluster=p["lif"].map(clusters).fillna(p["lif"]), ref=p["ref"].where(p["ref"] != "", "BLDAT:" + _s(p, "BLDAT")),
                 doc=p["GJAHR"] + "/" + p["BELNR"])
    g = p.groupby(["cluster", "BUKRS", "currency", "amt", "ref"]).agg(
        docs=("doc", "nunique"), lifs=("lif", lambda s: ",".join(sorted(set(s)))), doc=("doc", lambda s: ",".join(sorted(set(s))))
    ).reset_index()
    g = g[g["docs"] > 1]
    rows = pd.DataFrame({"doc_key": "BUKRS=" + g["BUKRS"] + "|GJAHR/BELNR=" + g["doc"],
                         "master_key": "LIFNR=" + g["lifs"], "amount": g["amt"] * (g["docs"] - 1),
                         "currency": g["currency"],
                         "detail": g["docs"].astype(str) + " payments of " + g["amt"].round(2).astype(str)
                                   + " ref " + g["ref"]})
    return _result("duplicate_payment", rows)


def late_pos(frames: TableFrames, today: date) -> MetricResult:
    got = _get(frames, "EKKO", "EKPO", "EKET")
    if got is None:
        return MetricResult("late_po")
    ekko, ekpo, eket = got
    sched = eket.assign(EBELN=_s(eket, "EBELN"), EBELP=_s(eket, "EBELP"), eindt=_date(eket, "EINDT"))
    due = sched.groupby(["EBELN", "EBELP"], as_index=False)["eindt"].min()
    ekbe = frames.plain("EKBE")
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
    marc = frames.plain("MARC")
    plifz_bad = pd.Series(True, index=df.index)
    if marc is not None and not marc.empty:
        m = marc.assign(MATNR=_s(marc, "MATNR"), WERKS=_s(marc, "WERKS"), plifz=_num(marc, "PLIFZ"))
        ok = set((m.loc[m["plifz"] > 0, "MATNR"] + "|" + m.loc[m["plifz"] > 0, "WERKS"]))
        plifz_bad = ~(df["MATNR"] + "|" + df["WERKS"]).isin(ok)
    eina, eine = frames.plain("EINA"), frames.plain("EINE")
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


def _master_variants(master_key: str) -> list[dict[str, str]]:
    base = dict(p.split("=", 1) for p in master_key.split("|") if "=" in p)
    multi = {k: v.split(",") for k, v in base.items() if "," in v}
    if not multi:
        return [base]
    (k, vals), = multi.items()  # only LIFNR lists today
    return [{**base, k: v} for v in vals]


def _z(v: str) -> str:
    return v.strip().lstrip("0") or "0"


def _norm(fields: dict[str, str]) -> frozenset[tuple[str, str]]:
    return frozenset((f, _z(v)) for f, v in fields.items() if v.strip())


def attribute(items: list[CostItem], failing: dict[str, set[str]]) -> dict[str, list[str]]:
    """A finding attaches to a document when the finding record's whole key sits inside the
    document's master key (MARA MATNR=1 attaches to MATNR=1|WERKS=1000; a WERKS-only record
    does not attach to every PO at that plant). One pass over the records builds the index;
    each item then looks up the <=15 subsets of its own (<=4-field) master key."""
    index: dict[frozenset[tuple[str, str]], set[str]] = {}
    for cid, keys in failing.items():
        for k in keys:
            if (p := parse_record_key(k)) and (fk := _norm(p)):
                index.setdefault(fk, set()).add(cid)
    out: dict[str, set[str]] = {}
    for it in items:
        hits = out.setdefault(it["doc_key"], set())
        for mv in _master_variants(it["master_key"]):
            pairs = sorted(_norm(mv))
            for n in range(1, len(pairs) + 1):
                for sub in combinations(pairs, n):
                    hits.update(index.get(frozenset(sub), ()))
    return {k: sorted(v) for k, v in out.items()}


class MetricRow(TypedDict):
    metric: str
    amount: float
    currency: str | None
    by_currency: dict[str, float]
    documents: int
    check_ids: list[str]
    items: list[dict[str, object]]


def compute(frames: TableFrames, today: date, clusters: dict[str, str],
            failing: dict[str, set[str]]) -> list[MetricRow]:
    results = [late_pos(frames, today), grir_uom_variance(frames), blocked_sales(frames),
               duplicate_payments(frames, clusters)]
    rows: list[MetricRow] = []
    for r in results:
        items = r.items[:1000]
        att = attribute(items, failing)
        rows.append(MetricRow(metric=r.metric, amount=r.amount, currency=r.currency, by_currency=r.by_currency,
                              documents=r.documents,
                              check_ids=sorted({c for v in att.values() for c in v}),
                              items=[{**i, "check_ids": att[i["doc_key"]]} for i in items]))
    return rows

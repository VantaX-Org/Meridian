"""PTP event builder (spec §2.2, §2.3 PTP). Case ``po_item`` = EBELN/EBELP, case ``vendor`` = LIFNR."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_day, sap_ts, value_attr,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_PR", "Create purchase requisition", "PTP-PR-ME51N-01", "po_item", "EBAN.BANFN EBAN.BNFPO EBAN.ERDAT",
      "EBAN row linked by EKPO.BANFN/BNFPO", "EBAN.ERDAT", 1, False),
    A("RELEASE_PR", "Release purchase requisition", "PTP-PR-ME51N-X_RELEASE_PR", "po_item", "CDPOS.FNAME",
      "CDPOS class BANF, FNAME='FRGZU'", "CDHDR.UDATE CDHDR.UTIME", 2, False),
    A("CREATE_PO_ITEM", "Create purchase order item", "PTP-PO-ME21N-02", "po_item", "EKKO.EBELN EKPO.EBELP EKKO.AEDAT",
      "EKKO row", "EKKO.AEDAT", 3, True),
    A("CHANGE_PO_HEADER", "Change purchase order header", "PTP-PO-ME21N-01", "po_item", "CDPOS.TABNAME CDPOS.FNAME",
      "CDPOS class EINKBELEG, TABNAME='EKKO', FNAME<>'FRGZU', CHNGIND='U'", "CDHDR.UDATE CDHDR.UTIME", 4, False),
    A("CHANGE_PO_QTY", "Change order quantity", "PTP-PO-ME21N-X_CHANGE_QTY", "po_item", "EKPO.MENGE",
      "CDPOS class EINKBELEG, TABNAME='EKPO', FNAME='MENGE'", "CDHDR.UDATE CDHDR.UTIME", 5, False),
    A("CHANGE_PO_PRICE", "Change net price", "PTP-PO-ME21N-X_CHANGE_PRICE", "po_item", "EKPO.NETPR",
      "CDPOS class EINKBELEG, TABNAME='EKPO', FNAME='NETPR'", "CDHDR.UDATE CDHDR.UTIME", 6, False),
    A("CHANGE_PO_DATE", "Change delivery date", "PTP-PO-ME21N-X_CHANGE_DATE", "po_item", "EKET.EINDT",
      "CDPOS class EINKBELEG, TABNAME='EKET', FNAME='EINDT'", "CDHDR.UDATE CDHDR.UTIME", 7, False),
    A("RELEASE_PO", "Release purchase order", "PTP-REL-ME29N-01", "po_item", "EKKO.FRGZU",
      "CDPOS class EINKBELEG, TABNAME='EKKO', FNAME='FRGZU'", "CDHDR.UDATE CDHDR.UTIME", 8, False),
    A("GOODS_RECEIPT", "Post goods receipt", "PTP-GR-MIGO-01", "po_item", "EKBE.VGABE EKBE.SHKZG EKBE.BELNR",
      "EKBE VGABE='1', SHKZG='S'", "EKBE.CPUDT EKBE.CPUTM", 9, True),
    A("REVERSE_GR", "Reverse goods receipt", "PTP-GR-MIGO-X_REVERSE_GR", "po_item", "EKBE.VGABE EKBE.SHKZG",
      "EKBE VGABE='1', SHKZG='H'", "EKBE.CPUDT EKBE.CPUTM", 10, False),
    A("INVOICE_RECEIPT", "Post invoice receipt", "PTP-IV-MIRO-01", "po_item", "EKBE.VGABE EKBE.SHKZG RBKP.USNAM",
      "EKBE VGABE='2', SHKZG='S'", "EKBE.CPUDT EKBE.CPUTM", 11, True),
    A("INVOICE_BLOCKED", "Invoice blocked for payment", "PTP-IV-MIRO-X_PAYMENT_BLOCK", "po_item", "RBKP.ZLSPR",
      "RBKP ZLSPR<>'' for the EKBE invoice", "RBKP.CPUDT RBKP.CPUTM", 12, False),
    A("REVERSE_INVOICE", "Reverse invoice", "PTP-IV-MIRO-X_REVERSE_INVOICE", "po_item", "EKBE.VGABE EKBE.SHKZG",
      "EKBE VGABE='2', SHKZG='H'", "EKBE.CPUDT EKBE.CPUTM", 13, False),
    A("CLEAR_INVOICE", "Pay invoice (clearing)", "PTP-PAY-F110-01", "po_item", "BKPF.AWKEY BSAK.AUGDT BSAK.AUGBL",
      "BSAK for the BKPF doc with AWKEY = RBKP.BELNR || RBKP.GJAHR", "BSAK.AUGDT", 14, True),
    A("DELETE_PO_ITEM", "Delete purchase order item", "PTP-PO-ME21N-X_DELETE_ITEM", "po_item", "EKPO.LOEKZ",
      "CDPOS class EINKBELEG, TABNAME='EKPO', FNAME='LOEKZ'", "CDHDR.UDATE CDHDR.UTIME", 15, False),
    A("CREATE_VENDOR", "Create vendor", "PTP-VM-FK01-01", "vendor", "CDHDR.OBJECTID",
      "CDHDR class KRED, CHANGE_IND='I'", "CDHDR.UDATE CDHDR.UTIME", 1, True),
    A("CHANGE_VENDOR_GENERAL", "Change vendor general data", "PTP-VM-FK01-02", "vendor", "LFA1",
      "CDPOS class KRED, TABNAME='LFA1', CHNGIND='U'", "CDHDR.UDATE CDHDR.UTIME", 2, False),
    A("CHANGE_VENDOR_COMPANY", "Change vendor company code data", "PTP-VM-FK01-03", "vendor", "LFB1",
      "CDPOS class KRED, TABNAME='LFB1'", "CDHDR.UDATE CDHDR.UTIME", 3, False),
    A("CHANGE_VENDOR_BANK", "Change vendor bank details", "PTP-VM-FK01-04", "vendor", "LFBK",
      "CDPOS class KRED, TABNAME='LFBK'", "CDHDR.UDATE CDHDR.UTIME", 4, False),
)
M = {m.key: m for m in MAPPING}
_EKPO_FIELD = {"MENGE": "CHANGE_PO_QTY", "NETPR": "CHANGE_PO_PRICE", "LOEKZ": "DELETE_PO_ITEM"}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    ekko = frames.get("EKKO", ["EBELN", "AEDAT", "ERNAM", "BSART", "BUKRS", "EKORG", "LIFNR"])
    ekpo = frames.get("EKPO", ["EBELN", "EBELP", "BANFN", "BNFPO", "WERKS"])
    items = ekpo.merge(ekko, on="EBELN", how="inner")
    head: dict[str, dict[str, str]] = {}
    by_po: dict[str, list[str]] = defaultdict(list)
    by_pr: dict[tuple[str, str], list[str]] = defaultdict(list)
    for r in rows(items):
        case = f"{r['EBELN']}/{r['EBELP']}"
        head[case] = r
        by_po[r["EBELN"]].append(case)
        if r["BANFN"]:
            by_pr[(r["BANFN"], r["BNFPO"])].append(case)

    def ev(key: str, case: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = head[case]
        return event(ctx, M[key], case, when, table, user=user, doc_type=h["BSART"],
                     org={"BUKRS": h["BUKRS"], "EKORG": h["EKORG"], "WERKS": h["WERKS"]},
                     refs=refs, attrs={"BSART": h["BSART"], **(attrs or {})})

    for case, h in head.items():
        yield ev("CREATE_PO_ITEM", case, sap_day(ctx, h["AEDAT"]), "EKKO", h["ERNAM"])

    eban = frames.get("EBAN", ["BANFN", "BNFPO", "ERDAT", "ERNAM"])
    for r in rows(eban):
        for case in by_pr.get((r["BANFN"], r["BNFPO"]), []):
            yield ev("CREATE_PR", case, sap_day(ctx, r["ERDAT"]), "EBAN", r["ERNAM"],
                     refs=[("BANFN", f"{r['BANFN']}/{r['BNFPO']}")])

    # Change documents. TABKEY = MANDT(3) + key fields; header rows fan out to every item of the PO.
    for r in rows(cd_changes(frames, ["BANF"])):
        if r["FNAME"] == "FRGZU" and r["TABNAME"] == "EBAN":
            pr = (r["TABKEY"][3:13], r["TABKEY"][13:18])
            for case in by_pr.get(pr, []):
                yield ev("RELEASE_PR", case, cd_stamp(ctx, r), "CDPOS", r["USERNAME"],
                         refs=[("BANFN", f"{pr[0]}/{pr[1]}")], attrs=value_attr(r))
    for r in rows(cd_changes(frames, ["EINKBELEG"])):
        when, tab, fname = cd_stamp(ctx, r), r["TABNAME"], r["FNAME"]
        if tab == "EKKO":
            key = "RELEASE_PO" if fname == "FRGZU" else "CHANGE_PO_HEADER" if r["CHNGIND"] == "U" else ""
            for case in by_po.get(r["OBJECTID"], []) if key else []:
                yield ev(key, case, when, "CDPOS", r["USERNAME"], attrs=value_attr(r))
        elif tab == "EKPO" and fname in _EKPO_FIELD:
            case = f"{r['TABKEY'][3:13]}/{r['TABKEY'][13:18]}"
            if case in head:
                yield ev(_EKPO_FIELD[fname], case, when, "CDPOS", r["USERNAME"])
        elif tab == "EKET" and fname == "EINDT":
            case = f"{r['TABKEY'][3:13]}/{r['TABKEY'][13:18]}"
            if case in head:
                yield ev("CHANGE_PO_DATE", case, when, "CDPOS", r["USERNAME"])

    # History: one row per (item, event type, document); EKBE repeats account-assignment lines.
    ekbe = frames.get("EKBE", ["EBELN", "EBELP", "VGABE", "GJAHR", "BELNR", "BWART", "SHKZG", "CPUDT", "CPUTM",
                               "ERNAM"]).drop_duplicates(["EBELN", "EBELP", "VGABE", "GJAHR", "BELNR"])
    rbkp = {(r["BELNR"], r["GJAHR"]): r for r in rows(frames.get(
        "RBKP", ["BELNR", "GJAHR", "CPUDT", "CPUTM", "USNAM", "ZLSPR", "RBSTAT"]))}
    bkpf = frames.get("BKPF", ["BUKRS", "BELNR", "GJAHR", "AWTYP", "AWKEY"])
    fi_of = {r["AWKEY"]: r for r in rows(bkpf[bkpf["AWTYP"] == "RMRP"])}
    clearing: dict[tuple[str, str, str], dict[str, str]] = {}
    for r in rows(frames.get("BSAK", ["BUKRS", "BELNR", "GJAHR", "AUGDT", "AUGBL"])):
        clearing.setdefault((r["BUKRS"], r["BELNR"], r["GJAHR"]), r)
    for r in rows(ekbe):
        case = f"{r['EBELN']}/{r['EBELP']}"
        if case not in head or r["VGABE"] not in ("1", "2") or r["SHKZG"] not in ("S", "H"):
            continue
        when, doc = sap_ts(ctx, r["CPUDT"], r["CPUTM"]), f"{r['BELNR']}/{r['GJAHR']}"
        if r["VGABE"] == "1":
            key = "GOODS_RECEIPT" if r["SHKZG"] == "S" else "REVERSE_GR"
            yield ev(key, case, when, "EKBE", r["ERNAM"], refs=[("MBLNR", doc)], attrs={"BWART": r["BWART"]})
            continue
        inv = rbkp.get((r["BELNR"], r["GJAHR"]))
        user = inv["USNAM"] if inv else r["ERNAM"]
        if r["SHKZG"] == "H":
            yield ev("REVERSE_INVOICE", case, when, "EKBE", user, refs=[("RBKP", doc)])
            continue
        fi = fi_of.get(r["BELNR"] + r["GJAHR"])
        fi_ref = [("BKPF", f"{fi['BUKRS']}/{fi['BELNR']}/{fi['GJAHR']}")] if fi else []
        yield ev("INVOICE_RECEIPT", case, when, "EKBE", user, refs=[("RBKP", doc), *fi_ref],
                 attrs={"RBSTAT": inv["RBSTAT"]} if inv else None)
        if inv and inv["ZLSPR"]:
            yield ev("INVOICE_BLOCKED", case, sap_ts(ctx, inv["CPUDT"], inv["CPUTM"]), "RBKP", inv["USNAM"],
                     refs=[("RBKP", doc)], attrs={"ZLSPR": inv["ZLSPR"]})
        clr = clearing.get((fi["BUKRS"], fi["BELNR"], fi["GJAHR"])) if fi else None
        if clr:
            yield ev("CLEAR_INVOICE", case, sap_day(ctx, clr["AUGDT"]), "BSAK",
                     refs=[*fi_ref, ("AUGBL", clr["AUGBL"])])

    yield from master_data_events(frames, ctx, "KRED", M["CREATE_VENDOR"], [
        (M["CHANGE_VENDOR_GENERAL"], "LFA1", "U"), (M["CHANGE_VENDOR_COMPANY"], "LFB1", ""),
        (M["CHANGE_VENDOR_BANK"], "LFBK", ""),
    ])

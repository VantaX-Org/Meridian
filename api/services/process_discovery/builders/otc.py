"""OTC event builder (spec §2.2, §2.3 OTC). Case ``so_item`` = VBELN/POSNR, case ``customer`` = KUNNR."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows,
    sap_day, sap_ts, sorted_rows, value_attr, earliest_clearing,
)

A = ActivityMap
_CD = "CDHDR.UDATE CDHDR.UTIME"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_SO_ITEM", "Create sales order item", "OTC-SO-VA01-02", "so_item", "VBAP.VBELN VBAP.POSNR VBAP.ERDAT",
      "VBAP row", "VBAP.ERDAT VBAP.ERZET", 1, True),
    A("CHANGE_SO_HEADER", "Change sales order header", "OTC-SO-VA01-01", "so_item", "CDPOS.TABNAME CDPOS.FNAME",
      "CDPOS class VERKBELEG, TABNAME='VBAK', FNAME not in (LIFSK, FAKSK)", _CD, 2, False),
    A("CHANGE_PRICE", "Change item price", "OTC-SO-VA01-03", "so_item", "VBAP.NETWR",
      "CDPOS class VERKBELEG, TABNAME='VBAP', FNAME='NETWR'", _CD, 3, False),
    A("CHANGE_SCHEDULE", "Change requested delivery date", "OTC-SO-VA01-04", "so_item", "VBEP.EDATU",
      "CDPOS class VERKBELEG, TABNAME='VBEP', FNAME='EDATU'", _CD, 4, False),
    A("CHANGE_QTY", "Change order quantity", "OTC-SO-VA01-X_CHANGE_QTY", "so_item", "VBAP.KWMENG",
      "CDPOS class VERKBELEG, TABNAME='VBAP', FNAME='KWMENG'", _CD, 5, False),
    A("SET_DELIVERY_BLOCK", "Set delivery block", "OTC-DEL-VL01N-02", "so_item", "VBAK.LIFSK",
      "CDPOS class VERKBELEG, FNAME='LIFSK', value set", _CD, 6, False),
    A("REMOVE_DELIVERY_BLOCK", "Remove delivery block", "OTC-DEL-VL01N-X_REMOVE_BLOCK", "so_item", "VBAK.LIFSK",
      "CDPOS class VERKBELEG, FNAME='LIFSK', value cleared", _CD, 7, False),
    A("SET_BILLING_BLOCK", "Set billing block", "OTC-BIL-VF01-X_BILLING_BLOCK", "so_item", "VBAK.FAKSK",
      "CDPOS class VERKBELEG, FNAME='FAKSK', value set", _CD, 8, False),
    A("CREATE_DELIVERY", "Create delivery", "OTC-DEL-VL01N-01", "so_item", "LIPS.VGBEL LIPS.VGPOS LIKP.ERDAT",
      "LIPS with VGBEL/VGPOS = case", "LIKP.ERDAT LIKP.ERZET", 9, True),
    A("GOODS_ISSUE", "Post goods issue", "OTC-DEL-VL01N-X_GOODS_ISSUE", "so_item", "LIKP.WADAT_IST",
      "LIKP WADAT_IST<>'' for that delivery", "LIKP.WADAT_IST", 10, True),
    A("CREATE_INVOICE", "Create billing document", "OTC-BIL-VF01-01", "so_item", "VBRP.AUBEL VBRP.AUPOS VBRK.FKART",
      "VBRP with AUBEL/AUPOS = case, VBRK FKSTO='', SFAKN=''", "VBRK.ERDAT VBRK.ERZET", 11, True),
    A("CANCEL_INVOICE", "Cancel billing document", "OTC-BIL-VF01-X_CANCEL", "so_item", "VBRK.SFAKN",
      "VBRP for the case where VBRK SFAKN<>''", "VBRK.ERDAT VBRK.ERZET", 12, False),
    A("CLEAR_PAYMENT", "Receive payment (clearing)", "OTC-DUN-F150-X_CLEAR_PAYMENT", "so_item",
      "BSAD.AUGDT BSAD.AUGBL", "BSAD on VBRK.BUKRS/BELNR/GJAHR", "BSAD.AUGDT", 13, True),
    A("REJECT_ITEM", "Reject item", "OTC-SO-VA01-X_REJECT", "so_item", "VBAP.ABGRU",
      "CDPOS class VERKBELEG, TABNAME='VBAP', FNAME='ABGRU'", _CD, 14, False),
    A("CREATE_CUSTOMER", "Create customer", "OTC-CM-FD01-01", "customer", "CDHDR.OBJECTID",
      "CDHDR class DEBI, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_CUSTOMER_GENERAL", "Change customer general data", "OTC-CM-FD01-02", "customer", "KNA1",
      "CDPOS class DEBI, TABNAME='KNA1', CHNGIND='U'", _CD, 2, False),
    A("CHANGE_CUSTOMER_COMPANY", "Change customer company code data", "OTC-CM-FD01-03", "customer", "KNB1",
      "CDPOS class DEBI, TABNAME='KNB1'", _CD, 3, False),
    A("CHANGE_CREDIT_LIMIT", "Change credit data", "OTC-CM-FD01-04", "customer", "KNKK",
      "CDPOS class DEBI, TABNAME='KNKK'", _CD, 4, False),
)
M = {m.key: m for m in MAPPING}
_VBAP_FIELD = {"NETWR": "CHANGE_PRICE", "KWMENG": "CHANGE_QTY", "ABGRU": "REJECT_ITEM"}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    vbak = frames.get("VBAK", ["VBELN", "AUART", "VKORG", "VTWEG", "SPART"])
    vbap = frames.get("VBAP", ["VBELN", "POSNR", "ERDAT", "ERZET", "ERNAM", "PSTYV", "WERKS"])
    head: dict[str, dict[str, str]] = {}
    by_so: dict[str, list[str]] = defaultdict(list)
    for r in sorted_rows(vbap.merge(vbak, on="VBELN", how="inner")):
        case = f"{r['VBELN']}/{r['POSNR']}"
        head[case] = r
        by_so[r["VBELN"]].append(case)

    def ev(key: str, case: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None,
           bukrs: str = "") -> Optional[EventRow]:
        h = head[case]
        return event(ctx, M[key], case, when, table, user=user, doc_type=h["AUART"],
                     org={"VKORG": h["VKORG"], "VTWEG": h["VTWEG"], "SPART": h["SPART"], "WERKS": h["WERKS"],
                          "BUKRS": bukrs},
                     refs=refs, attrs={"AUART": h["AUART"], "PSTYV": h["PSTYV"], **(attrs or {})})

    for case, h in head.items():
        yield ev("CREATE_SO_ITEM", case, sap_ts(ctx, h["ERDAT"], h["ERZET"]), "VBAP", h["ERNAM"])

    for r in rows(cd_changes(frames, ["VERKBELEG"])):
        when, tab, fname = cd_stamp(ctx, r), r["TABNAME"], r["FNAME"]
        if fname in ("LIFSK", "FAKSK"):
            key = ("SET_DELIVERY_BLOCK" if r["VALUE_NEW"] else "REMOVE_DELIVERY_BLOCK") if fname == "LIFSK" \
                else ("SET_BILLING_BLOCK" if r["VALUE_NEW"] else "")
            for case in by_so.get(r["OBJECTID"], []) if key else []:
                yield ev(key, case, when, "CDPOS", r["USERNAME"], attrs=value_attr(r))
        elif tab == "VBAK" and r["CHNGIND"] == "U":
            for case in by_so.get(r["OBJECTID"], []):
                yield ev("CHANGE_SO_HEADER", case, when, "CDPOS", r["USERNAME"])
        elif (tab == "VBAP" and fname in _VBAP_FIELD) or (tab == "VBEP" and fname == "EDATU"):
            case = f"{r['TABKEY'][3:13]}/{r['TABKEY'][13:19]}"
            if case in head:
                yield ev(_VBAP_FIELD.get(fname, "CHANGE_SCHEDULE"), case, when, "CDPOS", r["USERNAME"])

    likp = {r["VBELN"]: r for r in sorted_rows(frames.get("LIKP", ["VBELN", "ERDAT", "ERZET", "ERNAM", "LFART",
                                                            "WADAT_IST"]))}
    for r in rows(frames.get("LIPS", ["VBELN", "POSNR", "VGBEL", "VGPOS"])):
        case, d = f"{r['VGBEL']}/{r['VGPOS']}", likp.get(r["VBELN"])
        if case not in head or d is None:
            continue
        ref, attrs = [("LIPS", f"{r['VBELN']}/{r['POSNR']}")], {"LFART": d["LFART"]}
        yield ev("CREATE_DELIVERY", case, sap_ts(ctx, d["ERDAT"], d["ERZET"]), "LIKP", d["ERNAM"], ref, attrs)
        if d["WADAT_IST"]:
            yield ev("GOODS_ISSUE", case, sap_day(ctx, d["WADAT_IST"]), "LIKP", refs=ref, attrs=attrs)

    vbrk = {r["VBELN"]: r for r in sorted_rows(frames.get(
        "VBRK", ["VBELN", "ERDAT", "ERZET", "ERNAM", "FKART", "BUKRS", "BELNR", "GJAHR", "FKSTO", "SFAKN"]))}
    clearing = earliest_clearing(frames.get("BSAD", ["BUKRS", "BELNR", "GJAHR", "AUGDT", "AUGBL"]),
                                 ["BUKRS", "BELNR", "GJAHR"])
    for r in rows(frames.get("VBRP", ["VBELN", "POSNR", "AUBEL", "AUPOS"])):
        case, b = f"{r['AUBEL']}/{r['AUPOS']}", vbrk.get(r["VBELN"])
        if case not in head or b is None:
            continue
        when, ref, attrs = sap_ts(ctx, b["ERDAT"], b["ERZET"]), [("VBRP", f"{r['VBELN']}/{r['POSNR']}")], \
            {"FKART": b["FKART"]}
        if b["SFAKN"]:
            yield ev("CANCEL_INVOICE", case, when, "VBRK", b["ERNAM"], ref, attrs, b["BUKRS"])
        elif not b["FKSTO"]:
            fi = [("BKPF", f"{b['BUKRS']}/{b['BELNR']}/{b['GJAHR']}")] if b["BELNR"] else []
            yield ev("CREATE_INVOICE", case, when, "VBRK", b["ERNAM"], [*ref, *fi], attrs, b["BUKRS"])
            clr = clearing.get((b["BUKRS"], b["BELNR"], b["GJAHR"])) if b["BELNR"] else None
            if clr:
                yield ev("CLEAR_PAYMENT", case, sap_day(ctx, clr["AUGDT"]), "BSAD",
                         refs=[*fi, ("AUGBL", clr["AUGBL"])], bukrs=b["BUKRS"])

    yield from master_data_events(frames, ctx, "DEBI", M["CREATE_CUSTOMER"], [
        (M["CHANGE_CUSTOMER_GENERAL"], "KNA1", "U"), (M["CHANGE_CUSTOMER_COMPANY"], "KNB1", ""),
        (M["CHANGE_CREDIT_LIMIT"], "KNKK", ""),
    ])

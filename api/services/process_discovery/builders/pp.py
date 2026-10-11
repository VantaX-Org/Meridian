"""PP event builder (spec §2.2, §2.3 PP). Case ``prod_order`` = AUFNR (AUTYP 10), case ``bom`` = STUE OBJECTID."""

from __future__ import annotations

from typing import Iterable, Iterator, Optional

from api.services.process_discovery.builders._logistics import goods_movements, status_activity, status_sets
from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, cd_changes, cd_stamp, event, master_data_events, rows, sap_ts,
    sorted_rows,
)

A = ActivityMap
_JCDS = "JCDS.UDATE JCDS.UTIME"
_GM = "MKPF.CPUDT MKPF.CPUTM | MATDOC.CPUDT MATDOC.CPUTM"
MAPPING: tuple[ActivityMap, ...] = (
    A("CREATE_PROD_ORDER", "Create production order", "PP-ORD-CO01-01", "prod_order", "AUFK.AUFNR AUFK.AUTYP",
      "AUFK AUTYP='10'", "AUFK.ERDAT AUFK.ERFZEIT", 1, True),
    A("RESCHEDULE_ORDER", "Reschedule order dates", "PP-ORD-CO01-02", "prod_order", "AFKO.GSTRP AFKO.GLTRP",
      "CDPOS class ORDER, TABNAME='AFKO', FNAME IN ('GSTRP','GLTRP')", "CDHDR.UDATE CDHDR.UTIME", 2, False),
    A("RELEASE_ORDER", "Release order", "PP-ORD-CO01-X_RELEASE", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0002'", _JCDS, 3, True),
    A("ISSUE_COMPONENTS", "Issue components", "PP-ORD-CO01-X_GOODS_ISSUE", "prod_order", "MSEG.BWART MATDOC.BWART",
      "MSEG (ecc) or MATDOC RECORD_TYPE='MDOC' (s4hana_onprem), BWART='261', AUFNR = case", _GM, 4, False),
    A("PARTIAL_CONFIRM", "Partially confirm order", "PP-ORD-CO01-X_PARTIAL_CONFIRM", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0010'", _JCDS, 5, False),
    A("CONFIRM_ORDER", "Confirm order", "PP-ORD-CO01-X_CONFIRM", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0009'", _JCDS, 6, True),
    A("GOODS_RECEIPT_ORDER", "Receive goods from order", "PP-ORD-CO01-X_GOODS_RECEIPT", "prod_order",
      "MSEG.BWART MATDOC.BWART", "MSEG or MATDOC 'MDOC', BWART='101', AUFNR = case", _GM, 7, True),
    A("REVERSE_MOVEMENT", "Reverse goods movement", "PP-ORD-CO01-X_REVERSE_MOVEMENT", "prod_order",
      "MSEG.BWART MATDOC.BWART", "MSEG or MATDOC 'MDOC', BWART IN ('102','262'), AUFNR = case", _GM, 8, False),
    A("DELIVER_ORDER", "Order delivered", "PP-ORD-CO01-X_DELIVERED", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0012'", _JCDS, 9, False),
    A("TECO_ORDER", "Technically complete order", "PP-ORD-CO01-X_TECO", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0045'", _JCDS, 10, True),
    A("CLOSE_ORDER", "Close order", "PP-ORD-CO01-X_CLOSE", "prod_order", "JCDS.STAT",
      "JCDS STAT='I0046'", _JCDS, 11, False),
    A("STATUS_<STAT>", "Set status <STAT>", "PP-ORD-CO01-X_STATUS_<STAT>", "prod_order", "JCDS.STAT",
      "JCDS, any other STAT", _JCDS, 12, False),
    A("CREATE_BOM", "Create bill of material", "PP-BOM-CS01-01", "bom", "CDHDR.OBJECTID",
      "CDHDR class STUE, CHANGE_IND='I'", "CDHDR.UDATE CDHDR.UTIME", 1, True),
    A("CHANGE_BOM_ITEM", "Change BOM item", "PP-BOM-CS01-02", "bom", "STPO",
      "CDPOS class STUE, TABNAME='STPO'", "CDHDR.UDATE CDHDR.UTIME", 2, False),
)
M = {m.key: m for m in MAPPING}
STATUS = {"I0002": M["RELEASE_ORDER"], "I0010": M["PARTIAL_CONFIRM"], "I0009": M["CONFIRM_ORDER"],
          "I0012": M["DELIVER_ORDER"], "I0045": M["TECO_ORDER"], "I0046": M["CLOSE_ORDER"]}
_BWART = {"261": "ISSUE_COMPONENTS", "101": "GOODS_RECEIPT_ORDER", "102": "REVERSE_MOVEMENT",
          "262": "REVERSE_MOVEMENT"}


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    aufk = frames.get("AUFK", ["AUFNR", "AUTYP", "AUART", "WERKS", "ERDAT", "ERFZEIT", "ERNAM", "OBJNR"])
    # AUFK is read for R2R (AUTYP 01), PP (10) and PM (30) in one extraction; each builder filters.
    orders = {r["AUFNR"]: r for r in sorted_rows(aufk[aufk["AUTYP"] == "10"])}

    def ev(m: ActivityMap, aufnr: str, when: Optional[Stamp], table: str, user: str = "",
           refs: Iterable[tuple[str, str]] = (), attrs: Optional[dict[str, str]] = None) -> Optional[EventRow]:
        h = orders[aufnr]
        return event(ctx, m, aufnr, when, table, user=user, doc_type=h["AUART"], org={"WERKS": h["WERKS"]},
                     refs=refs, attrs={"AUART": h["AUART"], **(attrs or {})})

    for aufnr, h in orders.items():
        yield ev(M["CREATE_PROD_ORDER"], aufnr, sap_ts(ctx, h["ERDAT"], h["ERFZEIT"]), "AUFK", h["ERNAM"])

    # AFKO TABKEY = MANDT(3) + AUFNR(12). GSTRP and GLTRP in one change document collapse to one event.
    for r in rows(cd_changes(frames, ["ORDER"])):
        aufnr = r["TABKEY"][3:15]
        if r["TABNAME"] == "AFKO" and r["FNAME"] in ("GSTRP", "GLTRP") and aufnr in orders:
            yield ev(M["RESCHEDULE_ORDER"], aufnr, cd_stamp(ctx, r), "CDPOS", r["USERNAME"])

    for aufnr, r in status_sets(frames, {h["OBJNR"]: a for a, h in orders.items() if h["OBJNR"]}):
        yield ev(status_activity(STATUS, M["STATUS_<STAT>"], r["STAT"]), aufnr, sap_ts(ctx, r["UDATE"], r["UTIME"]),
                 "JCDS", r["USNAM"], attrs={"STAT": r["STAT"]})

    for r, table in goods_movements(frames, ctx, set(orders)):
        if r["BWART"] in _BWART:
            yield ev(M[_BWART[r["BWART"]]], r["AUFNR"], sap_ts(ctx, r["CPUDT"], r["CPUTM"]), table, r["USNAM"],
                     refs=[("MBLNR", f"{r['MBLNR']}/{r['MJAHR']}")], attrs={"BWART": r["BWART"]})

    yield from master_data_events(frames, ctx, "STUE", M["CREATE_BOM"], [(M["CHANGE_BOM_ITEM"], "STPO", "")])

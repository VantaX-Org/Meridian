"""R2R event builder (spec §2.2, §2.3 R2R). Case ``fi_doc`` = BUKRS/BELNR/GJAHR plus master-data streams."""

from __future__ import annotations

from datetime import timedelta
from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, Stamp, dyn, event, master_data_events, norm_key, rows, sap_date, sap_day,
    sap_ts,
)

A = ActivityMap
_CD = "CDHDR.UDATE CDHDR.UTIME"
_TS = "BKPF.CPUDT BKPF.CPUTM"
MAPPING: tuple[ActivityMap, ...] = (
    A("POST_GL_DOC", "Post G/L document", "R2R-GL-FB50-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', TCODE IN ('FB50','FB01','FB01L','FBS1','F-02','FB50L')", _TS, 1, True),
    A("POST_ASSET_ACQ", "Post asset acquisition", "R2R-AA-ABZON-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', TCODE IN ('ABZON','ABZO','F-90','AB01')", _TS, 1, True),
    A("POST_DEPRECIATION", "Post depreciation", "R2R-AA-AFAB-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', TCODE IN ('AFAB','AFABN')", _TS, 1, True),
    A("POST_<TCODE>", "Post document via <TCODE>", "R2R-DSC-POST_<TCODE>-01", "fi_doc", "BKPF.BSTAT BKPF.TCODE",
      "BKPF BSTAT='', any other TCODE", _TS, 1, True),
    A("PARK_DOC", "Park document", "R2R-GL-FB50-X_PARK", "fi_doc", "BKPF.BSTAT", "BKPF BSTAT='V'", _TS, 2, False),
    A("REVERSE_DOC", "Reverse document", "R2R-GL-FB50-X_REVERSE", "fi_doc", "BKPF.STBLG BKPF.STJAH",
      "BKPF STBLG<>''; ts of the reversal document STBLG/STJAH", _TS, 3, False),
    A("CLEAR_ITEM", "Clear open item", "R2R-GL-FB50-X_CLEAR", "fi_doc", "BSAS.AUGDT BSAS.AUGBL",
      "BSAS on the doc", "BSAS.AUGDT", 4, False),
    A("CREATE_GL_ACCOUNT", "Create G/L account", "R2R-GL-FS00-01", "gl_account", "CDHDR.OBJECTID",
      "CDHDR class SACH, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_GL_COMPANY", "Change G/L company code data", "R2R-GL-FS00-02", "gl_account", "SKB1",
      "CDPOS class SACH, TABNAME='SKB1'", _CD, 2, False),
    A("CHANGE_GL_TEXT", "Change G/L account text", "R2R-GL-FS00-03", "gl_account", "SKAT",
      "CDPOS class SACH, TABNAME='SKAT'", _CD, 3, False),
    A("CREATE_ASSET", "Create asset", "R2R-AA-AS01-01", "asset", "CDHDR.OBJECTID",
      "CDHDR class ANLA, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_ASSET_ASSIGNMENT", "Change asset time-dependent data", "R2R-AA-AS01-02", "asset", "ANLZ",
      "CDPOS class ANLA, TABNAME='ANLZ'", _CD, 2, False),
    A("CHANGE_ASSET_DEPRECIATION", "Change depreciation terms", "R2R-AA-AS01-03", "asset", "ANLB",
      "CDPOS class ANLA, TABNAME='ANLB'", _CD, 3, False),
    A("CREATE_COST_CENTER", "Create cost centre", "R2R-CO-KS01-01", "cost_center", "CDHDR.OBJECTID",
      "CDHDR class KOSTL, CHANGE_IND='I'", _CD, 1, True),
    A("CHANGE_COST_CENTER", "Change cost centre", "R2R-CO-KS01-02", "cost_center", "CDPOS.CHNGIND",
      "CDPOS class KOSTL, CHNGIND='U'", _CD, 2, False),
    A("CREATE_COST_ELEMENT", "Create cost element", "R2R-CO-KA01-01", "cost_element", "CDHDR.OBJECTID",
      "CDHDR class KSTAR, CHANGE_IND='I'", _CD, 1, True),
    A("CREATE_INTERNAL_ORDER", "Create internal order", "R2R-CO-KO01-01", "internal_order", "AUFK.AUFNR AUFK.AUTYP",
      "AUFK AUTYP='01'", "AUFK.ERDAT AUFK.ERFZEIT", 1, True),
)
M = {m.key: m for m in MAPPING}
_TCODE_KEY = {
    **dict.fromkeys(("FB50", "FB01", "FB01L", "FBS1", "F-02", "FB50L"), "POST_GL_DOC"),
    **dict.fromkeys(("ABZON", "ABZO", "F-90", "AB01"), "POST_ASSET_ACQ"),
    **dict.fromkeys(("AFAB", "AFABN"), "POST_DEPRECIATION"),
}


def post_activity(tcode: str) -> ActivityMap:
    """Mapped posting activity for a T-code, or the discovered ``POST_<TCODE>`` row (§4.2 rule 3)."""
    if tcode in _TCODE_KEY:
        return M[_TCODE_KEY[tcode]]
    key = "POST_" + (norm_key(tcode, 20) or "NONE")
    return dyn(M["POST_<TCODE>"], key, f"Post document via {tcode or 'no T-code'}", f"R2R-DSC-{key}-01")


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    since = ctx.window_from or ctx.run_date - timedelta(days=365)
    bkpf = frames.get("BKPF", ["BUKRS", "BELNR", "GJAHR", "BLART", "BSTAT", "CPUDT", "CPUTM", "USNAM", "TCODE",
                               "STBLG", "STJAH", "AWTYP"])
    # BKPF is read for PTP (AWTYP RMRP) and R2R; the extraction merges both reads, the window applies here.
    docs = {(r["BUKRS"], r["BELNR"], r["GJAHR"]): r for r in rows(bkpf)
            if (d := sap_date(r["CPUDT"])) is not None and d >= since}

    def ev(m: ActivityMap, key: tuple[str, str, str], when: Optional[Stamp], table: str, user: str = "",
           refs: tuple[tuple[str, str], ...] = ()) -> Optional[EventRow]:
        h = docs[key]
        return event(ctx, m, "/".join(key), when, table, user=user, doc_type=h["BLART"], org={"BUKRS": key[0]},
                     refs=refs, attrs={"BLART": h["BLART"], "TCODE": h["TCODE"], "BSTAT": h["BSTAT"],
                                       "AWTYP": h["AWTYP"]})

    for key, h in docs.items():
        when = sap_ts(ctx, h["CPUDT"], h["CPUTM"])
        if h["BSTAT"] == "":
            yield ev(post_activity(h["TCODE"]), key, when, "BKPF", h["USNAM"])
        elif h["BSTAT"] == "V":
            yield ev(M["PARK_DOC"], key, when, "BKPF", h["USNAM"])
        if h["STBLG"]:
            # Original and reversal point at each other; only the later document is the reversal event.
            rev = docs.get((key[0], h["STBLG"], h["STJAH"] or key[2]))
            rev_when = sap_ts(ctx, rev["CPUDT"], rev["CPUTM"]) if rev else None
            if rev_when and when and rev_when[0] >= when[0] and (rev_when[0], rev["BELNR"]) > (when[0], key[1]):
                yield ev(M["REVERSE_DOC"], key, rev_when, "BKPF", rev["USNAM"],
                         refs=(("STBLG", f"{h['STBLG']}/{h['STJAH']}"),))

    for r in rows(frames.get("BSAS", ["BUKRS", "BELNR", "GJAHR", "AUGDT", "AUGBL"])):
        key = (r["BUKRS"], r["BELNR"], r["GJAHR"])
        if key in docs:
            yield ev(M["CLEAR_ITEM"], key, sap_day(ctx, r["AUGDT"]), "BSAS", refs=(("AUGBL", r["AUGBL"]),))

    yield from master_data_events(frames, ctx, "SACH", M["CREATE_GL_ACCOUNT"], [
        (M["CHANGE_GL_COMPANY"], "SKB1", ""), (M["CHANGE_GL_TEXT"], "SKAT", "")])
    yield from master_data_events(frames, ctx, "ANLA", M["CREATE_ASSET"], [
        (M["CHANGE_ASSET_ASSIGNMENT"], "ANLZ", ""), (M["CHANGE_ASSET_DEPRECIATION"], "ANLB", "")])
    yield from master_data_events(frames, ctx, "KOSTL", M["CREATE_COST_CENTER"], [
        (M["CHANGE_COST_CENTER"], "", "U")])
    yield from master_data_events(frames, ctx, "KSTAR", M["CREATE_COST_ELEMENT"], [])

    aufk = frames.get("AUFK", ["AUFNR", "AUTYP", "AUART", "ERDAT", "ERFZEIT", "ERNAM", "BUKRS"])
    for r in rows(aufk[aufk["AUTYP"] == "01"]):
        yield event(ctx, M["CREATE_INTERNAL_ORDER"], r["AUFNR"], sap_ts(ctx, r["ERDAT"], r["ERFZEIT"]), "AUFK",
                    user=r["ERNAM"], doc_type=r["AUART"], org={"BUKRS": r["BUKRS"]}, attrs={"AUART": r["AUART"]})

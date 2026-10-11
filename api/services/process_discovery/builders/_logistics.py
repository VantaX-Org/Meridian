"""Readers shared by the PP, PM, QM and PS builders: JCDS status sets, order goods movements, QMEL split."""

from __future__ import annotations

from typing import Iterator, Mapping, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, Frames, dyn, norm_key, rows, sorted_rows,
)

JCDS_COLS = ["OBJNR", "STAT", "CHGNR", "UDATE", "UTIME", "USNAM", "INACT"]
QMEL_COLS = ["QMNUM", "QMART", "QMDAT", "MZEIT", "ERNAM", "ERDAT", "QMDAB", "QMZAB", "PRIOK", "AUFNR", "PRUEFLOS",
             "IWERK"]


def status_sets(frames: Frames, objnrs: Mapping[str, str]) -> Iterator[tuple[str, dict[str, str]]]:
    """(case id, JCDS row) for every status *set* (``INACT=''``) on an object in ``objnrs`` (OBJNR -> case id).

    JCDS is extracted once for both parents (AUFK orders and PRPS WBS elements), so each builder keeps
    only its own OBJNRs here."""
    j = frames.get("JCDS", JCDS_COLS)
    for r in rows(j[(j["INACT"] == "") & j["OBJNR"].isin(set(objnrs))]):
        yield objnrs[r["OBJNR"]], r


def status_activity(known: Mapping[str, ActivityMap], template: ActivityMap, stat: str) -> ActivityMap:
    """Mapped JCDS status, or ``STATUS_<STAT>`` under the template's L4 (spec §4.2 rule 2)."""
    if stat in known:
        return known[stat]
    key = "STATUS_" + norm_key(stat, 20)
    return dyn(template, key, f"Set status {stat}", template.l5_id.replace("X_STATUS_<STAT>", f"X_{key}"))


def goods_movements(frames: Frames, ctx: BuildContext, aufnrs: set[str]) -> Iterator[tuple[dict[str, str], str]]:
    """(line, source table) for material-document lines posted against ``aufnrs``.

    ``ecc``: MSEG lines with the MKPF header time and user. ``s4hana_onprem``: MATDOC lines with
    ``RECORD_TYPE='MDOC'`` (the other record types are archive and aggregate rows). Both yield the same
    columns, so ECC and S/4 events of one process are identical apart from ``source_table``."""
    cols = ["MBLNR", "MJAHR", "BWART", "AUFNR", "CPUDT", "CPUTM", "USNAM"]
    if ctx.system_type == "s4hana_onprem":
        m = frames.get("MATDOC", [*cols, "RECORD_TYPE"])
        m, table = m[(m["RECORD_TYPE"] == "MDOC") & m["AUFNR"].isin(aufnrs)], "MATDOC"
    else:
        lines = frames.get("MSEG", ["MBLNR", "MJAHR", "BWART", "AUFNR"])
        head = frames.get("MKPF", ["MBLNR", "MJAHR", "CPUDT", "CPUTM", "USNAM"])
        m, table = lines[lines["AUFNR"].isin(aufnrs)].merge(head, on=["MBLNR", "MJAHR"], how="inner"), "MSEG"
    for r in rows(m[cols]):
        yield r, table


def notification_kinds(frames: Frames) -> Mapping[str, str]:
    """QMART -> QMTYP from TQ80 (``'01'`` PM, ``'02'`` QM); empty when TQ80 was not read."""
    t = frames.get("TQ80", ["QMART", "QMTYP"])
    return {r["QMART"]: r["QMTYP"] for r in sorted_rows(t)}


def notification_kind(r: Mapping[str, str], kinds: Mapping[str, str]) -> Optional[str]:
    """'PM', 'QM' or None (other notification categories, e.g. customer service '03').

    Without a TQ80 entry for the type, a notification with an inspection lot is QM and any other is PM
    (spec §2.2, coverage table: "TQ80 unreadable")."""
    qmtyp = kinds.get(r["QMART"])
    if qmtyp is None:
        return "QM" if r["PRUEFLOS"] else "PM"
    return {"01": "PM", "02": "QM"}.get(qmtyp)

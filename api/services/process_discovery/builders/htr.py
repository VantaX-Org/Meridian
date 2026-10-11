"""HTR event builder (spec §2.2, §2.3 HTR).

Cases: ``emp_event`` = hash(PERNR)/BEGDA/MASSN (one personnel action), ``org_object`` = PLVAR/OTYPE/OBJID.
Raw PERNR never leaves this module: case ids and resources are hashed with the tenant id (spec §2.1)."""

from __future__ import annotations

from typing import Iterator, Optional

from api.services.process_discovery.events import (
    ActivityMap, BuildContext, EventRow, Frames, event, rows, sap_day, sorted_rows,
)

A = ActivityMap
MAPPING: tuple[ActivityMap, ...] = (
    A("RECORD_ACTION", "Record personnel action", "HTR-PA-PA40-01", "emp_event", "PA0000.MASSN",
      "PA0000 row", "PA0000.AEDTM", 1, True),
    A("RECORD_REASON", "Record action reason", "HTR-PA-PA40-02", "emp_event", "PA0000.MASSG",
      "PA0000 MASSG<>''", "PA0000.AEDTM", 2, False),
    A("UPDATE_ORG_ASSIGNMENT", "Update organisational assignment", "HTR-PA-PA40-03", "emp_event",
      "PA0001.BUKRS PA0001.WERKS PA0001.PERSG", "PA0001 with same PERNR and BEGDA", "PA0001.AEDTM", 3, True),
    A("UPDATE_PERSONAL_DATA", "Update personal data", "HTR-PA-PA30-01", "emp_event", "PA0002.PERNR",
      "PA0002 with same PERNR and BEGDA", "PA0002.AEDTM", 4, False),
    A("UPDATE_PAY", "Update basic pay", "HTR-PA-PA30-02", "emp_event", "PA0008.PERNR",
      "PA0008 with same PERNR and BEGDA", "PA0008.AEDTM", 5, False),
    A("CREATE_ORG_OBJECT", "Create organisational object", "HTR-OM-PP01-01", "org_object",
      "HRP1000.OTYPE HRP1000.OBJID", "HRP1000 row, earliest BEGDA", "HRP1000.AEDTM", 1, True),
    A("CREATE_RELATIONSHIP", "Create relationship", "HTR-OM-PP01-02", "org_object", "HRP1001.RSIGN HRP1001.RELAT",
      "HRP1001 for that object", "HRP1001.AEDTM", 2, False),
)
M = {m.key: m for m in MAPPING}
_HR_KEYS = ["PERNR", "BEGDA", "SEQNR", "AEDTM", "UNAME"]
# Object types that are people (person, external person, central person, business partner, user).
# Their OBJID is a PERNR or user id, so they are never an org_object case.
PERSON_OTYPES = frozenset({"P", "H", "CP", "BP", "US"})


def build(frames: Frames, ctx: BuildContext) -> Iterator[Optional[EventRow]]:
    # Sorted by full row first, so the last row per (PERNR, BEGDA) does not depend on input order.
    pa1 = {(r["PERNR"], r["BEGDA"]): r
           for r in sorted_rows(frames.get("PA0001", [*_HR_KEYS, "BUKRS", "WERKS", "PERSG"]))}
    actions: dict[tuple[str, str], list[tuple[str, dict[str, str]]]] = {}

    def org(pernr: str, begda: str) -> dict[str, str]:
        r = pa1.get((pernr, begda))
        return {k: r[k] for k in ("BUKRS", "WERKS", "PERSG")} if r else {}

    for r in rows(frames.get("PA0000", ["PERNR", "BEGDA", "SEQNR", "MASSN", "MASSG", "STAT2", "AEDTM", "UNAME"])):
        if not r["PERNR"]:
            continue
        case = f"{ctx.hash(r['PERNR'])}/{r['BEGDA']}/{r['MASSN']}"
        actions.setdefault((r["PERNR"], r["BEGDA"]), []).append((case, r))
        when = sap_day(ctx, r["AEDTM"])
        o = org(r["PERNR"], r["BEGDA"])
        a = {"MASSN": r["MASSN"], "MASSG": r["MASSG"], "STAT2": r["STAT2"]}
        yield event(ctx, M["RECORD_ACTION"], case, when, "PA0000", user=r["UNAME"], hashed=True,
                    doc_type=r["MASSN"], org=o, attrs=a)
        if r["MASSG"]:
            yield event(ctx, M["RECORD_REASON"], case, when, "PA0000", user=r["UNAME"], hashed=True,
                        doc_type=r["MASSN"], org=o, attrs=a)

    # An infotype record joins every action of the same employee and start date.
    for key, table in (("UPDATE_ORG_ASSIGNMENT", "PA0001"), ("UPDATE_PERSONAL_DATA", "PA0002"),
                       ("UPDATE_PAY", "PA0008")):
        for r in rows(frames.get(table, _HR_KEYS)):
            for case, act in actions.get((r["PERNR"], r["BEGDA"]), []):
                yield event(ctx, M[key], case, sap_day(ctx, r["AEDTM"]), table, user=r["UNAME"], hashed=True,
                            doc_type=act["MASSN"], org=org(r["PERNR"], r["BEGDA"]), attrs={"MASSN": act["MASSN"]})

    # Org objects: the earliest HRP1000 record (lowest BEGDA, then AEDTM) is the creation; later records
    # are renames and validity changes, which the template has no step for. Rows are sorted by
    # (PLVAR, OTYPE, OBJID, BEGDA, AEDTM, UNAME), so the first row per case is the earliest, ties by UNAME.
    created: dict[str, dict[str, str]] = {}
    for r in sorted_rows(frames.get("HRP1000", ["PLVAR", "OTYPE", "OBJID", "BEGDA", "AEDTM", "UNAME"])):
        if r["OTYPE"] not in PERSON_OTYPES:
            created.setdefault(f"{r['PLVAR']}/{r['OTYPE']}/{r['OBJID']}", r)
    for case, r in created.items():
        yield event(ctx, M["CREATE_ORG_OBJECT"], case, sap_day(ctx, r["AEDTM"]), "HRP1000", user=r["UNAME"],
                    hashed=True, doc_type=r["OTYPE"], attrs={"OTYPE": r["OTYPE"]})
    for r in rows(frames.get("HRP1001", ["PLVAR", "OTYPE", "OBJID", "RSIGN", "RELAT", "BEGDA", "AEDTM", "UNAME"])):
        case = f"{r['PLVAR']}/{r['OTYPE']}/{r['OBJID']}"
        if case in created:
            yield event(ctx, M["CREATE_RELATIONSHIP"], case, sap_day(ctx, r["AEDTM"]), "HRP1001", user=r["UNAME"],
                        hashed=True, doc_type=r["OTYPE"],
                        attrs={"OTYPE": r["OTYPE"], "RSIGN": r["RSIGN"], "RELAT": r["RELAT"]})

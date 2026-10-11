"""HTR, MDG, SFX, ARB and CNQ builders against in-memory extraction frames (spec §2.1-§2.3, §9 wave 23)."""

from __future__ import annotations

import random
import re
from datetime import date, datetime, timezone

import pandas as pd
import pytest

from api.models.process_model import ID_PATTERN
from api.services.process_discovery import builders
from api.services.process_discovery.events import MemoryFrames, collect, iso_ts, make_context, sap_ts
from sap.process_definitions import reference_document
from tests.process_discovery.test_builders_core import JNB, RUN, by, df

PERNRS = ("00001001", "00001002")
SF_USERS = ("jdoe", "asmith")


def hr_tables() -> dict[str, pd.DataFrame]:
    keys = lambda pernr, begda, aedtm: {"PERNR": pernr, "BEGDA": begda, "SEQNR": "000",  # noqa: E731
                                        "AEDTM": aedtm, "UNAME": "HRADMIN"}
    return {
        "PA0000": df({**keys(PERNRS[0], "20260201", "20260125"), "ENDDA": "99991231", "MASSN": "01", "MASSG": "02",
                      "STAT2": "3"},
                     {**keys(PERNRS[1], "20260301", "20260220"), "ENDDA": "99991231", "MASSN": "10", "MASSG": "",
                      "STAT2": "0"}),
        "PA0001": df({**keys(PERNRS[0], "20260201", "20260126"), "BUKRS": "1000", "WERKS": "ZA01", "PERSG": "1",
                      "ORGEH": "50000001"}),
        "PA0002": df(keys(PERNRS[0], "20260201", "20260125")),
        "PA0008": df(keys(PERNRS[0], "20260201", "20260127"), keys(PERNRS[0], "20250101", "20250101")),
        "HRP1000": df({"PLVAR": "01", "OTYPE": "O", "OBJID": "50000001", "BEGDA": "20260101", "AEDTM": "20251215",
                       "UNAME": "OMADMIN"},
                      {"PLVAR": "01", "OTYPE": "O", "OBJID": "50000001", "BEGDA": "20260601", "AEDTM": "20260520",
                       "UNAME": "OMADMIN"},
                      {"PLVAR": "01", "OTYPE": "P", "OBJID": PERNRS[0], "BEGDA": "20260201", "AEDTM": "20260125",
                       "UNAME": "OMADMIN"}),
        "HRP1001": df({"PLVAR": "01", "OTYPE": "O", "OBJID": "50000001", "RSIGN": "B", "RELAT": "002",
                       "SCLAS": "O", "BEGDA": "20260101", "AEDTM": "20251216", "UNAME": "OMADMIN"},
                      {"PLVAR": "01", "OTYPE": "P", "OBJID": PERNRS[0], "RSIGN": "B", "RELAT": "008",
                       "SCLAS": "S", "BEGDA": "20260201", "AEDTM": "20260125", "UNAME": "OMADMIN"}),
        "USR02": df({"BNAME": "HRADMIN", "USTYP": "A"}, {"BNAME": "OMADMIN", "USTYP": "A"}),
    }


def mdg_tables() -> dict[str, pd.DataFrame]:
    cr = lambda n, created, released, changed, chn: {  # noqa: E731
        "USMD_CREQUEST": n, "USMD_CREQ_TYPE": "MAT01", "USMD_CREQ_STATUS": "05", "USMD_CREATED_AT": created,
        "USMD_CREATED_BY": "MDREQ", "USMD_RELEASED_AT": released, "USMD_RELEASED_BY": "MDAPP" if released else "",
        "USMD_CHANGED_AT": changed, "USMD_CHANGED_BY": "MDREQ", "USMD_DATA_CHN_AT": chn, "USMD_PRIORITY": "2"}
    return {"USMD120C": df(cr("000000000101", "20260105080000", "20260106090000", "20260108100000",
                              "20260107100000"),
                           cr("000000000102", "20260110080000", "0", "20260110080000", "0"))}


def sfx_tables() -> dict[str, pd.DataFrame]:
    return {
        "JobRequisition": df({"requisitionId": "501", "status": "Open", "createdDate": "/Date(1767600000000)/",
                              "hiringManager": SF_USERS[1]}),
        "JobApplication": df({"applicationId": "9001", "requisitionId": "501", "status": "Offer Accepted",
                              "appliedDate": "2026-01-08T09:00:00Z", "lastModifiedDate": "2026-01-20T10:00:00Z"},
                             {"applicationId": "9002", "requisitionId": "501", "status": "Rejected",
                              "appliedDate": "2026-01-09T09:00:00Z", "lastModifiedDate": "2026-01-12T10:00:00Z"},
                             {"applicationId": "9003", "requisitionId": "999", "status": "Rejected",
                              "appliedDate": "2026-01-09T09:00:00Z", "lastModifiedDate": "2026-01-12T10:00:00Z"}),
        "EmpJob": df({"userId": SF_USERS[0], "startDate": "2026-02-01", "seqNumber": "1", "event": "H",
                      "eventReason": "NEWHIRE", "company": "ZA01", "department": "D10"},
                     {"userId": SF_USERS[0], "startDate": "2026-05-01", "seqNumber": "1", "event": "5",
                      "eventReason": "PROMO", "company": "ZA01", "department": "D20"}),
        "EmployeeTime": df({"userId": SF_USERS[0], "timeType": "VAC", "startDate": "2026-03-02",
                            "endDate": "2026-03-04", "approvalStatus": "APPROVED"}),
    }


def arb_tables() -> dict[str, pd.DataFrame]:
    return {
        "requisitions": df({"requisitionId": "PR100", "requestor": "buyer1", "status": "Ordered",
                            "createdDate": "2026-01-05T08:00:00Z", "approvalStatus": "Approved"}),
        "suppliers": df({"supplierId": "S1", "qualificationStatus": "Qualified",
                         "registrationDate": "2026-01-02T08:00:00Z"}),
        "contracts": df({"contractId": "C1", "status": "Expired", "effectiveDate": "2026-01-01",
                         "expirationDate": "2026-06-30", "owner": "buyer1"},
                        {"contractId": "C2", "status": "Published", "effectiveDate": "2026-02-01",
                         "expirationDate": "2027-01-31", "owner": "buyer1"},
                        {"contractId": "C0", "status": "Expired", "effectiveDate": "2024-01-01",
                         "expirationDate": "2024-12-31", "owner": "buyer1"}),
    }


def cnq_tables() -> dict[str, pd.DataFrame]:
    return {
        "reports": df({"reportId": "R1", "ownerLoginId": "emp1@corp", "submitDate": "2026-01-15T12:00:00Z",
                       "approvalStatus": "A_APPR", "paymentStatus": "P_PAID"}),
        "entries": df({"reportId": "R1", "entryId": "E2", "expenseTypeCode": "TAXI", "transactionDate": "2026-01-12"},
                      {"reportId": "R1", "entryId": "E1", "expenseTypeCode": "HOTEL",
                       "transactionDate": "2026-01-10"}),
    }


CASES = {"HTR": ("ecc", hr_tables), "MDG": ("ecc", mdg_tables), "SFX": ("successfactors", sfx_tables),
         "ARB": ("ariba", arb_tables), "CNQ": ("concur", cnq_tables)}
WINDOW = date(2025, 1, 1)


def run(l1: str, tables: dict[str, pd.DataFrame] | None = None, tenant: str = "t1", window=WINDOW):
    system, fixture = CASES[l1]
    frames = MemoryFrames(fixture() if tables is None else tables)
    return collect(builders.builder(l1).build, frames, make_context(frames, tenant, system, RUN,
                                                                     window_from=window))


@pytest.mark.parametrize("l1", sorted(CASES))
def test_every_mapping_row_fires(l1):
    fired = {(e.case_type, e.activity, e.l5_id) for e in run(l1)}
    expected = {(m.case_type, m.key, m.l5_id) for m in builders.builder(l1).MAPPING if "<" not in m.key}
    assert expected <= fired, expected - fired


@pytest.mark.parametrize("l1", sorted(CASES))
def test_rerun_and_row_order_are_deterministic(l1):
    first = run(l1)
    shuffled = {k: v.sample(frac=1, random_state=random.Random(7).randint(0, 999))
                for k, v in CASES[l1][1]().items()}
    assert first and run(l1) == first == run(l1, shuffled)


@pytest.mark.parametrize("l1", sorted(CASES))
def test_seq_is_mapping_order_and_ids_exist(l1):
    doc = reference_document()
    l4_ids = {l4.id for l4 in doc.all_l4()}
    l5_ids = {a.id for l4 in doc.all_l4() for a in l4.activities}
    mod = builders.builder(l1)
    template = {m.l5_id: m for m in mod.MAPPING}
    for e in run(l1):
        row = template.get(e.l5_id) or next(m for m in mod.MAPPING if "<" in m.key and m.case_type == e.case_type
                                            and e.l5_id.startswith(m.l5_id.split("<")[0]))
        assert e.seq == row.order, e
        assert re.match(ID_PATTERN, e.l5_id) and re.match(ID_PATTERN, e.activity), e
        if f"{l1}-DSC-" in e.l5_id:
            assert e.l5_id.endswith("-01"), e.l5_id
        elif "-X_" in e.l5_id:
            assert e.l5_id.split("-X_")[0] in l4_ids, e.l5_id
        else:
            assert e.l5_id in l5_ids, e.l5_id
    assert all(m.l5_id.startswith(l1 + "-") for m in mod.MAPPING)


@pytest.mark.parametrize("l1,raw", [("HTR", PERNRS), ("SFX", SF_USERS)])
def test_no_raw_person_id_in_any_stored_column(l1, raw):
    ev = run(l1)
    assert ev
    for e in ev:
        text = repr(e.as_row())
        for value in raw:
            assert value not in text, (value, e)


@pytest.mark.parametrize("l1", ["HTR", "SFX"])
def test_person_hash_is_stable_per_tenant_and_differs_across_tenants(l1):
    a, b = run(l1, tenant="t1"), run(l1, tenant="t2")
    assert a == run(l1, tenant="t1")
    people = lambda ev: {e.case_id for e in ev if e.case_type == "emp_event"}  # noqa: E731
    assert people(a) and people(a).isdisjoint(people(b))


def test_htr_actions_infotypes_and_org_objects():
    ev = run("HTR")
    hire = [e for e in ev if e.case_id.endswith("/20260201/01")]
    assert [e.activity for e in hire] == ["RECORD_ACTION", "RECORD_REASON", "UPDATE_PERSONAL_DATA",
                                          "UPDATE_ORG_ASSIGNMENT", "UPDATE_PAY"]
    assert all(dict(e.org) == {"BUKRS": "1000", "PERSG": "1", "WERKS": "ZA01"} for e in hire)
    assert all(e.automated is False and e.ts_precision == "day" for e in hire)
    assert {e.resource for e in hire} == {hire[0].resource} and hire[0].resource != "HRADMIN"
    (other,) = [e for e in ev if e.case_id.endswith("/20260301/10")]
    assert other.activity == "RECORD_ACTION"  # no MASSG, no infotype records on that date
    org = [e for e in ev if e.case_type == "org_object"]
    assert {e.case_id for e in org} == {"01/O/50000001"}  # person objects (OTYPE P) are never cases
    assert [(e.activity, e.ts.date()) for e in org] == [("CREATE_ORG_OBJECT", date(2025, 12, 15)),
                                                        ("CREATE_RELATIONSHIP", date(2025, 12, 16))]


def test_mdg_change_request_lifecycle():
    ev = run("MDG")
    assert [e.activity for e in ev if e.case_id == "000000000101"] == [
        "CREATE_CR", "APPROVE_CR", "ACTIVATE_DATA", "LAST_CHANGE"]
    (create,) = by(ev, "CREATE_CR", "000000000101")
    assert create.ts == datetime(2026, 1, 5, 8, tzinfo=timezone.utc) and create.doc_type == "MAT01"
    # An unreleased request has only its creation; CHANGED_AT equal to CREATED_AT is not a later change.
    assert [e.activity for e in ev if e.case_id == "000000000102"] == ["CREATE_CR"]


def test_sfx_requisition_statuses_and_employee_events():
    ev = run("SFX")
    req = [e for e in ev if e.case_type == "requisition"]
    assert {e.case_id for e in req} == {"501"}  # application 9003 has no extracted requisition
    assert [e.activity for e in req] == ["CREATE_REQUISITION", "RECEIVE_APPLICATION", "RECEIVE_APPLICATION",
                                         "APPLICATION_REJECTED", "APPLICATION_OFFER_ACCEPTED"]
    (acc,) = by(ev, "APPLICATION_OFFER_ACCEPTED")
    assert acc.l5_id == "SFX-RCM-MANAGE_JOB_REQUISITIONS-X_APP_OFFER_ACCEPTED"
    assert acc.object_refs == (("applicationId", "9001"),) and dict(acc.attributes) == {"status": "Offer Accepted"}
    (create,) = by(ev, "CREATE_REQUISITION")
    assert create.ts == datetime(2026, 1, 5, 8, tzinfo=timezone.utc) and create.automated is None
    (hire,) = by(ev, "HIRE")
    assert hire.ts == datetime(2026, 2, 1, tzinfo=JNB) and hire.ts_precision == "day"
    assert hire.case_id.endswith("/2026-02-01/1") and dict(hire.org) == {"company": "ZA01"}
    (promo,) = by(ev, "EVENT_5")
    assert promo.l5_id == "SFX-DSC-EVENT_5-01" and promo.resource is None
    (time_rec,) = by(ev, "RECORD_TIME")
    assert time_rec.case_id.endswith("/2026-03-02/VAC") and dict(time_rec.attributes)["approvalStatus"] == "APPROVED"


def test_arb_contracts_expire_only_up_to_run_date():
    ev = run("ARB")
    assert [e.activity for e in ev if e.case_id == "C1"] == ["CONTRACT_EFFECTIVE", "CONTRACT_EXPIRED"]
    assert [e.activity for e in ev if e.case_id == "C2"] == ["CONTRACT_EFFECTIVE"]  # expires after RUN
    (req,) = by(ev, "CREATE_REQUISITION")
    assert req.resource != "buyer1" and len(req.resource) == 32 and req.case_type == "requisition"


def test_cnq_first_expense_then_submit_with_statuses_as_attributes():
    ev = run("CNQ")
    assert [e.activity for e in ev] == ["INCUR_EXPENSE", "SUBMIT_REPORT"]
    incur, submit = ev
    assert incur.ts == datetime(2026, 1, 10, tzinfo=JNB) and incur.ts_precision == "day"
    assert incur.object_refs == (("entryId", "E1"), ("entryId", "E2"))
    assert submit.resource != "emp1@corp" and len(submit.resource) == 32
    for e in ev:
        assert dict(e.attributes) == {"approvalStatus": "A_APPR", "paymentStatus": "P_PAID"}
    assert not any("APPR" in e.activity or "PAID" in e.activity for e in ev)


@pytest.mark.parametrize("l1", ["SFX", "ARB", "CNQ"])
def test_cloud_window_drops_older_events(l1):
    everything, windowed = run(l1, window=None), run(l1, window=date(2026, 1, 11))
    assert windowed and len(windowed) < len(everything)
    assert all(e.ts.date() >= date(2026, 1, 11) for e in windowed)


def test_arb_contract_from_before_the_window_is_dropped():
    assert [e.activity for e in run("ARB", window=None) if e.case_id == "C0"] == [
        "CONTRACT_EFFECTIVE", "CONTRACT_EXPIRED"]
    assert [e for e in run("ARB") if e.case_id == "C0"] == []


def test_missing_tables_yield_no_events():
    for l1 in CASES:
        assert run(l1, tables={}) == []


def test_iso_day_uses_local_date_near_midnight():
    ctx = make_context(MemoryFrames({}), "t1", "successfactors", RUN)
    # 22:30 UTC is 00:30 next day in Johannesburg (UTC+2); 23:30 on 31 Jan UTC is 1 Feb locally.
    assert iso_ts(ctx, "2026-01-31T23:30:00Z", day=True) == (datetime(2026, 2, 1, tzinfo=JNB), "day")
    assert iso_ts(ctx, "2026-01-31T21:30:00Z", day=True) == (datetime(2026, 1, 31, tzinfo=JNB), "day")
    ny = make_context(MemoryFrames({}), "t1", "successfactors", RUN, tz_name="America/New_York")
    assert iso_ts(ny, "2026-02-01T02:00:00Z", day=True)[0].date() == date(2026, 1, 31)
    assert iso_ts(ctx, "2026-01-31T23:30:00Z", day=True)[0].date() == sap_ts(ctx, "20260201")[0].date()


@pytest.mark.parametrize("l1,raw", [("ARB", "buyer1"), ("CNQ", "emp1@corp")])
def test_cloud_user_ids_are_hashed_not_stored_raw(l1, raw):
    resources = {e.resource for e in run(l1) if e.resource}
    assert resources and raw not in resources and all(len(r) == 32 for r in resources)

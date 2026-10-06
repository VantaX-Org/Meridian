"""Interface health and S/4HANA master data depth rules (IDH009+, S4C011+): integrity and conditional proofs."""
import json
import re
from datetime import datetime, timedelta

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"interface_health": ("IDH", 9, 42), "s4hc_master_data": ("S4C", 11, 31)}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")
RULES, NEW, MODULE = {}, [], {}
for _mod, (_prefix, _start, _) in PACKS.items():
    for _r in yaml.safe_load(open(f"checks/rules/ecc/{_mod}.yaml"))["rules"]:
        RULES[_r["id"]] = _r
        MODULE[_r["id"]] = _mod
        _num = _r["id"][len(_prefix):]
        if _r["id"].startswith(_prefix) and _num.isdigit() and int(_num) >= _start:
            NEW.append(_r)
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|BIRTH|DEATH|PFACH|PSTL|TEL|SMTP")
TECHNICAL = {"QNAME"}  # qRFC queue name, not a personal name
NOW = datetime.now()


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module=MODULE[rid])
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def _day(days_ago):
    return (NOW - timedelta(days=days_ago)).strftime("%Y%m%d")


# ---- integrity ---------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("mod", PACKS)
def test_new_ids_are_unique_and_contiguous(mod):
    prefix, start, count = PACKS[mod]
    pack = yaml.safe_load(open(f"checks/rules/ecc/{mod}.yaml"))["rules"]
    ids = [r["id"] for r in pack]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][len(prefix):]) for r in NEW if MODULE[r["id"]] == mod)
    assert new == list(range(start, start + count))


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1
        if r["check_class"] == "domain_value_check":
            assert r.get("valid_values_with_labels"), r["id"]


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        if r.get("time_field"):
            refs.add(r["time_field"])
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = _fields(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= set(target), r["id"]


def test_templates_and_messages_never_echo_personal_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert f in TECHNICAL or not SENSITIVE.search(f), (r["id"], f)


# ---- interface health --------------------------------------------------------------------------------------------

def test_status_freshness_only_for_its_direction_and_status():
    edidc = frame("EDIDC", DOCNUM=["1", "2", "3", "4"], DIRECT=["2", "2", "2", "1"], STATUS=["66", "66", "53", "66"],
                  MESTYP=["ORDERS"] * 4,
                  UPDDAT=[_day(3), _day(0), _day(3), _day(3)], UPDTIM=["000000"] * 4)
    # 1 stale; 2 recent; 3 other status (skipped); 4 outbound (skipped)
    assert fire("IDH009", {"EDIDC": edidc}) == (1, 2)


def test_direction_domain():
    edidc = frame("EDIDC", DOCNUM=["1", "2", "3"], DIRECT=["1", "2", "9"])
    assert fire("IDH021", {"EDIDC": edidc}) == (1, 3)


def test_changed_before_created():
    edidc = frame("EDIDC", DOCNUM=["1", "2"], CREDAT=[_day(5), _day(5)], UPDDAT=[_day(6), _day(4)])
    assert fire("IDH027", {"EDIDC": edidc}) == (1, 2)


def test_inbound_idoc_with_outbound_status():
    edidc = frame("EDIDC", DOCNUM=["1", "2", "3"], DIRECT=["2", "2", "1"], STATUS=["03", "53", "03"],
                  MESTYP=["ORDERS"] * 3)
    assert fire("IDH029", {"EDIDC": edidc}) == (1, 2)


def test_status_record_before_control_record():
    edidc = frame("EDIDC", DOCNUM=["1", "2"], CREDAT=[_day(5), _day(5)])
    edids = frame("EDIDS", DOCNUM=["1", "2"], COUNTR=["1", "1"], LOGDAT=[_day(6), _day(5)])
    assert fire("IDH035", {"EDIDC": edidc, "EDIDS": edids}) == (1, 2)


def test_stopped_inbound_queue_older_than_a_day():
    q = frame("TRFCQIN", QNAME=["A", "B", "C"], QSTATE=["STOP", "STOP", "READY"],
              QRFCDATUM=[_day(3), _day(0), _day(3)], QRFCUZEIT=["000000"] * 3)
    assert fire("IDH043", {"TRFCQIN": q}) == (1, 2)


# ---- S/4HANA business partner ------------------------------------------------------------------------------------

def test_supplier_role_needs_the_financial_role():
    but100 = frame("BUT100", PARTNER=["B1", "B1", "B2", "B3"], RLTYP=["FLVN01", "FLVN00", "FLVN01", "FLCU01"])
    # B1 has both; B2 lacks FLVN00; B3 other role (skipped)
    assert fire("S4C012", {"BUT100": but100}) == (1, 2)


def test_central_block_must_reach_the_supplier():
    link = frame("CVI_VEND_LINK", PARTNER_GUID=["G1", "G2", "G3"], VENDOR=["V1", "V2", "V3"])
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], PARTNER_GUID=["G1", "G2", "G3"], XBLCK=["X", "X", ""])
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], SPERR=["", "X", ""], LOEVM=["", "", ""])
    assert fire("S4C014", {"CVI_VEND_LINK": link, "BUT000": but000, "LFA1": lfa1})[0] == 1


def test_supplier_name_drift_ignores_case_and_persons():
    link = frame("CVI_VEND_LINK", PARTNER_GUID=["G1", "G2", "G3"], VENDOR=["V1", "V2", "V3"])
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], PARTNER_GUID=["G1", "G2", "G3"], TYPE=["2", "2", "1"],
                   NAME_ORG1=["Acme Ltd", "Acme Ltd", "Acme Ltd"])
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], NAME1=["ACME LTD", "Other Co", "Other Co"])
    assert fire("S4C020", {"CVI_VEND_LINK": link, "BUT000": but000, "LFA1": lfa1}) == (1, 2)


def test_future_birth_date_only_for_persons():
    future = (NOW + timedelta(days=30)).strftime("%Y%m%d")
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], TYPE=["1", "1", "2"], BIRTHDT=[future, "19800101", future])
    assert fire("S4C028", {"BUT000": but000}) == (1, 2)


def test_cross_reference_points_to_another_supplier():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2", "V3"], KUNNR=["C1", "C2", ""])
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LIFNR=["V1", "V9"])
    assert fire("S4C030", {"LFA1": lfa1, "KNA1": kna1}) == (1, 2)


def test_one_sided_cross_reference():
    lfa1 = frame("LFA1", LIFNR=["V1", "V2"], KUNNR=["C1", "C2"])
    kna1 = frame("KNA1", KUNNR=["C1", "C2"], LIFNR=["V1", ""])
    assert fire("S4C041", {"LFA1": lfa1, "KNA1": kna1}) == (1, 2)


def test_stocked_product_without_plant_skips_deleted_and_services():
    mara = frame("MARA", MATNR=["M1", "M2", "M3", "M4"], MTART=["FERT", "ROH", "ROH", "DIEN"], LVORM=["", "", "X", ""])
    marc = frame("MARC", MATNR=["M1"], WERKS=["1000"])
    assert fire("S4C031", {"MARA": mara, "MARC": marc}) == (1, 2)


def test_trading_good_at_standard_price():
    mara = frame("MARA", MATNR=["M1", "M2", "M3"], MTART=["HAWA", "HAWA", "FERT"])
    marc = frame("MARC", MATNR=["M1", "M2", "M3"], WERKS=["1000"] * 3)
    mbew = frame("MBEW", MATNR=["M1", "M2", "M3"], BWKEY=["1000"] * 3, VPRSV=["S", "V", "S"])
    assert fire("S4C039", {"MARA": mara, "MARC": marc, "MBEW": mbew}) == (1, 2)

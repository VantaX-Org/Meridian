"""Quality management, project system and business partner depth rules (QM079+, PS081+, BP227+): integrity and conditional proofs."""
import json
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = {"quality_management": ("QM", 79, 55), "project_system": ("PS", 81, 35), "business_partner": ("BP", 227, 22)}
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
# keys a similarity rule may report as evidence
KEYS = {"KUNNR", "BUKRS", "VKORG", "VTWEG", "SPART", "PARVW", "PARTNER", "CUSTOMER", "VENDOR", "KKBER", "PARNR",
        "KUNN2", "LIFNR", "KNRZE", "KNRZB", "FISKN", "AKONT", "ADRNR", "ADDRNUMBER", "BKVID", "BANKS", "LAND1",
        "ALAND", "TATYP", "KTOKD", "VBUND", "ZTERM", "RLTYP", "KNKLI", "PLNNR", "PLNTY", "PRUEFLOS", "QMATN", "PSPNR", "AUFNR", "RELNR", "MATNR", "ZAEHL"}
SENSITIVE = re.compile(r"NAME|ORT|CITY|POST|STRAS|STCD|STCEG|BANKN|BANKL|IBAN|BKONT|BIRTH|DEATH|PFACH|PSTL|TEL|SMTP")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module=MODULE[rid])
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _fields(table):
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


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


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {}), *r.get("block_by", [])}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        if r.get("evidence_key"):
            refs.add(r["evidence_key"])
        for f in refs:
            table, name = f.split(".")
            assert name in _fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = _fields(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when", {})) <= set(target), r["id"]


def test_referential_rules_have_a_check_table():
    for r in NEW:
        if r["check_class"] == "referential_check":
            table, name = r["field"].split(".")
            assert _fields(table)[name].get("check_table"), r["id"]


def test_templates_and_messages_never_echo_personal_values():
    for r in NEW:
        for f in re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", r["record_fix_template"] + r["message"]):
            assert not SENSITIVE.search(f), (r["id"], f)
        if r["check_class"] == "similarity_check":
            assert r["evidence_key"].split(".")[1] in KEYS, r["id"]


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"KNA1": frame("KNA1", KUNNR=["C1"]), "KNB1": frame("KNB1", KUNNR=["C1"], BUKRS=["1000"]),
              "BUT000": frame("BUT000", PARTNER=["B1"])}
    for r in NEW:
        _, res = run_rule(dict(r), TableFrames(tables, DDIC, module=MODULE[r["id"]]), {})
        assert res is None or not res.error or "reference" in res.error.lower(), (r["id"], res.error)


# ---- conditional proofs ------------------------------------------------------------------------------------------

def test_role_without_cvi_link_skips_other_roles_and_archived_partners():
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3", "B4"], PARTNER_GUID=["G1", "G2", "G3", "G4"],
                   XDELE=["", "", "X", ""])
    but100 = frame("BUT100", PARTNER=["B1", "B2", "B3", "B4"], RLTYP=["FLCU00", "FLCU00", "FLCU00", "BUP001"])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G2"], CUSTOMER=["C2"])
    # B1 flagged; B2 linked; B3 archived (skipped); B4 other role (skipped)
    assert fire("BP227", {"BUT000": but000, "BUT100": but100, "CVI_CUST_LINK": link}) == (1, 2)


def test_vendor_role_without_link():
    but000 = frame("BUT000", PARTNER=["B1", "B2"], PARTNER_GUID=["G1", "G2"], XDELE=["", ""])
    but100 = frame("BUT100", PARTNER=["B1", "B2"], RLTYP=["FLVN00", "FLCU00"])
    link = frame("CVI_VEND_LINK", PARTNER_GUID=["G9"], VENDOR=["V9"])
    assert fire("BP228", {"BUT000": but000, "BUT100": but100, "CVI_VEND_LINK": link}) == (1, 1)


def test_same_number_rule_needs_the_flag_and_a_live_customer():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3", "C4"], KTOKD=["A", "A", "B", "A"], LOEVM=["", "", "", "X"])
    but000 = frame("BUT000", PARTNER=["B1", "C2", "B3", "B4"], PARTNER_GUID=["G1", "G2", "G3", "G4"])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G1", "G2", "G3", "G4"], CUSTOMER=["C1", "C2", "C3", "C4"])
    cvic = frame("CVIC_CUST_TO_BP1", ACCOUNT_GROUP=["A", "B"], SAME_NUMBER=["X", ""])
    t = {"KNA1": kna1, "BUT000": but000, "CVI_CUST_LINK": link, "CVIC_CUST_TO_BP1": cvic}
    # C1 differs from B1 (flagged); C2 equal; C3 group B has no flag; C4 flagged for deletion (skipped)
    assert fire("BP233", t) == (1, 3)


def test_central_block_must_be_mirrored_on_the_partner():
    kna1 = frame("KNA1", KUNNR=["C1", "C2", "C3"], SPERR=["X", "X", ""], LOEVM=["", "X", ""])
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3"], PARTNER_GUID=["G1", "G2", "G3"], XBLCK=["", "", ""])
    link = frame("CVI_CUST_LINK", PARTNER_GUID=["G1", "G2", "G3"], CUSTOMER=["C1", "C2", "C3"])
    assert fire("BP235", {"KNA1": kna1, "BUT000": but000, "CVI_CUST_LINK": link}) == (1, 2)


def test_contact_role_only_checked_for_contact_relationships():
    but050 = frame("BUT050", RELNR=["R1", "R2", "R3"], PARTNER1=["B1"] * 3, PARTNER2=["P1", "P2", "P3"],
                   RELTYP=["BUR001", "BUR001", "BUR002"])
    but100 = frame("BUT100", PARTNER=["P2"], RLTYP=["BUP001"])
    assert fire("BP241", {"BUT050": but050, "BUT100": but100}) == (1, 2)


def test_region_required_only_in_listed_countries():
    adrc = frame("ADRC", ADDRNUMBER=["1", "2", "3"], COUNTRY=["US", "US", "DE"], REGION=["", "TX", ""])
    assert fire("BP243", {"ADRC": adrc}) == (1, 2)


def test_iban_required_only_for_sepa_banks_with_an_account():
    bk = frame("BUT0BK", PARTNER=["B1"] * 4, BKVID=["1", "2", "3", "4"], BANKS=["DE", "DE", "US", "DE"],
               BANKN=["123", "456", "789", ""], IBAN=["", "DE00", "", ""])
    assert fire("BP246", {"BUT0BK": bk}) == (1, 2)


def test_old_blocked_partner_skips_archived_and_recent():
    but000 = frame("BUT000", PARTNER=["B1", "B2", "B3", "B4"], XBLCK=["X", "X", "X", ""],
                   XDELE=["", "X", "", ""], CHDAT=["20150101", "20150101", "20990101", "20150101"])
    assert fire("BP248", {"BUT000": but000}) == (1, 3)


def test_vendor_cvi_link_on_info_record_skips_deleted_records():
    qinf = frame("QINF", MATNR=["M1", "M2", "M3"], ZAEHL=["1", "1", "1"], LIEFERANT=["V1", "V2", "V3"],
                 LOEKZ=["", "", "X"])
    link = frame("CVI_VEND_LINK", PARTNER_GUID=["G1"], VENDOR=["V1"])
    assert fire("QM090", {"QINF": qinf, "CVI_VEND_LINK": link}) == (1, 2)


def test_open_lot_vendor_link_only_while_lot_is_open():
    qals = frame("QALS", PRUEFLOS=["L1", "L2", "L3"], LIFNR=["V1", "V2", "V2"], STAT35=["", "", "X"])
    link = frame("CVI_VEND_LINK", PARTNER_GUID=["G1"], VENDOR=["V1"])
    assert fire("QM100", {"QALS": qals, "CVI_VEND_LINK": link}) == (1, 2)


def test_completed_lot_archive_needs_usage_decision_and_age():
    qals = frame("QALS", PRUEFLOS=["L1", "L2", "L3"], STAT34=["X", "", "X"], STAT35=["X", "X", "X"],
                 ENSTEHDAT=["20150101", "20150101", "20990101"])
    assert fire("QM105", {"QALS": qals}) == (1, 3)


def test_inactive_material_assignment_only_when_plant_deleted():
    qmat = frame("QMAT", ART=["01", "01", "01"], MATNR=["M1", "M2", "M3"], WERKS=["P1"] * 3, AKTIV=["X", "X", ""])
    marc = frame("MARC", MATNR=["M1", "M2", "M3"], WERKS=["P1"] * 3, LVORM=["X", "", "X"])
    assert fire("QM080", {"QMAT": qmat, "MARC": marc}) == (1, 2)


def test_closed_project_wbs_archive_needs_status_and_age():
    proj = frame("PROJ", PSPNR=["1", "2"], OBJNR=["PD1", "PD2"])
    prps = frame("PRPS", PSPNR=["10", "20", "30"], PSPHI=["1", "2", "1"], LOEVM=["", "", "X"],
                 AEDAT=["20150101", "20150101", "20150101"], OBJNR=["P1", "P2", "P3"])
    jest = frame("JEST", OBJNR=["PD1"], STAT=["I0046"], INACT=[""])
    aff, tot = fire("PS100", {"PROJ": proj, "PRPS": prps, "JEST": jest})
    assert aff == 1 and tot >= 1


def test_unchanged_project_archive_skips_deleted_flag_and_recent_changes():
    proj = frame("PROJ", PSPNR=["1", "2", "3"], LOEVM=["", "", "X"], AEDAT=["20150101", "20990101", "20150101"])
    assert fire("PS102", {"PROJ": proj}) == (1, 2)


def test_activity_vendor_link_skips_deleted_activities():
    afvc = frame("AFVC", AUFPL=["1", "2", "3"], APLZL=["1"] * 3, LIFNR=["V1", "V2", "V3"], LOEKZ=["", "", "X"])
    link = frame("CVI_VEND_LINK", PARTNER_GUID=["G1"], VENDOR=["V1"])
    assert fire("PS112", {"AFVC": afvc, "CVI_VEND_LINK": link}) == (1, 2)

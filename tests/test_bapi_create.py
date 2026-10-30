"""Creating master data through BAPIs (sap/bapi_create.py) against a fake connector that records every call."""
from __future__ import annotations

from sap import bapi_create as bc
from sap import bapi_writeback as bw
from tests.fake_sap_create import FakeSAP

MAT = {"MARA.MTART": "FERT", "MARA.MBRSH": "M", "MARA.MEINS": "EA", "MAKT.MAKTX": "Hex bolt M8", "MAKT.SPRAS": "E",
       "MARA.MATKL": "01", "MARC.WERKS": "1000", "MARC.PLIFZ": "12"}
CUST = {"KNA1.NAME1": "North Mill Ltd", "KNA1.LAND1": "ZA", "KNA1.ORT01": "Durban", "KNA1.PSTLZ": "4001",
        "KNVV.VSBED": "01"}


def test_the_plan_lists_what_goes_by_bapi_what_by_file_and_what_is_missing():
    p = bc.plan_create("material", {**MAT, "MARC.NFMAT": "X"})
    assert p.problems == [] and p.keys == {"SPRAS": "E", "WERKS": "1000"}
    assert set(p.fields) == {"MARA.MTART", "MARA.MBRSH", "MARA.MEINS", "MAKT.MAKTX", "MARA.MATKL", "MARC.PLIFZ"}
    assert p.export == [{"field": "MARC.NFMAT", "reason": "No create mapping for MARC.NFMAT in BAPI_MATERIAL_SAVEDATA; "
                                                          "it goes with the load file"}]
    assert bc.plan_create("material", {"MARA.MTART": "FERT"}).problems == [
        "MARA.MBRSH is required to create a material", "MARA.MEINS is required to create a material",
        "MAKT.MAKTX is required to create a material", "MAKT.SPRAS is required to create a material"]
    c = bc.plan_create("customer", CUST)
    assert c.roles == ["FLCU00"] and c.fields["BUT000.NAME_ORG1"] == "North Mill Ltd" and c.fields["BUT000.TYPE"] == "2"
    assert c.export[0]["field"] == "KNVV.VSBED" and "CMD_EI_API" in c.export[0]["reason"]
    assert bc.plan_create("business_partner", {"BUT000.TYPE": "1"}).problems == [
        "BUT000.NAME_LAST is required to create a person"]


def test_material_with_internal_number_simulates_then_creates_and_commits():
    sap, phases = FakeSAP(), []
    r = bc.create(sap, "material", MAT, on_phase=phases.append)
    assert sap.names() == [bc.GETINTNUMBER, bc.SAVEDATA, bc.SAVEDATA, bw.COMMIT]
    num, sim, real, commit = [p for n, p in sap.calls if n in (bc.GETINTNUMBER, bc.SAVEDATA, bw.COMMIT)]
    assert num == {"MATERIAL_TYPE": "FERT", "INDUSTRY_SECTOR": "M", "REQUIRED_NUMBERS": 1}
    assert sim["TESTRUN"] == "X" and "TESTRUN" not in real and commit == {"WAIT": "X"}
    assert real["HEADDATA"] == {"MATERIAL": "000000000000004711", "MATL_TYPE": "FERT", "IND_SECTOR": "M",
                                "BASIC_VIEW": "X", "MRP_VIEW": "X"}
    assert real["CLIENTDATA"] == {"BASE_UOM": "EA", "MATL_GROUP": "01"}
    assert real["PLANTDATA"] == {"PLANT": "1000", "PLND_DELRY": "12"}
    assert real["MATERIALDESCRIPTION"] == [{"LANGU": "E", "MATL_DESC": "Hex bolt M8"}]
    assert r.committed and r.key == "MATNR=000000000000004711" and phases == ["committing", "committed"]


def test_material_with_external_number_draws_none():
    sap = FakeSAP()
    r = bc.create(sap, "material", {**MAT, "MARA.MATNR": "BOLT-M8"})
    assert bc.GETINTNUMBER not in sap.names() and r.key == "MATNR=BOLT-M8" and r.committed


def test_an_e_message_in_the_simulation_sends_nothing_further():
    sap = FakeSAP(sim_returns={bc.SAVEDATA: {"TYPE": "E", "ID": "M3", "NUMBER": "305", "MESSAGE": "Plant 1000 unknown"}})
    r = bc.create(sap, "material", MAT)
    assert sap.names() == [bc.GETINTNUMBER, bc.SAVEDATA]
    assert not r.committed and not r.applied and r.key is None
    assert r.simulate_messages == [{"type": "E", "id": "M3", "number": "305", "message": "Plant 1000 unknown"}]


def test_an_e_message_in_the_real_call_rolls_back_and_never_commits():
    sap, phases = FakeSAP(returns={bc.SAVEDATA: {"TYPE": "A", "ID": "M3", "NUMBER": "1", "MESSAGE": "lock"}}), []
    r = bc.create(sap, "material", MAT, on_phase=phases.append)
    assert sap.names() == [bc.GETINTNUMBER, bc.SAVEDATA, bc.SAVEDATA, bw.ROLLBACK]
    assert not r.committed and r.key is None and phases == []


def test_without_testrun_the_simulation_is_a_call_and_a_rollback():
    sap = FakeSAP(testrun=False)
    r = bc.create(sap, "material", MAT)
    assert sap.names() == [bc.GETINTNUMBER, bc.SAVEDATA, bw.ROLLBACK, bc.SAVEDATA, bw.COMMIT] and r.committed


def test_a_field_the_release_lacks_stops_the_create_before_anything_is_sent():
    sap = FakeSAP(drop=((bc.SAVEDATA, "PLANTDATA.PLND_DELRY"),))
    r = bc.create(sap, "material", MAT)
    assert sap.names() == [] and r.error == "BAPI_MATERIAL_SAVEDATA PLANTDATA has no field PLND_DELRY on this release"


def test_a_release_without_the_create_function_is_unavailable():
    sap = FakeSAP(missing=(bc.BP_CREATE,))
    r = bc.create(sap, "customer", CUST)
    assert sap.names() == [] and "BAPI_BUPA_CREATE_FROM_DATA is not available" in r.unavailable
    assert bc.create(FakeSAP(missing=(bc.GETINTNUMBER,)), "material", MAT).unavailable.startswith(bc.GETINTNUMBER)


def test_customer_through_the_business_partner_with_its_cvi_number():
    sap, phases = FakeSAP(), []
    r = bc.create(sap, "customer", CUST, on_phase=phases.append)
    assert sap.names() == [bc.BP_CREATE, bc.BP_CREATE, bc.ROLE_ADD_2, bw.COMMIT]
    sim, real, role = [p for n, p in sap.calls if n in (bc.BP_CREATE, bc.ROLE_ADD_2)]
    assert sim["TESTRUN"] == "X" and real["PARTNERCATEGORY"] == "2"
    assert real["CENTRALDATAORGANIZATION"] == {"NAME1": "North Mill Ltd"}
    assert real["ADDRESSDATA"] == {"COUNTRY": "ZA", "CITY": "Durban", "POSTL_COD1": "4001"}
    assert role == {"BUSINESSPARTNER": "0000100042", "BUSINESSPARTNERROLE": "FLCU00"}
    assert r.committed and r.key == "PARTNER=0000100042|KUNNR=0000200077"
    assert r.export[0]["field"] == "KNVV.VSBED"


def test_a_refused_role_rolls_back_the_partner_too():
    sap = FakeSAP(returns={bc.ROLE_ADD_2: {"TYPE": "E", "ID": "R11", "NUMBER": "1", "MESSAGE": "role"}})
    r = bc.create(sap, "vendor", {"LFA1.NAME1": "Acme"})
    assert sap.names() == [bc.BP_CREATE, bc.BP_CREATE, bc.ROLE_ADD_2, bw.ROLLBACK] and not r.committed


def test_older_releases_use_role_add_and_a_separate_address_call():
    sap = FakeSAP(missing=(bc.ROLE_ADD_2,), bp_address=False, cvi=None)
    r = bc.create(sap, "customer", CUST)
    assert sap.names() == [bc.BP_CREATE, bc.BP_CREATE, bc.ADDRESS_ADD, bc.ROLE_ADD, bw.COMMIT]
    assert r.key == "PARTNER=0000100042" and "could not read the customer number" in r.note

"""load_config(): one snapshot shape for every connector; objects a system cannot expose are a state, not an error."""

import pandas as pd
import pytest

from sap.base import CloudSAPConnector, SAPConnector
from sap.config_loader import abap_objects, load_abap, load_cloud
from sap.config_snapshot import ConfigSnapshot
from sap.process_definitions import flow_config_tables

TABLES = {
    "TVAK": pd.DataFrame({"AUART": ["OR", "ZOR"], "VBTYP": ["C", "C"], "FKARV": ["F2", "ZF"]}),
    "T161": pd.DataFrame(),  # read fine, no rows
}


class FakeRFC:
    def read_table_full(self, table, fields, key_fields, where=None, max_rows=0):
        if table == "T156":
            raise RuntimeError("boom")
        if table not in TABLES and table != "T161":
            raise RuntimeError("TABLE_NOT_AVAILABLE")
        return TABLES[table]

    def read_table(self, table, fields, where=None, max_rows=0):
        return self.read_table_full(table, fields, [], where, max_rows)


def test_abap_reads_every_table_flow_derivation_needs():
    for system in ("ecc", "s4hana_onprem"):
        assert set(flow_config_tables()) <= set(abap_objects(system))
    assert {"CVI_CUST_LINK"} <= set(abap_objects("s4hana_onprem"))
    assert "CVI_CUST_LINK" not in abap_objects("ecc")


def test_abap_snapshot_keyed_by_object_and_key_with_states():
    snap = load_abap(FakeRFC(), "ecc")
    assert isinstance(snap, ConfigSnapshot) and (snap.role, snap.origin) == ("source", "connection")
    keys = {i.key for i in snap.items if i.object == "TVAK"}
    assert keys == {"AUART=OR", "AUART=ZOR"}
    assert snap.objects["TVAK"].state == "loaded" and snap.objects["TVAK"].rows == 2
    assert snap.objects["T161"].state == "empty"
    assert snap.objects["T156"].state == "failed"
    assert snap.objects["TQ30"].state == "not_available"
    assert list(snap.frames()["TVAK"]["AUART"]) == ["OR", "ZOR"]


@pytest.mark.parametrize("system_type", ["ariba", "s4hana_cloud", "btp"])
def test_systems_without_config_api_report_not_available(system_type):
    snap = load_cloud(object(), system_type)
    assert snap.objects["*"].state == "not_available"
    assert snap.items == []


class FakeSF:
    def read_entity_set(self, entity_set, select=None, filter_expr=None, top=0):
        if entity_set == "PickListValueV2":
            return pd.DataFrame({"PickListV2_id": ["a"], "externalCode": ["x"], "status": ["ACTIVE"]})
        if entity_set == "FOPayGroup":
            return pd.DataFrame({"externalCode": ["EU1", "EU2"], "name": ["Europe", "Europe 2"]})
        raise RuntimeError("HTTP 403 forbidden")

    def metadata(self, entity=None):
        return '<Schema><EntityType Name="FOPayGroup"/><EntityType Name="User"/></Schema>'


def test_successfactors_snapshot():
    snap = load_cloud(FakeSF(), "successfactors")
    assert {i.key for i in snap.items if i.object == "FOPayGroup"} == {"externalCode=EU1", "externalCode=EU2"}
    assert {i.key for i in snap.items if i.object == "ODATA_ENTITY"} == {"name=FOPayGroup", "name=User"}
    assert snap.objects["MDF_OBJECT_DEFINITION"].state == "not_available"
    assert snap.objects["BUSINESS_RULE"].state == "not_available"
    assert any(s.state == "not_available" and "not exposed" in s.detail for s in snap.objects.values())


class FakeConcur:
    def _read_endpoint(self, path, select=None, filter_expr=None, top=0):
        if path.endswith("expensetypes"):
            return pd.DataFrame({"Code": ["MEALS"], "Name": ["Meals"]})
        raise RuntimeError("HTTP 404 not found")


def test_concur_snapshot():
    snap = load_cloud(FakeConcur(), "concur")
    assert snap.objects["ExpenseType"].state == "loaded"
    assert [i.key for i in snap.items] == ["Code=MEALS"]
    assert snap.objects["Policy"].state == "not_available"


def test_every_connector_family_has_load_config():
    assert callable(SAPConnector.load_config) and callable(CloudSAPConnector.load_config)

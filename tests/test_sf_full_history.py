"""history="full": SF effective-dated entities read from 1900-01-01 to 9999-12-31 and keyed on their
$metadata date key, Foundation objects and picklists pulled along, CDHDR/CDPOS archived on ABAP.
Synthetic metadata and values only; no system is contacted."""
import pandas as pd
import pytest

from api.services.connectivity_manager import ConnectivityManager
from sap.ddic import get_dictionary
from sap.successfactors import FULL_HISTORY, SuccessFactorsConnector, entity_keys, history_props

EDMX = """<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
<edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2008/09/edm" Namespace="SFOData">
<EntityType Name="Position"><Key><PropertyRef Name="code"/><PropertyRef Name="effectiveStartDate"/></Key>
  <Property Name="code"/><Property Name="effectiveStartDate"/><Property Name="department"/></EntityType>
<EntityType Name="EmpJob"><Key><PropertyRef Name="seqNumber"/><PropertyRef Name="startDate"/>
  <PropertyRef Name="userId"/></Key><Property Name="seqNumber"/><Property Name="startDate"/>
  <Property Name="userId"/></EntityType>
<EntityType Name="FODepartment"><Key><PropertyRef Name="externalCode"/><PropertyRef Name="startDate"/></Key>
  <Property Name="externalCode"/><Property Name="startDate"/><Property Name="parentDepartment"/></EntityType>
<EntityType Name="User"><Key><PropertyRef Name="userId"/></Key><Property Name="userId"/>
  <Property Name="startDate"/></EntityType>
<EntityContainer Name="EC"><EntitySet Name="Position" EntityType="SFOData.Position"/>
  <EntitySet Name="EmpJob" EntityType="SFOData.EmpJob"/>
  <EntitySet Name="FODepartment" EntityType="SFOData.FODepartment"/>
  <EntitySet Name="User" EntityType="SFOData.User"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>"""

D = get_dictionary("s4hana")


def test_effective_dated_detection_from_metadata_keys():
    assert entity_keys(EDMX, "Position") == ["code", "effectiveStartDate"]
    assert history_props(entity_keys(EDMX, "Position"), set()) == ["effectiveStartDate"]
    assert history_props(entity_keys(EDMX, "EmpJob"), set()) == ["startDate", "seqNumber"]
    assert history_props(entity_keys(EDMX, "FODepartment"), set()) == ["startDate"]
    # a startDate property that is not part of the key does not make an entity effective dated
    assert history_props(entity_keys(EDMX, "User"), {"userId", "startDate"}) == []
    assert entity_keys(EDMX, "Nope") is None
    # without $metadata keys the entity's own properties decide
    assert history_props(None, {"code", "effectiveStartDate"}) == ["effectiveStartDate"]
    assert history_props(None, {"userId"}) == []


def test_read_entity_set_sends_from_and_to_date():
    sent = []

    class Resp:
        def json(self):
            return {"d": {"results": []}}

    c = SuccessFactorsConnector.__new__(SuccessFactorsConnector)
    c._client = object()
    c._ensure_connected = lambda: None
    c._request_with_retry = lambda method, url, params=None: sent.append(dict(params)) or Resp()
    c.read_entity_set("Position", select=["code"], **FULL_HISTORY)
    c.read_entity_set("Position", select=["code"])
    assert sent[0]["fromDate"] == "1900-01-01" and sent[0]["toDate"] == "9999-12-31"
    assert "fromDate" not in sent[1] and "toDate" not in sent[1]


class FakeSF:
    """Position history: one code held over two effective dates (the EC299 collision)."""

    def __init__(self):
        self.calls = []

    def metadata(self, entity=None):
        return EDMX

    def read_entity_set(self, ent, select=None, filter_expr=None, top=0, from_date=None, expand=None,
                        to_date=None):
        self.calls.append((ent, from_date, to_date, tuple(select or ())))
        if ent == "Position":
            rows = [{"code": "P1", "effectiveStartDate": "2020-01-01", "department": "D1"},
                    {"code": "P1", "effectiveStartDate": "2023-01-01", "department": "D2"}]
            if not to_date:  # today's record only
                rows = rows[1:]
            return pd.DataFrame(rows)[[s for s in select if s in rows[0]]]
        if ent == "PickListValueV2":
            return pd.DataFrame({"PickListV2_id": ["x"], "externalCode": ["A"], "status": ["ACTIVE"],
                                 "optionId": ["1"]})
        return pd.DataFrame()


def _run(monkeypatch, history):
    import api.services.source_design as sd
    import api.services.source_overrides as so
    import checks.frames as cf
    import checks.runner as cr

    monkeypatch.setattr(cr, "_find_module_yaml", lambda m: type("P", (), {"read_text": lambda s: "rules: [{}]"})())
    monkeypatch.setattr(cf, "tables_of", lambda cols: {"POSITION"})
    monkeypatch.setattr(sd, "latest_snapshot_id", lambda s, i: None)
    monkeypatch.setattr(so, "resolve_source", lambda st, sid, t, f, canonical: canonical)
    mgr = ConnectivityManager.__new__(ConnectivityManager)
    mgr.session = None
    conn = FakeSF()
    frames, coverage = mgr._extract_successfactors(conn, ["employee_central"], D, None, history)
    return conn, frames, {c["table"]: c for c in coverage}


def test_full_history_keys_position_on_code_and_effective_date(monkeypatch):
    conn, frames, cov = _run(monkeypatch, "full")
    pos = frames["POSITION"]
    assert len(pos) == 2 and set(pos["POSITION.DEPARTMENT"]) == {"D1", "D2"}
    assert cov["POSITION"]["history"] == "full"
    assert cov["POSITION"]["keys"] == ["CODE", "EFFECTIVE_START_DATE"]
    assert cov["POSITION"]["duplicate_keys"] == 0  # the code repeats, code + effective date does not
    assert ("Position", "1900-01-01", "9999-12-31") == next(c for c in conn.calls if c[0] == "Position")[:3]
    # every SF canonical table is attempted, so every effective-dated entity's history comes along
    canonical = {t.name for t in D.tables.values() if t.provenance.startswith("canonical:successfactors")}
    assert canonical <= set(cov)


def test_default_mode_is_unchanged(monkeypatch):
    conn, frames, cov = _run(monkeypatch, None)
    assert len(frames["POSITION"]) == 1
    assert "history" not in cov["POSITION"] and "PICKLIST_OPTION" not in cov and "FODEPARTMENT" not in cov
    assert all(c[2] is None for c in conn.calls)


def test_picklists_read_once_each_with_legacy_fallback():
    calls = []

    class Conn:
        def read_entity_set(self, ent, select=None, filter_expr=None):
            calls.append((ent, tuple(select), filter_expr))
            if "optionId" in select:
                raise RuntimeError("optionId not viewable")
            return pd.DataFrame({k: ["v"] for k in select})

    frames, coverage = {}, []
    ConnectivityManager._sf_picklists(Conn(), D, {"EMPEMPLOYMENT"}, frames, coverage)
    names = coverage[-1]["picklists"]
    assert names and len(calls) == 2 * len(names)
    assert all(c[0] == "PickListValueV2" and c[2] == f"PickListV2_id eq '{n}'"
               for c, n in zip(calls[1::2], names))
    assert list(frames["PICKLIST_OPTION"].columns) == ["PICKLIST_OPTION.PickListV2_id",
                                                       "PICKLIST_OPTION.externalCode", "PICKLIST_OPTION.status"]


def test_change_documents_archive_by_table_then_class():
    ecc = get_dictionary("ecc6")
    if ecc.table("CDHDR") is None:
        pytest.skip("ecc6 dictionary has no CDHDR")
    reads = []

    class Abap:
        def read_table_full(self, table, fields, keys, where=None):
            reads.append((table, where))
            v = where.split("'")[1]
            # a change logged against T001 under a class sap/change_documents.py does not map
            return pd.DataFrame({"OBJECTCLAS": ["SYNTHCLASS" if v == "T001" else "MATERIAL"], "OBJECTID": ["X"]})

    sunk, coverage = {}, []
    ConnectivityManager._change_document_archive(Abap(), ecc, {"MARA": 1, "KNA1": 1, "T001": 1}, coverage, {},
                                                 lambda t, df, e: sunk.update({t: df}))
    assert [w for t, w in reads if t == "CDPOS"] == [f"TABNAME = '{t}'" for t in ("KNA1", "MARA", "T001")]
    # the mapped classes plus every class CDPOS named
    assert [w for t, w in reads if t == "CDHDR"] == [f"OBJECTCLAS = '{c}'" for c in ("DEBI", "MATERIAL", "SYNTHCLASS")]
    assert all(c["archive_only"] and c["status"] == "live" for c in coverage)
    assert list(sunk["CDHDR"].columns) == ["CDHDR.OBJECTCLAS", "CDHDR.OBJECTID"]


def test_change_documents_gap_reported_when_nothing_is_planned():
    coverage = []
    ConnectivityManager._change_document_archive(None, get_dictionary("ecc6"), {}, coverage, {}, None)
    assert [(c["table"], c["status"]) for c in coverage] == [("CDPOS", "not_in_system"), ("CDHDR", "not_in_system")]

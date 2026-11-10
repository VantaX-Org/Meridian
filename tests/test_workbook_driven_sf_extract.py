"""Workbook columns drive the SuccessFactors extract: learned in the tenant's spelling, read across country sets."""

from api.services.migration import workbook as wb
from sap.ddic import get_dictionary
from sap.successfactors import entity_sets, resolve_property

D = get_dictionary("s4hana")


def test_resolve_property_finds_the_tenant_spelling():
    props = {"startDate", "cust_grade", "name_en_US", "externalCode", "status"}
    navs = {"companyNav": {"externalCode", "name"}}
    assert resolve_property("startDate", props, navs) == "startDate"
    assert resolve_property("effectiveStartDate", props, navs) == "startDate"
    assert resolve_property("effectiveStatus", props, navs) == "status"
    assert resolve_property("name.en_US", props, navs) == "name_en_US"
    assert resolve_property("grade", props, navs) == "cust_grade"
    assert resolve_property("companyNav", props, navs) == "companyNav.externalCode"
    assert resolve_property("companyNav.name", props, navs) == "companyNav.name"
    assert resolve_property("nothingLikeIt", props, navs) is None


def test_entity_sets_lists_one_family():
    edmx = '<EntitySet Name="PerGlobalInfoUSA" EntityType="x"/><EntitySet Name="PerGlobalInfoZAF"/><EntitySet Name="PerPerson"/>'
    assert entity_sets(edmx, "PerGlobalInfo") == ["PerGlobalInfoUSA", "PerGlobalInfoZAF"]


def test_camel_turns_column_ids_into_properties():
    assert wb._camel("custom-string1") == "customString1"
    assert wb._camel("job code") == "jobCode"
    assert wb._camel("name.en_US") == "name_en_US"
    assert wb._camel("genericString7") == "genericString7"


def test_learn_takes_kebab_and_family_columns():
    book = wb.Workbook([
        wb.Sheet("CSF Personal Info (Global Info)", "definition",
                 [wb.Column(header=h, id=h) for h in ("person-id-external", "generic-string7")]),
        wb.Sheet("CSF Job Info", "definition", [wb.Column(header="custom-string42", id="custom-string42")]),
    ], {})
    out = wb.learn(book, D)
    assert out["PER_GLOBAL_INFO"] == {"GENERIC_STRING7": "PerGlobalInfo*.genericString7"}
    assert any(v == "EmpJob.customString42" for fields in out.values() for v in fields.values())


class _Fake:
    """A connector with two country sets of one family; rows carry no personal data."""

    def metadata(self):
        return '<EntitySet Name="FOJobClassLocalUSA"/><EntitySet Name="FOJobClassLocalZAF"/>'


def test_family_lists_every_country_set():
    from api.services.connectivity_manager import ConnectivityManager
    cm = ConnectivityManager.__new__(ConnectivityManager)
    cm._sf_edmx = None
    assert cm._sf_family(_Fake(), "FOJobClassLocal") == ["FOJobClassLocalUSA", "FOJobClassLocalZAF"]


def test_kebab_column_id_is_marked_from_its_camel_property():
    from api.routes.migration import _mark_learned
    report = {"sheets": [{"unmapped": [{"id": "generic-string7"}, {"id": "custom-string1"}]}]}
    assert _mark_learned(report, {"genericString7": True, "customString1": False}) == (1, 1)
    assert [c["not_in_system"] for c in report["sheets"][0]["unmapped"]] == [True, False]


def _service(sets: dict[str, list[str]]) -> str:
    types = "".join(f'<EntityType Name="{e}"><Key><PropertyRef Name="{p[0]}"/></Key>'
                    + "".join(f'<Property Name="{x}" Type="Edm.String"/>' for x in p) + "</EntityType>"
                    for e, p in sets.items())
    es = "".join(f'<EntitySet Name="{e}" EntityType="SFOData.{e}"/>' for e in sets)
    return ('<?xml version="1.0" encoding="utf-8"?>'
            '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">'
            '<edmx:DataServices><Schema Namespace="SFOData" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">'
            f'{types}<EntityContainer Name="EntitiesV2">{es}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>')


def test_family_extract_fills_country_from_the_set_name(monkeypatch):
    from tests.checks.test_cloud_rules import _sf, _Tenant

    props = ["externalCode", "startDate", "status"]
    sets = {"FOJobClassLocalUSA": props, "FOJobClassLocalZAF": props}
    conn = _Tenant({e: (p, ()) for e, p in sets.items()},
                   {"FOJobClassLocalUSA": [{"externalCode": "J1", "startDate": "2024-01-01", "status": "A"}],
                    "FOJobClassLocalZAF": [{"externalCode": "J1", "startDate": "2024-01-01", "status": "A"}]})
    per_entity = []
    one = conn.metadata
    conn.metadata = lambda entity=None: _service(sets) if entity is None else (per_entity.append(entity), one(entity))[1]
    frames, cov = _sf(conn, ["employee_central"], monkeypatch)
    df = frames["FO_JOB_CLASS_LOCAL"]
    assert sorted(df["FO_JOB_CLASS_LOCAL.COUNTRY"]) == ["USA", "ZAF"]
    assert not [e for e in per_entity if e.startswith("FOJobClassLocal")]
    assert cov["FO_LEGAL_ENTITY_LOCAL"]["status"] != "live"

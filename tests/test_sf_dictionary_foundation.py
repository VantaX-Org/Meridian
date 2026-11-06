"""SuccessFactors dictionary: foundation entities and workbook-derived fields."""
from pathlib import Path

import yaml

P = Path(__file__).resolve().parents[1] / "sap/dictionaries/canonical/successfactors.yaml"
TABLES = yaml.safe_load(P.read_text())["tables"]

NEW_ENTITIES = {
    "FOPAYGRADE": "FOPayGrade", "FOPAYRANGE": "FOPayRange", "FOPAYGROUP": "FOPayGroup",
    "FOFREQUENCY": "FOFrequency", "FOJOBFUNCTION": "FOJobFunction", "FOGEOZONE": "FOGeozone",
    "FOLOCATIONGROUP": "FOLocationGroup", "FOPAYCOMPONENT": "FOPayComponent",
    "FOPAYCOMPONENTGROUP": "FOPayComponentGroup", "FOPAYSCALETYPE": "FOPayScaleType",
    "FOPAYSCALEAREA": "FOPayScaleArea", "FOCORPORATEADDRESSDEFLT": "FOCorporateAddressDEFLT",
    "PERSOCIALACCOUNT": "PerSocialAccount",
}


def test_new_entities_present():
    for table, entity in NEW_ENTITIES.items():
        assert table in TABLES, table
        assert TABLES[table]["source"] == entity


def test_keys_are_fields_and_sources_unique():
    for name, t in TABLES.items():
        for k in t["keys"]:
            assert k in t["fields"], (name, k)
        if name == "PAYRESULT":  # pre-existing shared source
            continue
        srcs = [f["source"] for f in t["fields"].values()]
        assert len(srcs) == len(set(srcs)), name


def test_field_shape_and_unconfirmed_names_flagged():
    types = {"STRING", "DATE", "DATETIME", "DECIMAL", "INTEGER", "BOOLEAN"}
    for name in NEW_ENTITIES:
        for f, v in TABLES[name]["fields"].items():
            assert f == f.upper() and v["type"] in types, (name, f)
            assert "." in v["source"], (name, f)
            assert v.get("verify") is True, (name, f)  # not confirmed live


def test_foundation_links_resolve_to_new_tables():
    sources = {t["source"].split(",")[0].strip() for t in TABLES.values()}
    for t in TABLES.values():
        for f in t["fields"].values():
            if f.get("check_table") in NEW_ENTITIES.values():
                assert f["check_table"] in sources
    assert TABLES["FOJOBCODE"]["fields"]["PAY_GRADE"]["check_table"] == "FOPayGrade"
    assert TABLES["FOJOBCODE"]["fields"]["JOB_FUNCTION"]["check_table"] == "FOJobFunction"
    # COMPINFO/EMPEMPLOYMENT already point at pay grade and pay group; both now exist
    assert "FOPayGrade" in {t["source"] for t in TABLES.values()}
    assert "FOPayGroup" in {t["source"] for t in TABLES.values()}


def test_no_customer_extension_fields():
    for name, t in TABLES.items():
        for f, v in t["fields"].items():
            assert not v["source"].split(".")[-1].lower().startswith("cust"), (name, f)

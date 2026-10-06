"""SPRO menu paths: only tables flow derivation reads; attached to derived step evidence for ECC / S/4 on-prem."""

import pandas as pd

from api.services.config_intelligence.process_flow_derivation import derive_model
from sap.process_definitions import flow_config_tables
from sap.spro_paths import enrich_evidence, spro_paths


def test_every_path_table_is_read_by_flow_derivation():
    assert set(spro_paths()) <= set(flow_config_tables())


def test_entries_have_path_and_tcode():
    for table, e in spro_paths().items():
        assert e["path"].count(">") >= 2 and e["tcode"], table


def test_enrich_adds_path_to_evidence_only_for_abap_onprem():
    doc = {"l1": [{"evidence": [{"table": "TVAK", "keys": {"AUART": "OR"}, "value": "x"},
                                {"table": "ZUNKNOWN", "keys": {}, "value": ""}]}]}
    out = enrich_evidence(doc, "ecc")
    ev = out["l1"][0]["evidence"]
    assert ev[0]["tcode"] == "VOV8" and "Sales Document Types" in ev[0]["spro_path"]
    assert "spro_path" not in ev[1]
    cloud = {"evidence": [{"table": "TVAK", "keys": {}, "value": ""}]}
    assert enrich_evidence(cloud, "successfactors") == {"evidence": [{"table": "TVAK", "keys": {}, "value": ""}]}


def test_derived_step_evidence_carries_path():
    tvak = pd.DataFrame({"AUART": ["OR"], "VBTYP": ["C"], "FKARV": ["F2"], "LFARV": ["LF"]})
    doc = enrich_evidence(derive_model({"TVAK": tvak}, "ecc").model_dump(mode="json"), "ecc")
    found = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("table") == "TVAK" and "keys" in n:
                found.append(n)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(doc)
    assert found and all(e["tcode"] == "VOV8" for e in found)

"""Config derivation from synthetic config rows: variants, absent steps, client-specific nodes, ECC vs S/4."""

import pandas as pd
import pytest

from api.services.config_intelligence.process_flow_derivation import derive_model
from api.services.process_model_validator import validate_document


def _l4(doc, l4_id):
    return next(x for l1 in doc.l1 for l2 in l1.l2 for l3 in l2.l3 for x in l3.l4 if x.id == l4_id)


def _df(**cols):
    return pd.DataFrame(cols)


def test_no_tables_is_template():
    doc = derive_model({})
    assert doc.source == "template" and _l4(doc, "OTC-SO-VA01").status is None


def test_sd_variants_and_client_specific():
    doc = derive_model({"TVAK": _df(AUART=["OR", "ZOR1"]), "TVAP": _df(PSTYV=["TAN", "TANN"]),
                        "TVEP": _df(ETTYP=["CP"])})
    l4 = _l4(doc, "OTC-SO-VA01")
    assert doc.source == "config" and l4.status == "configured"
    assert {e.value for e in l4.evidence} == {"OR", "ZOR1"} and l4.evidence[0].table == "TVAK"
    assert {e.value for e in l4.config_variants} >= {"TAN", "CP"}
    cs = [a for a in l4.activities if a.status == "client_specific"]
    assert [a.name for a in cs] == ["Client-specific ZOR1"]
    assert not validate_document(doc).errors
    assert any(n.activity_id == cs[0].id for n in l4.diagram.nodes)


def test_step_absent_is_not_configured():
    doc = derive_model({"TVFK": _df(FKART=[])})
    assert _l4(doc, "OTC-BIL-VF01").status == "not_configured"


def test_where_filter_pm_order_type():
    t003o = _df(AUART=["PM01", "PP01"], AUTYP=["30", "10"])
    doc = derive_model({"T003O": t003o})
    assert [e.value for e in _l4(doc, "PM-PLN-IW31").evidence] == ["PM01"]
    assert [e.value for e in _l4(doc, "PP-ORD-CO01").evidence] == ["PP01"]


def test_alt_table_t163y():
    doc = derive_model({"T163Y": _df(SPRAS=["E", "E"], PSTYP=["0", "2"])})
    assert {e.value for e in _l4(doc, "PTP-PO-ME21N").config_variants} == {"0", "2"}


@pytest.mark.parametrize("system,tcode", [("ecc", "FK01"), ("s4hana_onprem", "BP")])
def test_ecc_vs_s4_vendor_step(system, tcode):
    assert _l4(derive_model({"TVAK": _df(AUART=["OR"])}, system), "PTP-VM-FK01").tcode == tcode


def test_detect_system_type():
    from api.services.config_intelligence.process_flow_derivation import detect_system_type
    assert detect_system_type({"BKPF": _df(A=[1])}) == "ecc"
    assert detect_system_type({"ACDOCA": _df(A=[1])}) == "s4hana_onprem"

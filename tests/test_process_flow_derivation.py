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


def _flow(doc):
    return {(e.source_kind, e.source_type, e.target_kind, e.target_type): e for e in _l4(doc, "OTC-SO-VA01").document_flow}


_TVAK = _df(AUART=["OR", "ZOR", "QT"], LFARV=["LF", "ZLF", ""], FKARV=["F2", "F2", ""], FKARA=["", "ZF1", ""])


def test_document_flow_from_copy_control():
    doc = derive_model({
        "TVAK": _TVAK, "TVLK": _df(LFART=["LF", "ZLF"]), "TVFK": _df(FKART=["F2", "ZF1"]),
        "TVCPL": _df(LFARN=["LF", "ZLF"], AUARV=["OR", "ZOR"], PSTYV=["TAN", "ZTAN"]),
        "TVCPF": _df(FKARN=["F2", "ZF1"], AUARV=["OR", "ZOR"], LFARV=["LF", ""], FKARV=["", ""], PSTYV=["TAN", ""]),
        "TVCPA": _df(AUARN=["OR", "ZZZ"], AUARV=["QT", "QT"], PSTYV=["AGN", ""], PSTYN=["TAN", ""])})
    f = _flow(doc)
    assert set(f) == {("order", "OR", "delivery", "LF"), ("order", "ZOR", "delivery", "ZLF"),
                      ("delivery", "LF", "billing", "F2"), ("order", "ZOR", "billing", "ZF1"),
                      ("order", "QT", "order", "OR")}  # ZZZ is not a TVAK type: dropped
    e = f[("order", "OR", "delivery", "LF")]
    assert e.item_categories == ["TAN"] and e.evidence[0].table == "TVCPL" and not e.client_specific
    assert e.evidence[0].keys["AUARV"] == "OR"
    assert f[("order", "ZOR", "delivery", "ZLF")].client_specific
    assert f[("order", "QT", "order", "OR")].evidence[0].keys["PSTYN"] == "TAN"
    assert doc.source == "config" and not validate_document(doc).errors


def test_document_flow_drops_unsupported_edges():
    # TVAK names LF for OR, but copy control only has a row for another delivery type
    doc = derive_model({"TVAK": _TVAK, "TVCPL": _df(LFARN=["XX"], AUARV=["OR"], PSTYV=[""]),
                        "TVCPF": _df(FKARN=["F9"], AUARV=["OR"], LFARV=[""], FKARV=[""], PSTYV=[""])})
    assert not _flow(doc)
    # delivery type missing from TVLK drops the TVAK-only edge too
    doc = derive_model({"TVAK": _TVAK, "TVLK": _df(LFART=["LF"])})
    assert ("order", "ZOR", "delivery", "ZLF") not in _flow(doc) and ("order", "OR", "delivery", "LF") in _flow(doc)


def test_document_flow_tvak_defaults_without_copy_control():
    f = _flow(derive_model({"TVAK": _TVAK}))
    assert f[("order", "OR", "delivery", "LF")].evidence[0].table == "TVAK"
    assert ("delivery", "LF", "billing", "F2") in f and ("order", "ZOR", "billing", "ZF1") in f


def test_ptp_reversal_movement_types():
    doc = derive_model({"T156": _df(BWART=["101", "102", "Z01"], XSTBW=["", "X", "X"])})
    l4 = _l4(doc, "PTP-GR-MIGO")
    assert {e.value for e in l4.evidence} == {"101", "102", "Z01"}
    assert {e.value for e in l4.config_variants} == {"102", "Z01"}
    assert l4.config_variants[0].keys["XSTBW"] == "X"

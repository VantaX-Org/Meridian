"""Three-way baseline: what each finding was judged against."""

import pandas as pd

from checks.ddic_conformance import run_conformance
from checks.deviation import deviation, standard_lists
from checks.frames import TableFrames
from checks.runner import baseline_of, run_checks
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_baseline_of_rule():
    assert baseline_of({"check_class": "null_check"}) == "live_config"
    assert baseline_of({"check_class": "referential_check"}) == "sap_standard"
    assert baseline_of({"check_class": "referential_check", "_live_reference": {"X"}}) == "live_config"
    assert baseline_of({"check_class": "exists_check", "baseline": "s4_target"}) == "s4_target"


def test_active_customer_without_bp_link_is_an_s4_finding():
    frames = TableFrames({
        "KNA1": pd.DataFrame({"KNA1.KUNNR": ["C1", "C2", "C3"], "KNA1.LOEVM": ["", "", "X"]}),
        "CVI_CUST_LINK": pd.DataFrame({"CVI_CUST_LINK.PARTNER_GUID": ["G1"], "CVI_CUST_LINK.CUSTOMER": ["C1"]}),
    }, D, module="accounts_receivable")
    r = next(r for r in run_checks("accounts_receivable", frames, "t") if r.check_id == "S4-CVI-KNA1")
    assert r.failing_record_keys == ["KUNNR=C2"]  # C3 is flagged for deletion
    assert r.details["baseline"] == "s4_target"


def test_check_table_finding_is_labelled_live_config():
    # the values came from the extracted live T052, whatever the DDIC definition's provenance
    lfm1 = pd.DataFrame({"LFM1.LIFNR": ["V1"], "LFM1.EKORG": ["1000"], "LFM1.ZTERM": ["9999"]})
    res = run_conformance("LFM1", lfm1, D, "accounts_payable", ["LFM1.LIFNR", "LFM1.EKORG"], {"T052.ZTERM": {"0001"}})
    r = next(r for r in res if r.check_id == "DDIC-LFM1-CHECK_TABLE")
    assert r.details["baseline"] == "live_config"
    assert r.details["check_tables"] == {"ZTERM": "T052.ZTERM"}
    assert r.details["definition_provenance"] == ["sap_standard"]


def test_deviation_from_sap_standard():
    std = sorted(standard_lists()["T163.PSTYP"])
    out = deviation([("T163", [{"PSTYP": v} for v in std[1:]] + [{"PSTYP": "Z"}])])
    assert out == [{"reference": "T163.PSTYP", "live_count": len(std), "standard_count": len(std),
                    "custom": ["Z"], "missing": [std[0]]}]


def test_cost_elements_judged_against_the_chart_of_their_controlling_area():
    frames = TableFrames({
        "TKA01": pd.DataFrame({"TKA01.KOKRS": ["A1"], "TKA01.KTOPL": ["INT"]}),
        # P1 has its G/L account, P2 not; S1 is free, S2 is already a G/L account; X9 sits in an unknown CO area
        "CSKB": pd.DataFrame({"CSKB.KOKRS": ["A1", "A1", "A1", "A1", "X9"],
                              "CSKB.KSTAR": ["P1", "P2", "S1", "S2", "P3"],
                              "CSKB.DATBI": ["99991231"] * 5,
                              "CSKB.KATYP": ["01", "01", "42", "42", "01"]}),
        "SKA1": pd.DataFrame({"SKA1.KTOPL": ["INT", "INT", "IKR"], "SKA1.SAKNR": ["P1", "S2", "P2"]}),
    }, D, module="fi_gl")
    res = {r.check_id: r for r in run_checks("fi_gl", frames, "t") if r.check_id.startswith("S4-CE")}
    assert res["S4-CE-PRIMARY-GL"].total_count == 2  # the CO area without a chart is not judged
    assert [k.split("|")[1] for k in res["S4-CE-PRIMARY-GL"].failing_record_keys] == ["KSTAR=P2"]
    assert [k.split("|")[1] for k in res["S4-CE-SECONDARY-CLASH"].failing_record_keys] == ["KSTAR=S2"]
    assert res["S4-CE-SECONDARY-CLASH"].details["baseline"] == "s4_target"

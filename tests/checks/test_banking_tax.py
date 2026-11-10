"""Banking and tax master data pack: overlay flag, metadata, DDIC fields and pass/fail behaviour."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import is_overlay, run_checks
from sap.ddic import get_dictionary

PACK = "checks/rules/ecc/banking_tax.yaml"
REQUIRED = ("id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
            "sap_impact", "fix_map", "record_fix_template")


def _rules():
    return yaml.safe_load(open(PACK))["rules"]


def _by_id(results):
    return {r.check_id: r for r in results}


def test_overlay_and_size():
    assert is_overlay("banking_tax")
    assert 40 <= len(_rules()) <= 100


def test_metadata_complete_and_ids_unique():
    rules = _rules()
    for r in rules:
        assert [k for k in REQUIRED if not r.get(k)] == [], r["id"]
    assert len({r["id"] for r in rules}) == len(rules)


def test_fields_exist_in_ddic():
    d = get_dictionary("ecc6")
    for r in _rules():
        table, field = r["field"].split(".")
        assert d.field(table, field) is not None, r["id"]


def test_iban_checksum_and_country_prefix():
    df = pd.DataFrame({"TIBAN.BANKS": ["DE", "DE"], "TIBAN.BANKL": ["1", "2"], "TIBAN.BANKN": ["1", "2"],
                       "TIBAN.IBAN": ["DE89370400440532013000", "FR7630006000011234567890189"]})
    res = _by_id(run_checks("banking_tax", df, "t"))
    assert res["BKT014"].affected_count == 0
    assert res["BKT015"].affected_count == 1


def test_withholding_rules():
    df = pd.DataFrame({"LFBW.LIFNR": ["1", "2"], "LFBW.BUKRS": ["A", "A"], "LFBW.WITHT": ["W1", "W1"],
                       "LFBW.WT_SUBJCT": ["X", "X"], "LFBW.WT_WITHCD": ["01", None],
                       "LFBW.WT_EXDF": ["2020-01-01", None], "LFBW.WT_EXDT": ["2019-01-01", None]})
    res = _by_id(run_checks("banking_tax", df, "t"))
    assert res["BKT042"].affected_count == 1
    assert res["BKT044"].affected_count == 1


def test_vendor_customer_shared_account():
    d = get_dictionary("ecc6")
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["V1", "V2"]})
    lfbk = pd.DataFrame({"LFBK.LIFNR": ["V1", "V2"], "LFBK.BANKS": ["ZA", "ZA"], "LFBK.BANKL": ["1", "1"],
                         "LFBK.BANKN": ["111", "222"]})
    knbk = pd.DataFrame({"KNBK.KUNNR": ["C1"], "KNBK.BANKS": ["ZA"], "KNBK.BANKL": ["1"], "KNBK.BANKN": ["111"]})
    res = _by_id(run_checks("banking_tax", TableFrames({"LFA1": lfa1, "LFBK": lfbk, "KNBK": knbk}, d), "t"))
    assert res["BKT022"].affected_count == 1


def test_linked_vendor_customer_pair_is_not_flagged():
    d = get_dictionary("ecc6")
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["V1", "V2"], "LFA1.KUNNR": ["", "C2"]})
    lfbk = pd.DataFrame({"LFBK.LIFNR": ["V1", "V2"], "LFBK.BANKS": ["ZA", "ZA"], "LFBK.BANKL": ["1", "1"],
                         "LFBK.BANKN": ["111", "222"]})
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["C1", "C2"], "KNA1.LIFNR": ["", "V2"]})
    knbk = pd.DataFrame({"KNBK.KUNNR": ["C1", "C2"], "KNBK.BANKS": ["ZA", "ZA"], "KNBK.BANKL": ["1", "1"],
                         "KNBK.BANKN": ["111", "222"]})
    frames = TableFrames({"LFA1": lfa1, "LFBK": lfbk, "KNA1": kna1, "KNBK": knbk}, d)
    res = _by_id(run_checks("banking_tax", frames, "t"))
    assert (res["BKT022"].affected_count, res["BKT022"].total_count) == (1, 1)
    assert (res["BKT023"].affected_count, res["BKT023"].total_count) == (1, 1)


def test_ar073_exposure_checked_per_credit_area():
    from checks.runner import run_rule
    rules = {r["id"]: r for r in yaml.safe_load(open("checks/rules/ecc/accounts_receivable.yaml"))["rules"]}
    knkk = pd.DataFrame({"KNKK.KUNNR": ["C1", "C1", "C2"], "KNKK.KKBER": ["1000", "2000", "1000"],
                         "KNKK.KLIMK": ["100", "100", "100"], "KNKK.SKFOR": ["50", "150", "10"],
                         "KNKK.SSOBL": ["0", "0", "0"]})
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["C1", "C2"]})
    _, res = run_rule(dict(rules["AR073"]), TableFrames({"KNA1": kna1, "KNKK": knkk}, get_dictionary("ecc6")), None)
    assert (res.affected_count, res.total_count) == (1, 3)

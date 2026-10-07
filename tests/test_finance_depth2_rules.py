"""Finance second wave: GL, controlling, asset accounting, banking and tax depth rules.

Pack integrity for every new rule, pass/fail fixtures for the key rules, and proof of the
conditional branches (record skipped when the condition is false, flagged when it is true),
including the S/4HANA readiness rules.
"""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

DDIC = get_dictionary("ecc6")
# module -> (id prefix, first new numeric id)
PACKS = {"fi_gl": ("GL", 227), "controlling": ("CO", 60), "asset_accounting": ("AA", 221), "banking_tax": ("BKT", 95)}
S4_IDS = {"S4-CE-PRIMARY-BS", "S4-CE-GL-DELETED", "S4-CE-NO-COMPANY-CODE", "S4-CO-PRCTR-SEGMENT",
          "S4-CO-ORDER-PRCTR", "S4-AA-CLASS-KTOGR"}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
SENSITIVE = {"BKONT", "BANKN", "BANKL", "SWIFT", "IBAN", "STCD1", "TELF1", "NAME1"}

PACK: dict[str, list[dict]] = {m: yaml.safe_load(open(f"checks/rules/ecc/{m}.yaml"))["rules"] for m in PACKS}
RULES = {r["id"]: (m, r) for m, rs in PACK.items() for r in rs}


def _is_new(module: str, rule: dict) -> bool:
    prefix, start = PACKS[module]
    rid = rule["id"]
    if rid in S4_IDS:
        return True
    return rid.startswith(prefix) and rid[len(prefix):].isdigit() and int(rid[len(prefix):]) >= start


NEW = [(m, r) for m, rs in PACK.items() for r in rs if _is_new(m, r)]


def ddic_fields(table: str) -> dict:
    return {x["name"]: x for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


def frame(table: str, **cols) -> pd.DataFrame:
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid: str, tables: dict[str, pd.DataFrame], refs: dict | None = None) -> tuple[int, int]:
    module, rule = RULES[rid]
    _, res = run_rule(dict(rule), TableFrames(tables, DDIC, module=module), refs)
    if res is None:  # empty population: every record skipped by the rule's condition
        return 0, 0
    assert not res.error, (rid, res.error)
    return res.affected_count, res.total_count


# ---- integrity ----------------------------------------------------------------------------------------------------

def test_new_rule_count_and_contiguous_ids_per_pack():
    assert len(NEW) == 111
    for module, (prefix, start) in PACKS.items():
        nums = sorted(int(r["id"][len(prefix):]) for m, r in NEW
                      if m == module and r["id"][len(prefix):].isdigit())
        assert nums == list(range(start, start + len(nums))), module


def test_ids_unique_across_all_packs():
    ids = [r["id"] for rs in PACK.values() for r in rs]
    assert len(ids) == len(set(ids))


def test_every_new_rule_has_full_metadata():
    for _, r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1
        assert set(r["fix_map"]) == {"__other__"}, r["id"]


def test_every_field_exists_in_ddic():
    for _, r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in ddic_fields(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = ddic_fields(r["target_table"])
            assert set(r["target_fields"]) <= set(target), r["id"]
            assert set(r.get("target_when", {})) <= set(target), r["id"]


def test_domain_rules_carry_labels_and_ddic_fixed_values():
    for _, r in NEW:
        if r["check_class"] != "domain_value_check":
            continue
        assert set(r["valid_values_with_labels"]) == set(r["allowed_values"]), r["id"]
        table, name = r["field"].split(".")
        dom = json.load(open(f"sap/dictionaries/ecc6/domains/{ddic_fields(table)[name]['domain']}.json"))
        assert {v["low"] for v in dom["fixed_values"]} >= set(r["allowed_values"]), r["id"]


def test_sensitive_values_are_never_echoed():
    for _, r in NEW:
        text = r["message"] + r["record_fix_template"]
        placeholders = set(re.findall(r"\{[A-Z0-9_]+\.([A-Z0-9_]+)\}", text))
        assert not placeholders & SENSITIVE, r["id"]


def test_s4_rules_follow_the_readiness_conventions():
    for rid in S4_IDS:
        _, r = RULES[rid]
        assert r["baseline"] == "s4_target", rid
        assert r["message"].startswith("S/4HANA readiness:") and "simplification item" in r["message"], rid
        assert r["rule_authority"] in {"sap_hard_constraint", "s4hana_migration", "best_practice"}, rid


def test_s4_rules_are_tagged_in_the_readiness_areas():
    areas = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))["areas"]
    tagged = {i for a in ("finance", "asset_accounting") for lvl in areas[a]["related"].values() for i in lvl}
    assert S4_IDS <= tagged
    assert all(i in RULES or i.startswith(("AR", "AP")) or i in {"S4-CE-PRIMARY-GL", "S4-CE-SECONDARY-CLASH",
               "S4-AA-PERIODIC-APC"} for i in tagged)


# ---- general ledger -----------------------------------------------------------------------------------------------

def test_gl_tax_code_is_checked_only_when_a_real_code_is_set():
    t007a = frame("T007A", KALSM=["TAXZA"], MWSKZ=["V1"])
    skb1 = frame("SKB1", BUKRS=["1000"] * 4, SAKNR=["1", "2", "3", "4"], MWSKZ=["V1", "ZZ", "+", ""])
    assert fire("GL227", {"SKB1": skb1, "T007A": t007a}) == (1, 2)  # '+' (any input tax) and blank are skipped


def test_gl_line_item_management_needs_open_item_management():
    skb1 = frame("SKB1", BUKRS=["1000", "1000"], SAKNR=["1", "2"], XLGCLR=["X", "X"], XOPVW=["X", ""])
    assert fire("GL231", {"SKB1": skb1}) == (1, 2)


def test_gl_balance_sheet_account_has_no_functional_area():
    ska1 = frame("SKA1", KTOPL=["INT"] * 3, SAKNR=["1", "2", "3"], XBILK=["X", "X", ""], FUNC_AREA=["0100", "", "0100"])
    assert fire("GL233", {"SKA1": ska1}) == (1, 3)


def test_gl_number_range_interval_is_ordered():
    t077s = frame("T077S", KTOPL=["INT", "INT"], KTOKS=["SAKO", "SAKO"], VONNR=["100", "900"], BISNR=["199", "800"])
    assert fire("GL236", {"T077S": t077s}) == (1, 2)


def test_gl_special_gl_posting_key_cannot_be_a_gl_account_key():
    tbsl = frame("TBSL", BSCHL=["40", "29", "09"], KOART=["S", "D", "D"], XSONU=["X", "X", ""], XZAHL=["", "", ""])
    assert fire("GL253", {"TBSL": tbsl}) == (1, 3)


def test_gl_reversal_key_must_exist_and_have_the_opposite_sign():
    missing = frame("TBSL", BSCHL=["40", "50", "01"], SHKZG=["S", "H", "S"], STBSL=["50", "40", "99"])
    assert fire("GL249", {"TBSL": missing}) == (1, 3)      # 99 is not a posting key
    same_sign = frame("TBSL", BSCHL=["40", "50", "41"], SHKZG=["S", "H", "S"], STBSL=["50", "40", "40"])
    assert fire("GL250", {"TBSL": same_sign}) == (1, 3)    # 41 (debit) reverses with 40 (debit)


# ---- S/4: cost element as GL account ------------------------------------------------------------------------------

PRIMARY, SECONDARY = "01", "43"


def _ce(katyp, saknr_flags, kstar="900000"):
    """One cost element (chart INT) and its GL account (XBILK/XLOEV flags); a None flag list drops the account."""
    tka01 = frame("TKA01", KOKRS=["1000"], KTOPL=["INT"])
    cskb = frame("CSKB", KOKRS=["1000"], KSTAR=[kstar], DATBI=["99991231"], KATYP=[katyp])
    ska1 = (frame("SKA1", KTOPL=["INT"], SAKNR=[kstar], XBILK=[saknr_flags[0]], XLOEV=[saknr_flags[1]])
            if saknr_flags else frame("SKA1", KTOPL=["INT"], SAKNR=["111111"], XBILK=[""], XLOEV=[""]))
    return {"TKA01": tka01, "CSKB": cskb, "SKA1": ska1}


def test_s4_primary_cost_element_on_balance_sheet_account():
    assert fire("S4-CE-PRIMARY-BS", _ce(PRIMARY, ("X", ""))) == (1, 1)    # true: flagged
    assert fire("S4-CE-PRIMARY-BS", _ce(PRIMARY, ("", ""))) == (0, 1)     # P&L account: passes
    assert fire("S4-CE-PRIMARY-BS", _ce(SECONDARY, ("X", "")))[1] == 0    # condition false: out of scope


def test_s4_primary_cost_element_on_deleted_gl_account():
    assert fire("S4-CE-GL-DELETED", _ce(PRIMARY, ("", "X"))) == (1, 1)
    assert fire("S4-CE-GL-DELETED", _ce(PRIMARY, ("", ""))) == (0, 1)
    assert fire("S4-CE-GL-DELETED", _ce(SECONDARY, ("", "X")))[1] == 0


def test_s4_primary_cost_element_needs_a_company_code_segment_of_its_account():
    cskb = frame("CSKB", KOKRS=["1000"] * 3, KSTAR=["900000", "900001", "900002"], DATBI=["99991231", "99991231", "20200101"],
                 KATYP=[PRIMARY, PRIMARY, PRIMARY])
    skb1 = frame("SKB1", BUKRS=["1000"], SAKNR=["900000"])
    # 900001 has no SKB1 row: flagged; 900002 is a historical interval: skipped
    assert fire("S4-CE-NO-COMPANY-CODE", {"CSKB": cskb, "SKB1": skb1}) == (1, 2)


def test_s4_profit_centre_segment_only_for_current_profit_centres():
    cepc = frame("CEPC", PRCTR=["1", "2", "3"], DATBI=["99991231", "99991231", "20200101"], KOKRS=["1000"] * 3,
                 SEGMENT=["", "SEG1", ""])
    assert fire("S4-CO-PRCTR-SEGMENT", {"CEPC": cepc}) == (1, 2)


def test_s4_open_order_needs_a_profit_centre_only_while_it_is_open():
    aufk = frame("AUFK", AUFNR=["1", "2", "3", "4"], AUTYP=["01", "01", "01", "10"], LOEKZ=["", "", "", ""],
                 PHAS3=["", "", "X", ""], PRCTR=["", "PC1", "", ""])
    assert fire("S4-CO-ORDER-PRCTR", {"AUFK": aufk}) == (1, 2)  # settled order (PHAS3) and non-internal order skipped


# ---- controlling --------------------------------------------------------------------------------------------------

def test_co_cost_element_has_a_cost_centre_or_an_order_not_both():
    cskb = frame("CSKB", KOKRS=["1000"] * 3, KSTAR=["1", "2", "3"], DATBI=["99991231"] * 3, KATYP=["01"] * 3,
                 KOSTL=["4000", "4000", ""], AUFNR=["", "100", "100"])
    assert fire("CO066", {"CSKB": cskb}) == (1, 3)


def test_co_profit_centre_successor_is_not_itself():
    cepc = frame("CEPC", PRCTR=["1", "2"], DATBI=["99991231"] * 2, KOKRS=["1000"] * 2, NPRCTR=["1", "3"])
    assert fire("CO072", {"CEPC": cepc}) == (1, 2)


def test_co_internal_order_dates_are_consistent():
    aufk = frame("AUFK", AUFNR=["1", "2", "3"], PHAS1=["X", "", "X"], IDAT1=["", "", "20240101"],
                 PHAS3=["", "", ""], IDAT3=["", "", ""])
    assert fire("CO088", {"AUFK": aufk}) == (1, 3)
    closed = frame("AUFK", AUFNR=["1", "2"], PHAS3=["X", "X"], IDAT3=["20230101", "20230101"], IDAT1=["20240101", "20220101"])
    assert fire("CO089", {"AUFK": closed}) == (1, 2)


def test_co_old_order_without_release_flag_is_conditional_on_age_and_status():
    old, recent = "20200101", pd.Timestamp.today().strftime("%Y%m%d")
    aufk = frame("AUFK", AUFNR=["1", "2", "3", "4"], AUTYP=["01"] * 4, LOEKZ=["", "", "X", ""], PHAS3=["", "", "", "X"],
                 ERDAT=[old, recent, old, old], PHAS1=["", "", "", ""])
    assert fire("CO090", {"AUFK": aufk}) == (1, 1)  # only the old, undeleted, unsettled order is in scope


# ---- asset accounting ---------------------------------------------------------------------------------------------

def anla(**cols):
    n = len(next(iter(cols.values())))
    base = {"BUKRS": ["1000"] * n, "ANLN1": [str(i + 1) for i in range(n)], "ANLN2": ["0000"] * n}
    return frame("ANLA", **{**base, **cols})


def test_aa_retirement_date_needs_a_deactivation_date():
    a = anla(ABGDT=["20240101", "20240101", ""], DEAKT=["20240101", "", ""])
    assert fire("AA222", {"ANLA": a}) == (1, 3)


def test_aa_retirement_date_not_in_the_future_or_before_capitalisation():
    a = anla(ABGDT=["20990101", "20200101"], AKTIV=["20100101", "20220101"])
    assert fire("AA223", {"ANLA": a}) == (1, 2)
    assert fire("AA224", {"ANLA": a}) == (1, 2)


def test_aa_deleted_asset_must_be_blocked():
    a = anla(XLOEV=["X", "X", ""], XSPEB=["", "X", ""])
    assert fire("AA225", {"ANLA": a}) == (1, 3)


def test_aa_depreciation_start_is_compared_by_period_not_by_day():
    anlb = frame("ANLB", BUKRS=["1000"] * 3, ANLN1=["1", "2", "3"], ANLN2=["0000"] * 3, AFABE=["01"] * 3,
                 BDATU=["99991231"] * 3, AFABG=["20240301", "20240201", "20240301"])
    a = anla(AKTIV=["20240315", "20240315", "20240301"])
    # period control moves the start to the first day of the capitalisation month: same month passes
    assert fire("AA229", {"ANLA": a, "ANLB": anlb}) == (1, 3)


def test_aa_rates_are_percentages():
    anlb = frame("ANLB", BUKRS=["1000"] * 2, ANLN1=["1", "2"], ANLN2=["0000"] * 2, AFABE=["01"] * 2,
                 BDATU=["99991231"] * 2, NAPRZ=["120.0000", "20.0000"], SAPRZ=["0.0000", "0.0000"])
    assert fire("AA230", {"ANLB": anlb}) == (1, 2)


def test_aa_missing_capitalisation_date_only_for_old_active_assets():
    old, recent = "20200101", pd.Timestamp.today().strftime("%Y%m%d")
    a = anla(AKTIV=["", "", "", ""], ANLTP=["1", "2", "1", "1"], DEAKT=["", "", "", "20230101"], XLOEV=["", "", "", ""],
             ERDAT=[old, old, recent, old])
    assert fire("AA245", {"ANLA": a}) == (1, 1)  # asset under construction, new and deactivated assets are skipped


def test_s4_asset_class_account_determination_must_exist():
    anka = frame("ANKA", ANLKL=["1000", "2000", "3000"], KTOGR=["10000", "20000", "30000"], XLOEV=["", "", "X"])
    t095 = frame("T095", KTOPL=["INT"] * 2, KTOGR=["10000", "30000"], AFABE=["01"] * 2)
    assert fire("S4-AA-CLASS-KTOGR", {"ANKA": anka, "T095": t095}) == (1, 2)  # deleted class is out of scope


# ---- banking and tax ----------------------------------------------------------------------------------------------

def test_bkt_swift_code_format():
    bnka = frame("BNKA", BANKS=["ZA"] * 4, BANKL=["1", "2", "3", "4"], SWIFT=["SBZAZAJJ", "SBZAZAJJXXX", "BAD", ""])
    assert fire("BKT095", {"BNKA": bnka}) == (1, 3)  # blank SWIFT is not this rule's concern


def test_bkt_house_bank_account_is_assigned_to_one_gl_account_only():
    t012k = frame("T012K", BUKRS=["1000"] * 3, HBKID=["HB1", "HB1", "HB2"], HKTID=["A1", "A2", "A1"],
                  HKONT=["113100", "113100", "113200"])
    assert fire("BKT103", {"T012K": t012k}) == (2, 3)


def test_bkt_sepa_payment_method_requires_iban():
    t042z = frame("T042Z", LAND1=["DE"] * 3, ZLSCH=["A", "B", "C"], XSEPA=["X", "X", ""], XIBAN=["", "X", ""])
    assert fire("BKT104", {"T042Z": t042z}) == (1, 3)


def test_bkt_tax_type_is_output_or_input():
    t007a = frame("T007A", KALSM=["TAXZA"] * 3, MWSKZ=["A1", "V1", "X1"], MWART=["A", "V", "Z"])
    assert fire("BKT107", {"T007A": t007a}) == (1, 3)

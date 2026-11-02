"""Match depth: per-object comparators, multi-pass candidate generation, Fellegi-Sunter
calibration and the SAP consolidation pack. Every value here is synthetic."""

import pandas as pd
import pytest

from api.services.consolidation_pack import pack_rows
from api.services.match_calibration import calibrate, recommended_weights
from api.services.merge_explain import SAP_COMPARATORS, explain_pair
from workers.tasks.run_match import (
    DEFAULT_RULES,
    MATCH_KEYS,
    PROFILES,
    key_pass,
    match_frame,
    neighbour_pass,
    profile_candidates,
)


def cmp(kind: str, a: str, b: str) -> float:
    norm, scorer, _ = SAP_COMPARATORS[kind]
    return scorer(norm(a), norm(b))


@pytest.mark.parametrize("a,b", [
    ("Acme (Pty) Ltd", "ACME PTY LTD"),
    ("Acme GmbH & Co. KG", "acme"),
    ("Acme Proprietary Limited", "Acme Ltd."),
    ("Acme S.A. de C.V.", "ACME SA"),
    ("Ａｃｍｅ株式会社", "株式会社Acme"),
    ("Acme Kabushiki Kaisha", "Acme KK"),
    ("Müller Straße AG", "MULLER STRASSE"),
])
def test_legal_name_folds_forms_width_and_diacritics(a: str, b: str) -> None:
    assert cmp("name_legal", a, b) == 1.0


def test_material_description_abbreviations_and_numeric_guard() -> None:
    assert cmp("desc_tokens", "BRG,ROLLER 6205-2RS", "ROLLER BEARING 6205-2RS") == 1.0
    assert cmp("desc_tokens", "BOLT HEX M10X30", "HEX BOLT M10X40") <= 0.5  # different size, never a match


def test_part_number_ignores_separators_and_leading_zeros() -> None:
    assert cmp("part_number", "6754-81-9440", "675481 9440") == 1.0
    assert cmp("part_number", "000123", "123") == 1.0
    assert cmp("part_number", "6754-81-9440", "6754-81-9441") == 0.0


def test_person_date_email_and_national_id() -> None:
    assert cmp("person_name", "Smith, José", "jose smith") == 1.0
    assert cmp("date_exact", "19800305", "1980-03-05") == 1.0
    assert cmp("date_exact", "19800305", "1980-05-03") == 0.7  # day and month swapped
    assert cmp("email", "A.Tester@Example.test", "a.tester@example.test") == 1.0
    assert cmp("email", "a.tester@one.test", "a.tester@two.test") == 0.6
    assert cmp("national_id", "800305 5009 087", "8003055009087") == 1.0


def test_explanation_masks_national_id() -> None:
    rules = [{"field": "PERINFO.NATIONAL_ID", "match_type": "national_id", "weight": 1, "threshold": 1.0}]
    x = explain_pair(rules, {"PERINFO.NATIONAL_ID": "8003055009087"}, {"PERINFO.NATIONAL_ID": "8003055009087"})
    assert x["attributes"][0]["value_a"].endswith("9087") and "800305" not in x["attributes"][0]["value_a"]


def test_profiles_only_use_profile_rule_comparators_that_exist() -> None:
    for module, p in PROFILES.items():
        for _, comparator, _, _ in p["rules"]:
            assert comparator in SAP_COMPARATORS or comparator == "exact", (module, comparator)
    assert DEFAULT_RULES["material_master"][0][1] == "desc_tokens"
    assert set(MATCH_KEYS) == {"business_partner", "material_master"}  # the Dedup page's blocked passes


def test_key_pass_skips_placeholders_and_oversized_groups(monkeypatch: pytest.MonkeyPatch) -> None:
    import workers.tasks.run_match as rm

    df = pd.DataFrame({"KNA1.STCD1": ["4011-222", "4011222", "N/A", "n/a", "", "9", "77", "77", "77"]})
    monkeypatch.setattr(rm, "MAX_BLOCK", 2)
    pairs, stats = key_pass(df, [("KNA1.STCD1", "tax_exact")])
    assert pairs == [(0, 1)]  # NA placeholders, blanks and 1-char keys never pair; the "77" group is too big
    assert stats["groups_skipped_too_large"] == 1


def test_neighbour_pass_finds_reordered_names_without_blocking() -> None:
    names = ["Zeta Mining (Pty) Ltd", "Alpha Tools", "ZETA MINING", "Mining Zeta", "Omega Parts"]
    df = pd.DataFrame({"KNA1.NAME1": names}).sample(frac=1, random_state=3)  # order must not matter
    pairs = set(neighbour_pass(df, "KNA1.NAME1", "name_legal")[0])
    assert {(0, 2), (0, 3), (2, 3)} <= pairs
    assert not any(1 in p or 4 in p for p in pairs)


def test_customer_profile_unions_passes() -> None:
    df = pd.DataFrame({
        "KNA1.KUNNR": ["C1", "C2", "C3", "C4"],
        "KNA1.NAME1": ["Northwind Haulage", "Blue Ridge Supply", "NORTHWIND HAULAGE PTY LTD", "Delta Rigging"],
        "KNA1.LAND1": ["ZA", "ZA", "ZA", "ZA"],
        "KNA1.STCEG": ["ZA4011222333", None, None, "ZA4011222333"],  # shared VAT, different names
    })
    found, report = profile_candidates(df, "sd_customer_master")
    assert set(found) == {(0, 2), (0, 3)}
    assert "vat_registration" in found[(0, 3)] and report["tax_number_1"]["status"] == "skipped"


def test_employee_profile_matches_on_birth_date_and_surname() -> None:
    df = pd.DataFrame({
        "PERINFO.PERSON_ID": ["P1", "P2", "P3"],
        "PERINFO.FIRSTNAME": ["Jose", "José", "Ana"],
        "PERINFO.LASTNAME": ["Tester", "TESTER", "Tester"],
        "PERINFO.DATE_OF_BIRTH": ["1980-03-05", "19800305", "1991-01-01"],
    })
    found, _ = profile_candidates(df, "employee_central")
    assert (0, 1) in found and "birth_date_and_last_name" in found[(0, 1)]
    assert (0, 2) not in found or "birth_date_and_last_name" not in found[(0, 2)]


def test_match_frame_skips_without_profile_columns() -> None:
    res = match_frame(pd.DataFrame({"X": [1]}), "employee_central", "t", None)
    assert res["status"] == "skipped" and "PERINFO.PERSON_ID" in res["reason"]


def _pair(decision: str, nat: float, gender: float) -> dict:
    return {"steward_decision": decision, "explanation": {"attributes": [
        {"field": "PERINFO.NATIONAL_ID", "similarity": nat, "weight": 50},
        {"field": "PERINFO.GENDER", "similarity": gender, "weight": 50}]}}


RULES = [{"field": "PERINFO.NATIONAL_ID", "match_type": "national_id", "weight": 50, "threshold": 1.0},
         {"field": "PERINFO.GENDER", "match_type": "code_exact", "weight": 50, "threshold": 1.0}]


def test_calibration_shifts_weight_to_the_discriminating_field() -> None:
    pairs = [_pair("accept", 1.0, 1.0) for _ in range(12)] + [_pair("reject", 0.0, 1.0) for _ in range(12)]
    res = calibrate(RULES, pairs)
    assert res["status"] == "ready" and (res["accepted"], res["rejected"]) == (12, 12)
    nat, gender = res["fields"]
    assert nat["m"] > 0.9 and nat["u"] < 0.1 and nat["agreement_weight"] > 3
    assert gender["agreement_weight"] == 0  # agrees on matches and non-matches alike
    w = recommended_weights(res)
    assert w == {"PERINFO.NATIONAL_ID": 100.0, "PERINFO.GENDER": 1.0}


def test_calibration_needs_enough_decisions() -> None:
    res = calibrate(RULES, [_pair("accept", 1.0, 1.0)] * 3 + [_pair("reject", 0.0, 1.0)] * 3)
    assert res["status"] == "insufficient" and recommended_weights(res) is None
    assert [x["recommended_weight"] for x in calibrate(RULES, [])["fields"]] == [50, 50]


def test_consolidation_pack_rows() -> None:
    merged = [{"loser": "M-2", "survivor": "M-1", "merged_at": None}]
    rows = pack_rows("material_master", merged)
    assert [(r["table"], r["field"], r["value"]) for r in rows] == [
        ("MARA", "LVORM", "X"), ("MARA", "BISMT", "M-1"), ("MARA", "MSTAE", None)]
    assert [r["field"] for r in pack_rows("sd_customer_master", merged)] == ["LOEVM", "SPERR", "AUFSD"]
    assert pack_rows("employee_central", merged)[0]["action"] == "map_to_survivor"

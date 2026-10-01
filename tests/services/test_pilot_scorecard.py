"""Pilot scorecard logic: key matching for recall, precision per rule."""

from api.services.pilot_scorecard import MIN_REVIEWED, key_values, rate_rules, recall


def test_key_parts_compare_without_leading_zeros_or_field_names():
    assert key_values("BUKRS=1000|LIFNR=0000100001") == key_values("1000|100001") == key_values("LIFNR=100001|1000")
    assert key_values("MATNR=AB-12") == {"AB-12"} and key_values("0000") == {"0"} and key_values(" | ") == set()


def test_recall_matches_subset_of_key_parts_within_the_object():
    issues = [("accounts_payable", "BUKRS=1000|LIFNR=0000100001"), ("material_master", "MATNR=000000000000000042")]
    known = [{"module": "accounts_payable", "record_ref": "100001"},          # any company code
             {"module": "", "record_ref": "42"},                              # any object
             {"module": "accounts_payable", "record_ref": "42"},              # wrong object
             {"module": "accounts_payable", "record_ref": "2000|100001"}]     # other company code
    caught, missed = recall(known, issues)
    assert [k["record_ref"] for k in caught] == ["100001", "42"]
    assert [k["record_ref"] for k in missed] == ["42", "2000|100001"]


def test_rules_are_rated_only_with_enough_reviews_and_worst_first():
    row = {"module": "m", "severity": "high", "message": "", "open": 0}
    rules = rate_rules([{**row, "check_id": "OK", "flagged": 40, "false_positive": 1, "real": 19},
                        {**row, "check_id": "NOISY", "flagged": 30, "false_positive": 6, "real": 6},
                        {**row, "check_id": "FEW", "flagged": 5, "false_positive": 3, "real": 0}])
    assert [r["check_id"] for r in rules] == ["NOISY", "FEW", "OK"]
    noisy, few, ok = rules
    assert noisy["needs_tuning"] and noisy["precision"] == 0.5
    assert not few["rated"] and not few["needs_tuning"] and few["reviewed"] < MIN_REVIEWED
    assert ok["precision"] == 0.95 and not ok["needs_tuning"]

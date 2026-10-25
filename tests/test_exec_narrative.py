"""The exec Situation narrative says nothing about a zero (deterministic, no LLM)."""

from api.routes.insights import exec_narrative


def test_quiet_run_has_no_narrative():
    assert exec_narrative(0, 0, 0, None, 0.0, 0, None, "ZAR") == ""
    # a zero proven cost is not a fact either
    assert exec_narrative(0, 4, 0, None, 0.0, 0, {"l1": "order_to_cash", "amount": 0.0}, "ZAR") == ""


def test_each_sentence_only_when_its_count_is_non_zero():
    assert exec_narrative(2, 6, 0, None, 0.0, 0, None, "ZAR") == "2 of 6 object and wave pairs cannot load."
    assert exec_narrative(0, 6, 0, None, 0.0, 1, None, "ZAR") == "1 owner has open digests."
    assert exec_narrative(0, 0, 3, "procure_to_pay", 1500.0, 0, None, "ZAR") == (
        "3 priced features are affected; the largest exposure is 1,500.00 ZAR in procure to pay.")
    full = exec_narrative(1, 4, 1, "order_to_cash", 10.0, 2, {"l1": "order_to_cash", "amount": 1070.0}, "ZAR")
    assert full == ("1 of 4 object and wave pair cannot load. 1 priced feature is affected; the largest exposure is 10.00 "
                    "ZAR in order to cash. 2 owners have open digests. The largest proven cost is 1,070.00 ZAR lost or "
                    "held in transactions in order to cash.")
    assert "0" not in exec_narrative(0, 0, 0, None, 0.0, 3, None, None).split()

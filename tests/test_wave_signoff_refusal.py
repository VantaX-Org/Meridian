"""F18: a refused go/no-go sign-off returns its reasons as a list, one per object that is not go, with links."""
from api.routes.migration import signoff_refusal


def test_the_refusal_lists_each_object_that_is_not_go():
    cockpit = {"verdict": "no_go", "threshold": 85.0, "objects": [
        {"module": "fi_gl", "label": "G/L accounts", "verdict": "go", "score": 99.0, "dqs": 90.0, "blocker_count": 0,
         "records_blocked": 0},
        {"module": "asset_accounting", "label": "Assets", "verdict": "no_go", "score": 60.0, "dqs": 80.5,
         "blocker_count": 3, "records_blocked": 12},
        {"module": "controlling", "label": "Controlling", "verdict": "no_go", "score": None, "dqs": None,
         "blocker_count": 0, "records_blocked": 0},
        {"module": "accounts_payable", "label": "Vendors", "verdict": "at_risk", "score": 97.0, "dqs": 90.0,
         "blocker_count": 0, "records_blocked": 0}]}
    out = signoff_refusal(cockpit)
    assert out["detail"] == "Only a wave with a go verdict can be signed off." and out["verdict"] == "no_go"
    assert [r["module"] for r in out["reasons"]] == ["asset_accounting", "controlling", "accounts_payable"]
    a = out["reasons"][0]
    assert a["sentence"] == ("Assets is no-go: 3 blocking gaps; 12 records blocked; score 80.5 under the wave's "
                             "threshold 85.0.")
    assert a["href"] == "/o/_/asset-accounting/readiness" and a["threshold"] == 85.0
    assert out["reasons"][1]["reason"] == "not analysed for this wave"
    assert out["reasons"][2]["sentence"] == "Vendors is at risk: conditional fixes needed."

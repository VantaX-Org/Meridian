"""Rule lifecycle (versions, suppression) and alert channel payloads — pure logic, no DB."""

import hashlib
import hmac
import json

from checks import lifecycle, overrides
from checks.base import CheckResult
from workers.tasks import send_notifications as sn


def _result(check_id, affected, keys=None, total=10):
    return CheckResult(check_id=check_id, module="ap", field="LIFNR", severity="critical",
                       dimension="validity", passed=affected == 0, affected_count=affected,
                       total_count=total, pass_rate=100.0 * (total - affected) / total,
                       message="Vendor 0000100001 blocked", details={}, failing_record_keys=keys)


def test_for_scoring_drops_suppressed_rule_and_marks_it():
    a, b = _result("AP001", 3), _result("AP002", 2)
    out = lifecycle.for_scoring([a, b], {"AP001"}, {})
    assert [r.check_id for r in out] == ["AP002"]
    assert a.details["suppressed"] is True


def test_for_scoring_discounts_suppressed_records_only():
    r = _result("AP001", 2, keys=["LIFNR=1", "LIFNR=2"])
    out = lifecycle.for_scoring([r], set(), {"AP001": {"LIFNR=1", "LIFNR=9"}})
    assert out[0].affected_count == 1 and not out[0].passed and out[0].pass_rate == 90.0
    assert r.affected_count == 2 and r.details["suppressed_records"] == 1  # stored finding unchanged
    full = lifecycle.for_scoring([r], set(), {"AP001": {"LIFNR=1", "LIFNR=2"}})
    assert full[0].passed and full[0].pass_rate == 100.0
    assert lifecycle.for_scoring([_result("AP003", 1)], set(), {"AP003": {"x"}})[0].affected_count == 1


def test_validate_body():
    shipped = next(iter(lifecycle.shipped_rules()))
    assert lifecycle.validate_body(shipped, {"severity": "low"}) is None
    assert "must match" in lifecycle.validate_body(shipped, {"id": "OTHER"})
    assert "needs" in lifecycle.validate_body("TENANT_X1", {"module": "ap"})
    assert "unknown check_class" in lifecycle.validate_body(shipped, {"check_class": "nope"})


def test_diff_against_shipped_and_hash_stable():
    rid = next(iter(lifecycle.shipped_rules()))
    d = lifecycle.diff(rid, {}, {"severity": "zzz"}, "shipped", "v1")
    assert "+severity: zzz" in d
    info = lifecycle.shipped_info(rid)
    assert info["hash"] == lifecycle.rule_hash(lifecycle.shipped_rules()[rid][0]) and len(info["hash"]) == 16


def test_overrides_apply_merges_active_version_body():
    rules = [{"id": "AP001", "severity": "high", "field": "LIFNR"}]
    out = overrides.apply(rules, {"AP001": {"body": {"field": "NAME1", "id": "X"}, "severity": "low"}})
    assert out == [{"id": "AP001", "severity": "low", "field": "NAME1"}]


def test_authored_rules_only_unshipped_ids():
    shipped = next(iter(lifecycle.shipped_rules()))
    got = lifecycle.authored_rules({shipped: {"module": "ap"}, "T1": {"module": "ap"}, "T2": {}})
    assert got == [{"module": "ap", "id": "T1"}]


def test_hmac_signature_verifies():
    body = b'{"a":1}'
    sig = sn.sign("s3cret-key-123456", "1700000000", body)
    want = hmac.new(b"s3cret-key-123456", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert sig == "sha256=" + want


def test_alert_none_without_trigger_and_carries_no_record_values():
    assert sn.build_alert("daily", "v", 80.0, 82.0, set(), 0, 5, "https://app") is None
    a = sn.build_alert("daily", "v", 70.0, 80.0, {"AP002", "AP001"}, 2, 5, "https://app")
    assert a["triggers"] == ["score_drop", "new_critical", "sla_breach"]
    assert a["new_critical_rules"] == ["AP001", "AP002"] and a["score_drop"] == 10.0
    assert set(a) == {"event", "mode", "triggers", "version_id", "score", "previous_score", "score_drop",
                      "new_critical_count", "new_critical_rules", "sla_breaches", "regressed_records", "links",
                      "sent_at"}
    many = sn.build_alert("immediate", "v", None, None, {f"R{i:03}" for i in range(80)}, 0, 0, "https://app")
    assert many["triggers"] == ["new_critical"] and len(many["new_critical_rules"]) == sn.MAX_RULE_IDS


def test_render_formats():
    a = sn.build_alert("weekly", "v", None, None, {"AP001"}, 0, 5, "https://app")
    assert "AP001" in sn.render("slack", a)["text"]
    card = sn.render("teams", a)["attachments"][0]["content"]
    assert card["type"] == "AdaptiveCard" and card["actions"][0]["url"] == "https://app/findings"
    assert sn.render("webhook", a) is a


def test_deliver_signs_webhook(monkeypatch):
    sent = {}

    class Resp:
        ok, status_code = True, 200

    def fake_post(url, data, headers, timeout):
        sent.update(data=data, headers=headers)
        return Resp()

    monkeypatch.setattr(sn.requests, "post", fake_post)
    a = sn.build_alert("daily", "v", None, None, {"AP001"}, 0, 5, "https://app")
    assert sn.deliver({"id": 1, "kind": "webhook", "target": "https://hook", "secret": "k" * 16}, a)
    h = sent["headers"]
    assert h["X-Meridian-Signature"] == sn.sign("k" * 16, h["X-Meridian-Timestamp"], sent["data"])
    assert json.loads(sent["data"])["new_critical_rules"] == ["AP001"]
    sn.deliver({"id": 2, "kind": "slack", "target": "https://hook", "secret": None}, a)
    assert "X-Meridian-Signature" not in sent["headers"]

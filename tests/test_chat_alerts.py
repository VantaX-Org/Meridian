"""Chat alerts: env-only URLs, counts-only messages, event selection."""
import pytest

from api.services import chat_alerts
from api.services.webhooks import UnsafePayload


def test_configured_reads_env_only(monkeypatch):
    monkeypatch.setenv("MERIDIAN_SLACK_WEBHOOK_URL", "https://hooks.example.test/x")
    monkeypatch.delenv("MERIDIAN_TEAMS_WEBHOOK_URL", raising=False)
    assert chat_alerts.configured() == {"slack": True, "teams": False}


def test_merged_defaults_and_filters():
    assert chat_alerts.merged(None)["events"] == list(chat_alerts.EVENTS)
    assert chat_alerts.merged({"events": ["run_failed", "bogus"]})["events"] == ["run_failed"]
    assert chat_alerts.merged({"events": []})["events"] == []


def test_counts_drop_record_data():
    counts, path = chat_alerts.counts_of("score.dropped", {"run_id": "r1", "objects": [
        {"module": "business_partner", "drop": 6.5, "score": 80}, {"module": "material_master", "drop": 9}]})
    assert counts == {"objects": 2, "largest_drop_points": 9.0} and path == "/run/r1"
    counts, _ = chat_alerts.counts_of("breach.new", {"objects": [{"rules": ["A", "B"]}, {"rules": ["C"]}]})
    assert counts == {"objects": 2, "new_breaches": 3}


@pytest.mark.parametrize("kind", ["slack", "teams"])
def test_message_shapes_carry_link(kind):
    body = chat_alerts.message(kind, "dqs_drop", {"objects": 2}, "https://m.example.test/run/r1")
    flat = str(body)
    assert "https://m.example.test/run/r1" in flat and "Data quality score dropped" in flat
    if kind == "teams":
        assert body["attachments"][0]["content"]["type"] == "AdaptiveCard"


def test_message_refuses_record_values():
    with pytest.raises(UnsafePayload):
        chat_alerts.message("slack", "dqs_drop", {"values": ["SECRET"]}, "https://m.example.test")


def test_notify_sync_skips_without_channels(monkeypatch):
    monkeypatch.delenv("MERIDIAN_SLACK_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("MERIDIAN_TEAMS_WEBHOOK_URL", raising=False)
    assert chat_alerts.notify_sync(object(), "t", "run_failed", {"runs": 1}) == 0


def test_send_posts_body_without_url_in_error(monkeypatch):
    from workers.tasks import chat_alerts as task

    monkeypatch.setenv("MERIDIAN_TEAMS_WEBHOOK_URL", "https://hooks.example.test/secret-token")
    sent = {}

    class R:
        status_code = 500

    monkeypatch.setattr(task.requests, "post", lambda url, json, timeout: sent.update(json=json) or R())
    with pytest.raises(task.DeliveryError) as e:
        task.send("teams", "run_failed", {"runs": 1}, "/runs")
    assert "secret-token" not in str(e.value) and sent["json"]["type"] == "message"

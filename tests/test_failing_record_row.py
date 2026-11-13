from api.routes.findings import failing_record_row


def test_current_and_fix_map():
    r = failing_record_row("1", "MARA.MATKL", {"MATKL": "X1"}, {"X1": {"suggested_value": "A1"}}, None)
    assert r["current_value"] == "X1" and r["expected_value"] == "A1"
    assert r["field_text"].startswith("MARA.MATKL")


def test_record_fix_fallback_and_none():
    fixes = [{"record_key": "2", "proposed_value": "B"}]
    assert failing_record_row("2", "MARA.MATKL", {"MATKL": "Z"}, None, fixes)["expected_value"] == "B"
    r = failing_record_row("3", None, None, None, None)
    assert r["field_text"] is None and r["current_value"] is None and r["expected_value"] is None

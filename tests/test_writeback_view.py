"""Pure logic behind the write-back request view: state, who may decide, before/after rows."""
from datetime import datetime, timezone

from api.services.writeback_view import change_rows, request_state, viewer_can_decide


def test_state_precedence():
    now = datetime.now(timezone.utc)
    assert request_state(dry_run=True, approved_by=None, rejected_at=None) == "dry_run"
    assert request_state(dry_run=False, approved_by=None, rejected_at=now) == "rejected"
    assert request_state(dry_run=False, approved_by="u", rejected_at=None) == "approved"
    assert request_state(dry_run=False, approved_by=None, rejected_at=None) == "pending"


def test_requester_cannot_decide_own_request():
    assert viewer_can_decide("pending", "a", "a", True) == (False, "own_request")
    assert viewer_can_decide("pending", "a", "b", True) == (True, None)
    assert viewer_can_decide("pending", "a", "b", False) == (False, "no_permission")
    assert viewer_can_decide("approved", "a", "b", True) == (False, "not_pending")


def test_change_rows_before_after_and_skips_unstructured():
    fixes = [
        {"record_key": "LIFNR=1", "field": "LFA1.STCD1", "invalid_value": "12 34", "proposed_value": "1234"},
        {"record_key": "LIFNR=2", "field": "LFA1.STCD1", "invalid_value": None, "proposed_value": "99"},
        {"record_key": "LIFNR=3", "field": "LFA1.STCD1", "invalid_value": "x"},          # no proposal
        {"field": "LFA1.STCD1", "proposed_value": "1"},                                   # no key
    ]
    sup = {"delivery": "bapi", "bapi": "BAPI_X", "reason": None}
    rows = change_rows([(f, sup) for f in fixes])
    assert [(r["record_key"], r["before"], r["after"]) for r in rows] == [("LIFNR=1", "12 34", "1234"), ("LIFNR=2", None, "99")]
    assert rows[0]["delivery"] == "bapi" and rows[0]["bapi"] == "BAPI_X"

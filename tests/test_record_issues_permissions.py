"""POST /issues/bulk permissions: accepting an issue is an approver's sign-off (approve alone), so a data owner,
who holds approve but not assign, can accept; every other status change and any assignment needs assign."""

import uuid

from api.routes.record_issues import BulkUpdate, required_actions
from api.services.rbac import has_permission

IDS = [uuid.uuid4()]


def _allowed(role: str, **body) -> bool:
    return all(has_permission(role, a) for a in required_actions(BulkUpdate(ids=IDS, **body)))


def test_accepting_needs_approve_only():
    assert required_actions(BulkUpdate(ids=IDS, status="accepted", resolution="accepted_risk")) == {"approve"}
    assert _allowed("data_owner", status="accepted", resolution="accepted_risk")
    assert _allowed("approver", status="accepted", resolution="false_positive", note="Duplicate of a fixed row")
    assert not _allowed("analyst", status="accepted", resolution="accepted_risk")


def test_other_changes_still_need_assign():
    assert required_actions(BulkUpdate(ids=IDS, status="resolved", resolution="fixed_in_source")) == {"assign"}
    assert required_actions(BulkUpdate(ids=IDS, status="accepted", resolution="accepted_risk",
                                       assigned_to="")) == {"approve", "assign"}
    assert not _allowed("data_owner", status="in_progress")
    assert not _allowed("data_owner", assigned_to="")
    assert _allowed("data_steward", status="in_progress")


def test_a_bare_note_is_a_comment():
    assert required_actions(BulkUpdate(ids=IDS, note="Called the vendor")) == {"analyse"}

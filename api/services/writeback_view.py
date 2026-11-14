"""Pure helpers behind the write-back request view: the state of a request, who may act on it, and the
before/after rows built from a finding's stored record fixes. No database access here."""

from typing import Any, Optional

PENDING, APPROVED, REJECTED, DRY_RUN = "pending", "approved", "rejected", "dry_run"


def request_state(*, dry_run: bool, approved_by: Optional[str], rejected_at: Any) -> str:
    """dry_run / rejected / approved / pending, in that order of precedence."""
    if dry_run:
        return DRY_RUN
    if rejected_at:
        return REJECTED
    if approved_by:
        return APPROVED
    return PENDING


def viewer_can_decide(state: str, requested_by: Optional[str], viewer: Optional[str], may_approve: bool) -> tuple[bool, Optional[str]]:
    """(can approve or reject, reason when not). Reasons: "own_request", "not_pending", "no_permission"."""
    if state != PENDING:
        return False, "not_pending"
    if viewer and requested_by and viewer == requested_by:
        return False, "own_request"
    if not may_approve:
        return False, "no_permission"
    return True, None


def change_rows(pairs: list[tuple[dict, dict]]) -> list[dict]:
    """One row per structured fix, from (fix, field_support) pairs: field (TABLE.FIELD), full record key, before
    (invalid_value), after (proposed_value) and how it is delivered. A fix without a record key, field or proposed
    value is not a change and is left out."""
    rows: list[dict] = []
    for fix, sup in pairs:
        if not isinstance(fix, dict) or not (fix.get("record_key") and fix.get("field") and fix.get("proposed_value") is not None):
            continue
        before = fix.get("invalid_value")
        rows.append({
            "record_key": str(fix["record_key"]), "field": str(fix["field"]),
            "before": None if before is None else str(before), "after": str(fix["proposed_value"]),
            "delivery": sup.get("delivery") or "export", "bapi": sup.get("bapi"), "reason": sup.get("reason"),
        })
    return rows

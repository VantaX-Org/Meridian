"""The subject-request targets cover every store that can hold a data subject's record key.

No database: this checks the target list and the SQL fragments it builds. The Postgres suite
(test_subject_requests_pg.py) proves the same stores end to end.
"""

from api.services import subject_requests as svc

BY_TABLE = {t.table: t for t in svc.TARGETS}

DELETED = ("change_request_comments", "change_request_attachments", "comments", "watches",
           "notifications", "undo_actions", "exception_comments")
SCRUBBED = ("writeback_run_records", "webhook_deliveries", "field_dependencies",
            "learned_rule_proposals", "exceptions", "audit_log")


def test_every_store_is_a_target_with_the_right_action():
    for table in DELETED:
        assert BY_TABLE[table].action == "delete", table
    for table in SCRUBBED:
        assert BY_TABLE[table].action == "scrub", table
        assert BY_TABLE[table].set, table


def test_comment_threads_go_before_the_change_requests_they_hang_off():
    order = [t.table for t in svc.TARGETS]
    for table in ("change_request_comments", "change_request_attachments"):
        assert order.index(table) < order.index("change_requests"), table


def test_exception_comments_match_on_the_text_column():
    assert "COALESCE(CAST(text AS text), '')" in BY_TABLE["exception_comments"].also


def test_shared_sample_lists_lose_only_the_subjects_keys():
    assert svc._drop_samples("sample_keys") == "sample_keys = sample_keys - CAST(:keys AS text[])"
    nested = svc._drop_samples("evidence", "sample_keys")
    assert "jsonb_set(evidence, '{sample_keys}', (evidence->'sample_keys') - CAST(:keys AS text[]))" in nested
    assert nested.endswith("ELSE evidence END")


def test_scrubbed_exports_leave_out_other_subjects_samples_and_payloads():
    for table in ("field_dependencies", "learned_rule_proposals", "exceptions", "webhook_deliveries"):
        cols = BY_TABLE[table].export
        assert cols and "sample" not in cols and "payload" not in cols and "evidence" not in cols, table


def test_where_is_tenant_scoped_for_every_target():
    for t in svc.TARGETS:
        assert svc._where(t).startswith("tenant_id = :t"), t.table

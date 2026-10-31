"""The work status vocabulary has awaiting_load between approved and sent, everywhere it is listed (F08)."""
from api.routes import people, work
from api.services import attention, receipt_math, work_analytics, work_counts, worklist


def test_awaiting_load_is_open_work_between_approved_and_sent():
    assert worklist.STATUSES == ("to_fix", "proposed", "approved", "awaiting_load", "sent", "not_an_issue", "fixed")
    for open_ in (work.OPEN, work_counts.OPEN, receipt_math.OPEN_WORK, attention.OPEN_WORK, work_analytics.OPEN_WORK,
                  people._OPEN):
        assert tuple(open_) == ("to_fix", "proposed", "approved", "awaiting_load", "sent")
    # the rank of a batch status in the work list's SQL: awaiting_load (3) sits under sent (4)
    sql = worklist._STATUS_ROWS
    assert "WHEN rem.batch_status = 'exported' THEN 4" in sql and "WHEN rem.batch_status = 'awaiting_load' THEN 3" in sql
    assert "'awaiting_load'" in worklist._STATUS_OF_RANK

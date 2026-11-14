"""Progress math for live runs (api/services/run_progress.py): a percent only where the total is known."""

from api.services.jobs import STAGES
from api.services.run_progress import STALL_AFTER_S, compute_progress, ratio

NOW = 10_000.0


def _stages(kind: str, current: str) -> list[dict]:
    ids = [sid for sid, _ in STAGES[kind]]
    k = ids.index(current)
    return [{"id": sid, "label": label, "status": "done" if i < k else "running" if i == k else "queued"}
            for i, (sid, label) in enumerate(STAGES[kind])]


def _job(**kw) -> dict:
    base = {"id": "j1", "kind": "extraction", "status": "running", "label": "Extract", "stage": "read",
            "stages": _stages("extraction", "read"), "tables": [], "rows_done": 0, "rows_total": 0, "message": "",
            "started_at": NOW - 600, "updated_at": NOW - 2, "finished_at": None}
    base.update(kw)
    return base


def test_ratio_known_unknown_zero_and_clamped():
    assert ratio(25, 100) == 25.0
    assert ratio(5, None) is None
    assert ratio(5, 0) is None
    assert ratio(150, 100) == 100.0
    assert ratio(-3, 100) == 0.0


def test_known_total_reads_rows_against_sap_counts():
    p = compute_progress(_job(tables=[
        {"table": "MARA", "status": "live", "rows": 1000, "expected": 1000},
        {"table": "MARC", "status": "running", "rows": 500, "expected": 3000},
    ]), NOW)
    assert p["step"] == {"unit": "rows", "done": 1500, "total": 4000, "pct": 37.5}
    # one of five stages done plus 37.5 % of the second
    assert p["pct"] == round(100 * (1 + 0.375) / 5, 1)
    assert p["determinate"] and p["state"] == "running"
    assert p["parts"][0]["pct"] == 100.0 and p["parts"][1]["pct"] == round(100 * 500 / 3000, 1)
    assert p["eta_s"] is None  # later stages are not measured, so no end time for the whole run


def test_unknown_total_falls_back_to_tables_never_rows():
    p = compute_progress(_job(tables=[
        {"table": "MARA", "status": "live", "rows": 1000, "expected": None},
        {"table": "MARC", "status": "running", "rows": 50, "expected": 900},
    ]), NOW)
    assert p["step"]["unit"] == "tables"
    assert (p["step"]["done"], p["step"]["total"], p["step"]["pct"]) == (1, 2, 50.0)
    assert p["parts"][1]["pct"] == round(100 * 50 / 900, 1)
    assert p["rows"] == 1050


def test_nothing_known_is_indeterminate_within_the_step():
    p = compute_progress(_job(kind="config_sync", stage="read", stages=_stages("config_sync", "read")), NOW)
    assert p["step"]["pct"] is None and p["step"]["total"] is None
    assert p["pct"] == round(100 * 1 / 3, 1)  # whole stages only


def test_no_stages_and_queued_are_indeterminate():
    assert compute_progress(_job(stages=[], stage=None), NOW)["pct"] is None
    q = compute_progress(_job(status="queued", stage=None), NOW)
    assert q["pct"] is None and not q["determinate"] and q["state"] == "queued"


def test_zero_total_is_not_a_percent():
    p = compute_progress(_job(kind="upload", stage="checks", stages=_stages("upload", "checks"),
                              rows_done=0, rows_total=0), NOW)
    assert p["step"]["pct"] is None


def test_done_over_total_clamps_and_active_run_never_shows_100():
    p = compute_progress(_job(kind="analysis", stage="report", stages=_stages("analysis", "report"),
                              message="Running checks | rule 120/100 | MM142"), NOW)
    assert p["step"]["pct"] == 100.0
    assert p["pct"] == 99.0
    assert p["eta_s"] is None


def test_known_total_gives_eta_on_last_stage_after_a_minute():
    stages = _stages("export", "store")
    p = compute_progress(_job(kind="export", stage="store", stages=stages, rows_done=250, rows_total=1000), NOW)
    assert p["step"]["pct"] == 25.0
    assert p["eta_s"] == 600 * 3 and p["eta_is_estimate"]
    young = compute_progress(_job(kind="export", stage="store", stages=stages, rows_done=250, rows_total=1000,
                                  started_at=NOW - 30), NOW)
    assert young["eta_s"] is None and young["rows_per_min"] is None


def test_stalled_when_no_update_for_the_threshold():
    p = compute_progress(_job(updated_at=NOW - STALL_AFTER_S - 1), NOW)
    assert p["state"] == "stalled" and p["status"] == "running" and p["eta_s"] is None
    assert compute_progress(_job(status="queued", updated_at=NOW - 10 * STALL_AFTER_S), NOW)["state"] == "queued"


def test_completed_is_100_and_failed_keeps_its_place():
    done = compute_progress(_job(status="completed", finished_at=NOW - 100), NOW)
    assert done["pct"] == 100.0 and done["elapsed_s"] == 500
    failed = compute_progress(_job(status="failed", finished_at=NOW - 100), NOW)
    assert failed["state"] == "failed" and failed["pct"] == 20.0


def test_is_live_keeps_recently_finished_runs_only():
    from api.services.run_progress import is_live
    assert is_live({"status": "running"}, now=10_000)
    assert is_live({"status": "completed", "finished_at": 9_950}, now=10_000)
    assert not is_live({"status": "failed", "finished_at": 9_000}, now=10_000)

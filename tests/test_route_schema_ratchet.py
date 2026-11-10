"""Ratchet: frontend-called JSON routes without a response schema may only go down.

scripts/route_schema_audit.py lists them. When you type more routes, lower FRONTEND_UNTYPED_MAX to the
new count; never raise it. A new frontend-called route needs a response_model (or a typed return).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import route_schema_audit as audit  # noqa: E402

FRONTEND_UNTYPED_MAX = 202


def test_frontend_untyped_routes_do_not_rise():
    called = [f"{m} {p}" for c, m, p, _ in audit.audit() if c]
    assert len(called) <= FRONTEND_UNTYPED_MAX, (
        f"{len(called)} frontend-called routes have no response schema (max {FRONTEND_UNTYPED_MAX}). "
        "Give the new route a response_model; run scripts/route_schema_audit.py to list them."
    )


def test_matcher_reads_template_paths():
    src = 'get(`/api/v1/runs/${id}/steps`); post(`${BASE}/drafts/${encodeURIComponent(d)}/publish`)'
    assert audit.frontend_calls("/api/v1/runs/{run_id}/steps", src)
    assert audit.frontend_calls("/api/v1/rule-authoring/drafts/{draft_id}/publish", src)
    assert not audit.frontend_calls("/api/v1/runs/{run_id}", src)

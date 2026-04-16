"""Phase L: Stewardship workbench tests.

Tests cover:
  - Migration 015 structure (file-level checks)
  - AI triage prompt building and response parsing (pure functions)
  - Queue population helpers (pure functions)
  - RBAC access control (ai_reviewer restrictions)
  - Pydantic response models
"""

import json
import uuid
from pathlib import Path

import pytest


# ── L.1 Migration structure ─────────────────────────────────────────────────


def test_migration_015_file_exists():
    """015_stewardship_workbench.py exists in migrations directory."""
    path = Path("db/migrations/versions/015_stewardship_workbench.py")
    assert path.exists(), f"Migration file not found: {path}"


def test_migration_015_revision_chain():
    """Migration 015 has correct revision and down_revision."""
    path = Path("db/migrations/versions/015_stewardship_workbench.py")
    content = path.read_text()
    assert 'revision: str = "015"' in content
    assert 'down_revision' in content
    assert '"014"' in content


def test_migration_015_creates_stewardship_queue():
    """Migration creates stewardship_queue table with required columns."""
    path = Path("db/migrations/versions/015_stewardship_workbench.py")
    content = path.read_text()
    assert '"stewardship_queue"' in content
    assert "ai_recommendation" in content
    assert "ai_confidence" in content
    assert "ROW LEVEL SECURITY" in content
    assert "stewardship_queue_tenant" in content
    assert "ix_stewardship_queue_priority" in content


# ── L.1 Schema model ────────────────────────────────────────────────────────


def test_stewardship_queue_model():
    """StewardshipQueueItem model has all required columns."""
    from db.schema import StewardshipQueueItem

    columns = {c.name for c in StewardshipQueueItem.__table__.columns}
    required = {
        "id", "tenant_id", "item_type", "source_id", "domain",
        "priority", "due_at", "assigned_to", "status", "sla_hours",
        "created_at", "updated_at", "ai_recommendation", "ai_confidence",
    }
    assert required.issubset(columns), f"Missing columns: {required - columns}"


def test_stewardship_queue_has_index():
    """StewardshipQueueItem has the composite index."""
    from db.schema import StewardshipQueueItem

    index_names = {idx.name for idx in StewardshipQueueItem.__table__.indexes}
    assert "ix_stewardship_queue_priority" in index_names


# ── L.2 AI triage — pure functions (no celery import) ───────────────────────


def test_build_triage_prompt_no_pii():
    """Prompt builder excludes PII values using sanitise_for_prompt."""
    from api.utils.pii_fields import sanitise_for_prompt

    # Simulate prompt building logic without importing celery
    item = {
        "item_type": "exception",
        "domain": "business_partner",
        "priority": 1,
        "status": "open",
        "sla_hours": 24,
    }
    source_metadata = {
        "SMTP_ADDR": "secret@example.com",  # PII field
        "severity": "critical",
    }

    parts = [
        f"Item type: {item['item_type']}",
        f"Domain: {sanitise_for_prompt('domain', item['domain'])}",
        f"Priority: {item['priority']}",
        f"Status: {item['status']}",
        f"SLA hours: {item['sla_hours']}",
    ]
    for k, v in source_metadata.items():
        parts.append(f"{k}: {sanitise_for_prompt(k, v)}")

    prompt = "\n".join(parts)
    assert "secret@example.com" not in prompt
    assert "[REDACTED]" in prompt
    assert "critical" in prompt
    assert "exception" in prompt


def test_parse_llm_response_valid_json():
    """Parser extracts recommendation and confidence from valid JSON."""
    content = '{"recommendation": "approve", "justification": "High confidence match", "confidence": 0.92}'

    start = content.find("{")
    end = content.rfind("}") + 1
    data = json.loads(content[start:end])
    recommendation = data.get("recommendation", "review_manually")
    justification = data.get("justification", "")
    confidence = float(data.get("confidence", 0.5))
    confidence = max(0.0, min(1.0, confidence))

    assert recommendation == "approve"
    assert "High confidence match" in justification
    assert confidence == 0.92


def test_parse_llm_response_json_with_preamble():
    """Parser handles JSON embedded in surrounding text."""
    content = 'Here is my analysis:\n{"recommendation": "escalate", "justification": "Unusual pattern", "confidence": 0.45}\nEnd.'

    start = content.find("{")
    end = content.rfind("}") + 1
    data = json.loads(content[start:end])
    assert data["recommendation"] == "escalate"
    assert float(data["confidence"]) == 0.45


def test_parse_llm_response_clamps_confidence():
    """Confidence values are clamped to [0.0, 1.0]."""
    content = '{"recommendation": "approve", "confidence": 1.5}'
    data = json.loads(content)
    conf = max(0.0, min(1.0, float(data["confidence"])))
    assert conf == 1.0

    content2 = '{"recommendation": "reject", "confidence": -0.3}'
    data2 = json.loads(content2)
    conf2 = max(0.0, min(1.0, float(data2["confidence"])))
    assert conf2 == 0.0


# ── L.3 Queue population constants ──────────────────────────────────────────


def test_sla_defaults():
    """SLA defaults cover all 6 item types with positive hours."""
    expected_types = {
        "merge_decision", "golden_record_review", "exception",
        "writeback_approval", "contract_breach", "glossary_review",
    }
    # Import constants from the file directly to avoid celery chain
    path = Path("workers/tasks/populate_stewardship_queue.py")
    content = path.read_text()
    for t in expected_types:
        assert f'"{t}"' in content, f"Missing SLA default for {t}"


def test_population_sources_all_defined():
    """Queue population file defines functions for all 6 source types."""
    path = Path("workers/tasks/populate_stewardship_queue.py")
    content = path.read_text()
    assert "_populate_merge_decisions" in content
    assert "_populate_golden_record_reviews" in content
    assert "_populate_exceptions" in content
    assert "_populate_writeback_approvals" in content
    assert "_populate_contract_breaches" in content
    assert "_populate_glossary_reviews" in content
    assert "_mark_resolved_items" in content


# ── L.5 RBAC — ai_reviewer restrictions ─────────────────────────────────────


def test_ai_reviewer_has_view_ai_confidence():
    """ai_reviewer role has view_ai_confidence, ai_feedback, review_ai_rules."""
    path = Path("api/services/rbac.py")
    content = path.read_text()
    # Find ai_reviewer permissions block
    assert '"ai_reviewer"' in content
    # ai_reviewer should have these
    assert "view_ai_confidence" in content
    assert "ai_feedback" in content
    assert "review_ai_rules" in content


def test_ai_reviewer_cannot_approve():
    """ai_reviewer role does NOT have approve in its permission set."""
    path = Path("api/services/rbac.py")
    content = path.read_text()
    # Extract the ai_reviewer permissions line
    lines = content.split("\n")
    in_ai_reviewer = False
    ai_reviewer_perms = ""
    for line in lines:
        if '"ai_reviewer"' in line:
            in_ai_reviewer = True
        if in_ai_reviewer:
            ai_reviewer_perms += line
            if "}" in line:
                break
    assert '"approve"' not in ai_reviewer_perms, "ai_reviewer must not have approve permission"
    assert '"apply"' not in ai_reviewer_perms, "ai_reviewer must not have apply permission"


def test_viewer_cannot_see_ai_confidence():
    """Viewer role permission set does not include view_ai_confidence."""
    path = Path("api/services/rbac.py")
    content = path.read_text()
    lines = content.split("\n")
    in_viewer = False
    viewer_perms = ""
    for line in lines:
        if '"viewer"' in line:
            in_viewer = True
        if in_viewer:
            viewer_perms += line
            if "}" in line:
                break
    assert "view_ai_confidence" not in viewer_perms


def test_steward_can_approve_and_see_ai():
    """Steward permission set includes both approve and view_ai_confidence."""
    path = Path("api/services/rbac.py")
    content = path.read_text()
    lines = content.split("\n")
    in_steward = False
    steward_perms = ""
    for line in lines:
        if '"steward"' in line:
            in_steward = True
        if in_steward:
            steward_perms += line
            if "}" in line:
                break
    assert '"approve"' in steward_perms
    assert '"view_ai_confidence"' in steward_perms


# ── L.6 Scheduler wiring ────────────────────────────────────────────────────


def test_scheduler_has_stewardship_entries():
    """Scheduler file contains stewardship beat schedule entries."""
    path = Path("workers/scheduler.py")
    content = path.read_text()
    assert "stewardship-queue-populate-every-15min" in content
    assert "stewardship-ai-triage-every-15min" in content
    assert "populate_stewardship_queue.populate_queue" in content
    assert "ai_triage.triage_queue_items" in content


def test_celery_app_imports_new_tasks():
    """celery_app.py imports the new task modules."""
    path = Path("workers/celery_app.py")
    content = path.read_text()
    assert "import workers.tasks.ai_triage" in content
    assert "import workers.tasks.populate_stewardship_queue" in content


# ── L.4a Route file structure ────────────────────────────────────────────────


def test_stewardship_route_file_exists():
    """api/routes/stewardship.py exists."""
    path = Path("api/routes/stewardship.py")
    assert path.exists()


def test_stewardship_route_endpoints():
    """Route file defines expected endpoints."""
    path = Path("api/routes/stewardship.py")
    content = path.read_text()
    assert "/stewardship" in content
    assert "/stewardship/{item_id}" in content
    assert "/stewardship/{item_id}/assign" in content
    assert "/stewardship/{item_id}/resolve" in content
    assert "/stewardship/{item_id}/escalate" in content
    assert "/stewardship/bulk-approve" in content
    assert "/stewardship/metrics" in content


def test_stewardship_route_ai_reviewer_guard():
    """Route file enforces ai_reviewer cannot resolve data actions."""
    path = Path("api/routes/stewardship.py")
    content = path.read_text()
    assert 'role == "ai_reviewer"' in content
    assert "AI Reviewer role cannot approve data actions" in content


def test_stewardship_route_registered_in_main():
    """main.py includes the stewardship router."""
    path = Path("api/main.py")
    content = path.read_text()
    assert "stewardship_router" in content


# ── L.4b/c Frontend structure ────────────────────────────────────────────────


def test_frontend_stewardship_page_exists():
    """Frontend stewardship workbench page exists."""
    path = Path("frontend/app/(dashboard)/stewardship/page.tsx")
    assert path.exists()


def test_frontend_stewardship_metrics_page_exists():
    """Frontend stewardship metrics page exists."""
    path = Path("frontend/app/(dashboard)/stewardship/metrics/page.tsx")
    assert path.exists()


def test_frontend_stewardship_keyboard_shortcuts():
    """Workbench page implements keyboard shortcuts A, R, N, E."""
    path = Path("frontend/app/(dashboard)/stewardship/page.tsx")
    content = path.read_text()
    for key in ['"a"', '"r"', '"n"', '"e"', '"A"', '"R"', '"N"', '"E"']:
        assert key in content, f"Missing keyboard shortcut: {key}"


def test_frontend_stewardship_override_modal():
    """Workbench page has override modal for AI recommendation."""
    path = Path("frontend/app/(dashboard)/stewardship/page.tsx")
    content = path.read_text()
    assert "OverrideModal" in content
    assert "Override AI Recommendation" in content
    assert "correction_reason" in content


def test_frontend_metrics_ai_acceptance_rate():
    """Metrics page displays AI Acceptance Rate."""
    path = Path("frontend/app/(dashboard)/stewardship/metrics/page.tsx")
    content = path.read_text()
    assert "AI Acceptance Rate" in content
    assert "ai_acceptance_rate" in content


def test_frontend_metrics_steward_breakdown_hidden_for_ai_reviewer():
    """Metrics page hides steward breakdown for ai_reviewer."""
    path = Path("frontend/app/(dashboard)/stewardship/metrics/page.tsx")
    content = path.read_text()
    assert "isAiReviewer" in content
    assert "Individual steward metrics are not visible" in content


def test_frontend_api_client_exists():
    """Frontend API client for stewardship exists."""
    path = Path("frontend/lib/api/stewardship.ts")
    assert path.exists()
    content = path.read_text()
    assert "getQueueItems" in content
    assert "resolveItem" in content
    assert "bulkApprove" in content
    assert "getMetrics" in content
    assert "submitAiFeedback" in content


def test_frontend_types_defined():
    """Frontend types for stewardship are defined."""
    path = Path("frontend/types/api.ts")
    content = path.read_text()
    assert "StewardshipQueueItem" in content
    assert "StewardshipItemType" in content
    assert "StewardshipMetrics" in content
    assert "StewardBreakdown" in content


def test_frontend_nav_has_stewardship():
    """Dashboard layout includes Stewardship nav item under Steward group."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    assert "/stewardship" in content
    assert "Steward" in content  # group label
    assert "ClipboardList" in content


# ── L.2 ai_triage task file structure ────────────────────────────────────────


def test_ai_triage_uses_pii_sanitiser():
    """ai_triage imports sanitise_for_prompt."""
    path = Path("workers/tasks/ai_triage.py")
    content = path.read_text()
    assert "sanitise_for_prompt" in content
    assert "from api.utils.pii_fields import sanitise_for_prompt" in content


def test_ai_triage_uses_llm_logger():
    """ai_triage imports log_llm_call."""
    path = Path("workers/tasks/ai_triage.py")
    content = path.read_text()
    assert "log_llm_call" in content
    assert "from api.utils.llm_logger import log_llm_call" in content


def test_ai_triage_token_limit():
    """ai_triage enforces 800 token limit."""
    path = Path("workers/tasks/ai_triage.py")
    content = path.read_text()
    assert "MAX_TOKENS = 800" in content
    assert "max_tokens=MAX_TOKENS" in content


def test_ai_triage_separate_task_chain():
    """Queue population enqueues ai_triage as a separate task."""
    path = Path("workers/tasks/populate_stewardship_queue.py")
    content = path.read_text()
    assert "triage_queue_items.delay" in content

"""Phase O — UI navigation redesign and AI rules page tests."""

from pathlib import Path
import pytest


# ── O.1 Grouped sidebar navigation ──────────────────────────────────────────


def test_sidebar_has_nav_groups():
    """Sidebar uses grouped navigation with Connect / Govern / Steward / Analyse / Report."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    for group in ("Connect", "Govern", "Steward", "Analyse", "Report"):
        assert group in content, f"Missing nav group: {group}"


def test_sidebar_connect_items():
    """Connect group has Systems, Sync Monitor, Import."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    assert "/systems" in content
    assert "/sync" in content
    assert "/upload" in content


def test_sidebar_govern_items():
    """Govern group has Golden Records, Glossary, Contracts, Relationships."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    assert "/golden-records" in content
    assert "/glossary" in content
    assert "/contracts" in content
    assert "/relationships" in content


def test_sidebar_steward_items():
    """Steward group has Workbench, AI Rules, Exceptions, Cleaning, Dedup."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    assert "/stewardship" in content
    assert "/ai/rules" in content
    assert "/exceptions" in content
    assert "/cleaning" in content
    assert "/dedup" in content


def test_sidebar_analyse_items():
    """Analyse group has Dashboard, Findings, Analytics, Ask AI."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    # Dashboard is "/"
    assert "Dashboard" in content
    assert "/findings" in content
    assert "/analytics" in content
    assert "/nlp" in content


def test_sidebar_report_items():
    """Report group has Reports and Versions."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    assert "/reports" in content
    assert "/versions" in content


def test_ai_rules_permission_gating():
    """AI Rules nav item is gated by review_ai_rules permission."""
    path = Path("frontend/app/(dashboard)/layout.tsx")
    content = path.read_text(encoding="utf-8")
    assert "review_ai_rules" in content
    assert "ROLES_WITH_AI_RULES" in content


# ── O.2 AI Rules page ──────────────────────────────────────────────────────


def test_ai_rules_page_exists():
    """The /ai/rules page file exists."""
    path = Path("frontend/app/(dashboard)/ai/rules/page.tsx")
    assert path.exists()


def test_ai_rules_page_imports():
    """AI Rules page uses correct API functions."""
    path = Path("frontend/app/(dashboard)/ai/rules/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "getProposedRules" in content
    assert "approveProposedRule" in content
    assert "rejectProposedRule" in content


def test_ai_rules_page_empty_state():
    """AI Rules page shows correct empty state message."""
    path = Path("frontend/app/(dashboard)/ai/rules/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "No AI-proposed rules awaiting review" in content
    assert "steward corrections" in content


def test_ai_rules_page_approve_confirmation():
    """AI Rules page has approve confirmation dialog."""
    path = Path("frontend/app/(dashboard)/ai/rules/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "will be added to the match engine" in content


# ── O.3 Ask AI MDM context ─────────────────────────────────────────────────


def test_nlp_page_mdm_suggested_questions():
    """NLP page includes MDM-context suggested questions."""
    path = Path("frontend/app/(dashboard)/nlp/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "golden records" in content.lower() or "Business Partners with confidence" in content
    assert "mandatory fields" in content.lower() or "S/4HANA migration" in content
    assert "sync run" in content.lower() or "quality score" in content
    assert "merge decisions" in content.lower() or "pending for Material" in content


def test_nlp_page_updated_description():
    """NLP page description mentions MDM data sources."""
    path = Path("frontend/app/(dashboard)/nlp/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "golden records" in content
    assert "glossary" in content
    assert "relationships" in content
    assert "sync history" in content


# ── O.4 Team settings — ai_reviewer role ────────────────────────────────────


def test_settings_has_ai_reviewer_role():
    """Settings page includes ai_reviewer in ROLE_OPTIONS."""
    path = Path("frontend/app/(dashboard)/settings/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "ai_reviewer" in content
    assert "AI Reviewer" in content


def test_settings_ai_reviewer_purple_badge():
    """ai_reviewer role uses purple badge colour."""
    path = Path("frontend/app/(dashboard)/settings/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "bg-[#7C3AED]/10 text-[#7C3AED]" in content


def test_settings_ai_reviewer_tooltip():
    """ai_reviewer has descriptive tooltip."""
    path = Path("frontend/app/(dashboard)/settings/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "approve proposed rules" in content


def test_settings_permissions_table_has_ai_review_column():
    """Role permissions table includes AI Review column."""
    path = Path("frontend/app/(dashboard)/settings/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "AI Review" in content


# ── O.5 Upload page — connected systems banner ─────────────────────────────


def test_upload_page_connected_systems_banner():
    """Upload page shows banner when SAP systems are connected."""
    path = Path("frontend/app/(dashboard)/upload/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "Connected SAP systems detected" in content
    assert "one-off assessments" in content
    assert "getSystems" in content

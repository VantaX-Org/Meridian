"""Phase O — UI navigation redesign and AI rules page tests."""

import re
from pathlib import Path
import pytest


# ── O.1 Grouped navigation ──────────────────────────────────────────────────
#
# The nav is defined once in frontend/lib/nav.ts and read by the index bar (Rail) and the ⌘K command
# palette, so the two can't drift. "Work" holds the four main entries everyone uses (Fix work, Objects,
# Progress, Inbox); the other five sections sit under More. Each href appears once.

NAV = Path("frontend/lib/nav.ts")
LAYOUT = Path("frontend/app/(app)/layout.tsx")
VIEWS = Path("frontend/app/(app)/insights/_components/InsightViews.tsx")

NAV_GROUP_ORDER = ("Work", "Analysis", "Master data", "Rules", "Data in", "Admin")


def _has_item(text: str, href: str, label: str) -> bool:
    """href then label on one nav item, tolerating keys (requires, ...) between them."""
    return re.search(rf'href: "{re.escape(href)}",[^{{}}]*?label: "{re.escape(label)}"', text) is not None


def _nav() -> str:
    return NAV.read_text(encoding="utf-8")


def _group_block(content: str, group: str) -> str:
    """Source text of one group, from its `group:` line to the next group."""
    start = content.index(f'group: "{group}"')
    nxt = content.find("group: ", start + 1)
    return content[start: nxt if nxt != -1 else len(content)]


def test_sidebar_has_nav_groups():
    """The shared nav has the main entries first, then the More sections."""
    content = _nav()
    positions = [content.index(f'group: "{g}"') for g in NAV_GROUP_ORDER]
    assert positions == sorted(positions), "Nav groups are out of order"


def test_sidebar_and_palette_share_nav():
    """Sidebar and the Aurora command palette both render the role/licence-filtered shared nav."""
    layout = LAYOUT.read_text(encoding="utf-8")
    assert "useVisibleNav" in layout
    assert "CommandPalette" in layout and "flattenNav" in layout
    assert "NAV_GROUPS: NavGroup[] = [" not in layout, "layout must not keep its own nav copy"
    assert "const PAGES" not in layout, "palette must not keep its own nav copy"
    # Header titles come from the nav labels, not a hand-kept map.
    assert 'from "@/lib/nav"' in layout
    assert "export const PAGE_TITLES" in _nav()


def test_overview_items():
    """The main entries are Fix work, Objects, Progress and Inbox; the lead home sits under Analysis."""
    work = _group_block(_nav(), "Work")
    for href in ("/fix", "/objects", "/insights/progress", "/inbox"):
        assert f'"{href}"' in work, f"{href} missing from the main entries"
    assert _has_item(_group_block(_nav(), "Analysis"), "/home/lead", "Home")
    assert 'label: "Dashboard"' not in LAYOUT.read_text(encoding="utf-8") and 'label: "Dashboard"' not in _nav()


def test_sidebar_systems_and_data_items():
    """Data in has Systems, Import file and Migration (its own wave cockpit page)."""
    block = _group_block(_nav(), "Data in")
    for href in ("/systems", "/import", "/migration"):
        assert f'"{href}"' in block, f"{href} missing from Data in"


def test_sidebar_quality_items():
    """Objects is a main entry; Runs sits under Analysis."""
    content = _nav()
    assert _has_item(_group_block(content, "Work"), "/objects", "Objects")
    assert _has_item(_group_block(content, "Analysis"), "/runs", "Runs")


def test_sidebar_fix_items():
    """Fix work and the steward inbox, with Exceptions beneath it, are main entries."""
    work = _group_block(_nav(), "Work")
    assert _has_item(work, "/fix", "Fix work")
    assert _has_item(work, "/inbox", "Inbox")
    assert '"/inbox?kind=exception"' in work
    content = _nav()
    assert '"/stewardship"' not in content
    assert '"/workbench"' not in content
    assert 'label: "Workbench"' not in content, "duplicate 'Workbench' labels must be gone"


def test_sidebar_mdm_items():
    """Master data has Golden records, Match review, Glossary and Match rules."""
    block = _group_block(_nav(), "Master data")
    for href in ("/mdm/golden", "/mdm/golden/merge", "/mdm/glossary", "/mdm/match-rules"):
        assert f'"{href}"' in block


def test_sidebar_process_and_impact_items():
    """Processes sit under Analysis; the insight views reach the process map, lineage, patterns and duplicates."""
    assert '"/process"' in _group_block(_nav(), "Analysis")
    views = VIEWS.read_text(encoding="utf-8")
    for href in ("/insights/process", "/insights/lineage", "/insights/mining", "/insights/duplicates"):
        assert f'"{href}"' in views


def test_sidebar_reports_and_admin_items():
    """Insights is the report hub under Analysis; Admin has Users and audit and Settings with its sub-pages."""
    content = _nav()
    assert _has_item(_group_block(content, "Analysis"), "/insights", "Insights")
    assert '"/rules"' in _group_block(content, "Rules")
    admin = _group_block(content, "Admin")
    assert '"/admin/users"' in admin and '"/admin/settings"' in admin
    for href in ("/admin/triage", "/admin/mappings", "/admin/ai", "/admin/licence"):
        assert f'"{href}"' in content


def test_pages_removed_from_nav_stay_routable():
    """Off-nav pages keep their routes; live ones get a header title, the rest redirect.

    A retired page may redirect from next.config.ts instead of from a page file.
    """
    content = _nav()
    next_config = Path("frontend/next.config.ts").read_text(encoding="utf-8")
    for href in ("/command-centre", "/connectivity", "/run-sync"):
        assert f'href: "{href}"' not in content, f"{href} should no longer be a nav item"
        if f'source: "{href}"' in next_config:
            continue
        page = Path(f"frontend/app/(dashboard){href}/page.tsx")
        assert page.exists()
        if "redirect(" not in page.read_text():
            assert f'"{href}":' in content, f"{href} needs a header title"


def test_nav_permission_gating():
    """Items gate on 'any of' backend permission names; the filter applies them."""
    content = _nav()
    assert 'anyOf: ["manage_users"]' in content
    assert 'anyOf: ["approve", "apply"]' in content
    assert 'anyOf: ["approve", "assign"]' in content
    assert "anyOf.some((p) => can(p))" in content
    assert "isMenuItemEnabled(item.licenceKey)" in content



def test_settings_cards_are_gated():
    """Settings shows a deployment block and health checks; health stays gated on manage_system."""
    content = Path("frontend/app/(app)/admin/settings/page.tsx").read_text(encoding="utf-8")
    assert "Deployment" in content and "Health checks" in content
    assert 'can("manage_system")' in content


# ── O.2 AI Rules page ──────────────────────────────────────────────────────
#
# Deleted (not ported): the AI-proposed-rule review surface (/ai/rules,
# getProposedRules/approveProposedRule/rejectProposedRule) was intentionally
# left out of the Wave 3 shell. Nav's "AI rule review" item now opens the
# general rules catalogue (frontend/app/(app)/rules/page.tsx) instead; the
# proposed-rule API functions remain in frontend/lib/api/match-rules.ts but
# no page calls them. See .superpowers/sdd/.../task-11-report.md and
# task-21-report.md (frontend/app/(app)/mdm/match-rules/page.tsx:20-28).
# test_ai_rules_page_exists, test_ai_rules_page_imports,
# test_ai_rules_page_empty_state, test_ai_rules_page_approve_confirmation
# removed.


# ── O.4 Team settings — ai_reviewer role ────────────────────────────────────


# RBAC role administration moved from /settings to /admin (settings is now an
# index page that delegates user management to /admin).
def test_settings_has_ai_reviewer_role():
    """Admin page includes ai_reviewer in the invitable roles (the shared role list it imports)."""
    page = Path("frontend/app/(app)/admin/users/page.tsx").read_text(encoding="utf-8")
    assert '@/lib/roles' in page
    content = Path("frontend/lib/roles.ts").read_text(encoding="utf-8")
    assert "ai_reviewer" in content
    assert "AI Reviewer" in content


def test_settings_ai_reviewer_distinct_badge():
    """ai_reviewer has its own label; roles are plain text, hue is for defects only. The role names live in one
    module (frontend/lib/roles.ts) that Admin › Users and the account menu both read."""
    path = Path("frontend/lib/roles.ts")
    content = path.read_text(encoding="utf-8")
    assert 'ai_reviewer: { label: "AI Reviewer"' in content


def test_settings_ai_reviewer_tooltip():
    """ai_reviewer has descriptive tooltip."""
    path = Path("frontend/lib/roles.ts")
    content = path.read_text(encoding="utf-8")
    assert "approve proposed rules" in content


def test_settings_permissions_table_comes_from_the_api():
    """Admin › Users keeps no local copy of role capabilities and sets no role: it shows the user's grants
    from the API (GET /users/{id}/grants) and links to Roles and access, which owns the server's matrix."""
    path = Path("frontend/app/(app)/admin/users/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "listGrants" in content and "ai_feedback" not in content
    assert "ROLE_OPTIONS" not in content and "<Select" not in content


# ── O.5 Upload page — connected systems banner ─────────────────────────────


def test_upload_page_connected_systems_banner():
    """Upload page shows banner when SAP systems are connected."""
    path = Path("frontend/app/(app)/import/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "connected" in content and "Open systems" in content
    assert "one-off assessments" in content
    assert "getSystems" in content

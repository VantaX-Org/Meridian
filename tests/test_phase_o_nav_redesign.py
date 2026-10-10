"""Phase O — UI navigation redesign and AI rules page tests."""

from pathlib import Path
import pytest


# ── O.1 Grouped sidebar navigation ──────────────────────────────────────────
#
# The nav is defined once in frontend/lib/nav.ts and read by both the sidebar
# (app/(dashboard)/layout.tsx) and the ⌘K command palette, so the two can't
# drift. Ten sections, in journey order; each href appears once.

NAV = Path("frontend/lib/nav.ts")
LAYOUT = Path("frontend/app/(app)/layout.tsx")

NAV_GROUP_ORDER = (
    "Home",
    "Systems",
    "Objects",
    "Runs",
    "Fix",
    "Inbox",
    "Insights",
    "MDM",
    "Rules",
    "Admin",
)


def _nav() -> str:
    return NAV.read_text(encoding="utf-8")


def _group_block(content: str, group: str) -> str:
    """Source text of one group, from its `group:` line to the next group."""
    start = content.index(f'group: "{group}"')
    nxt = content.find("group: ", start + 1)
    return content[start: nxt if nxt != -1 else len(content)]


def test_sidebar_has_nav_groups():
    """The shared nav has the job-based groups, in journey order."""
    content = _nav()
    positions = [content.index(f'group: "{g}"') for g in NAV_GROUP_ORDER]
    assert positions == sorted(positions), "Nav groups are out of journey order"


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
    """Home holds the role home at /home/lead; no 'Dashboard' label."""
    block = _group_block(_nav(), "Home")
    assert 'href: "/home/lead", label: "Home"' in block
    assert '"/analytics"' not in block
    assert 'label: "Dashboard"' not in LAYOUT.read_text(encoding="utf-8") and 'label: "Dashboard"' not in _nav()



def test_sidebar_systems_and_data_items():
    """Systems has Systems, Import file and Migration (its own wave cockpit page)."""
    block = _group_block(_nav(), "Systems")
    for href in ("/systems", "/import", "/migration"):
        assert f'"{href}"' in block, f"{href} missing from Systems"



def test_sidebar_quality_items():
    """Objects and Runs are their own sections."""
    content = _nav()
    assert 'href: "/objects", label: "Objects"' in _group_block(content, "Objects")
    assert 'href: "/runs", label: "Runs"' in _group_block(content, "Runs")



def test_sidebar_fix_items():
    """Fix holds cleaning; the steward inbox, with Exceptions beneath it, is its own section."""
    content = _nav()
    assert 'href: "/fix", label: "Fix"' in _group_block(content, "Fix")
    inbox = _group_block(content, "Inbox")
    assert 'href: "/inbox",\n        label: "Inbox"' in inbox
    assert '"/inbox?kind=exception"' in inbox
    assert '"/stewardship"' not in content
    assert '"/workbench"' not in content
    assert 'label: "Workbench"' not in content, "duplicate 'Workbench' labels must be gone"



def test_sidebar_mdm_items():
    """MDM (renamed from 'Master data') has Golden records, Glossary and Match rules."""
    block = _group_block(_nav(), "MDM")
    for href in ("/mdm/golden", "/mdm/glossary", "/mdm/match-rules"):
        assert f'"{href}"' in block


def test_sidebar_process_and_impact_items():
    """Insights holds the process map, lineage, pattern mining and duplicate clusters."""
    block = _group_block(_nav(), "Insights")
    for href in ("/insights/process", "/insights/lineage", "/insights/mining", "/insights/duplicates"):
        assert f'"{href}"' in block



def test_sidebar_reports_and_admin_items():
    """Insights is the report hub; Admin has Users and audit and Settings with its sub-pages."""
    content = _nav()
    assert 'href: "/insights",\n        label: "Insights"' in _group_block(content, "Insights")
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
    """Admin page includes ai_reviewer in the invitable roles."""
    path = Path("frontend/app/(app)/admin/users/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "ai_reviewer" in content
    assert "AI Reviewer" in content


def test_settings_ai_reviewer_distinct_badge():
    """ai_reviewer has its own label; roles are plain text, hue is for defects only."""
    path = Path("frontend/app/(app)/admin/users/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert 'ai_reviewer: { label: "AI Reviewer"' in content


def test_settings_ai_reviewer_tooltip():
    """ai_reviewer has descriptive tooltip."""
    path = Path("frontend/app/(app)/admin/users/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "approve proposed rules" in content


def test_settings_permissions_table_comes_from_the_api():
    """Role capabilities table is the server's matrix (GET /auth/roles), never a local copy."""
    path = Path("frontend/app/(app)/admin/users/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "getRoleMatrix" in content and "ai_feedback" not in content


# ── O.5 Upload page — connected systems banner ─────────────────────────────


def test_upload_page_connected_systems_banner():
    """Upload page shows banner when SAP systems are connected."""
    path = Path("frontend/app/(app)/import/page.tsx")
    content = path.read_text(encoding="utf-8")
    assert "connected" in content and "Download from the source" in content
    assert "one-off assessments" in content
    assert "getSystems" in content

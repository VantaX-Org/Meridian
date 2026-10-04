"""Phase O — UI navigation redesign and AI rules page tests."""

from pathlib import Path
import pytest


# ── O.1 Grouped sidebar navigation ──────────────────────────────────────────
#
# The nav is defined once in frontend/lib/nav.ts and read by both the sidebar
# (app/(dashboard)/layout.tsx) and the ⌘K command palette, so the two can't
# drift. Groups follow the user's job, in journey order.

NAV = Path("frontend/lib/nav.ts")
LAYOUT = Path("frontend/app/(dashboard)/layout.tsx")
PALETTE = Path("frontend/components/command-palette.tsx")

NAV_GROUP_ORDER = (
    "Overview",
    "Systems & data",
    "Quality",
    "Fix",
    "Master data",
    "Process & impact",
    "Reports",
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
    """Sidebar and command palette both render the role/licence-filtered shared nav."""
    layout = LAYOUT.read_text(encoding="utf-8")
    palette = PALETTE.read_text(encoding="utf-8")
    assert "useVisibleNav" in layout
    assert "useVisibleNav" in palette
    assert "NAV_GROUPS: NavGroup[] = [" not in layout, "layout must not keep its own nav copy"
    assert "const PAGES" not in palette, "palette must not keep its own nav copy"
    # Header titles come from the nav labels, not a hand-kept map.
    assert 'from "@/lib/nav"' in layout
    assert "export const PAGE_TITLES" in _nav()


def test_overview_items():
    """Overview holds Command Centre at / plus Analytics; no 'Dashboard' label."""
    block = _group_block(_nav(), "Overview")
    assert 'href: "/", label: "Command Centre"' in block
    assert '"/analytics"' in block
    palette = PALETTE.read_text(encoding="utf-8")
    assert 'label: "Dashboard"' not in palette and 'label: "Dashboard"' not in _nav()


def test_sidebar_systems_and_data_items():
    """Systems & data (second group) has Systems, Import file, Download history, Migration."""
    block = _group_block(_nav(), "Systems & data")
    for href in ("/systems", "/upload", "/sync", "/migration"):
        assert f'"{href}"' in block, f"{href} missing from Systems & data"


def test_sidebar_quality_items():
    """Quality has Findings, Failing records (/issues) and Compare versions (/versions)."""
    block = _group_block(_nav(), "Quality")
    assert '"/findings"' in block
    assert 'href: "/issues", label: "Failing records"' in block
    assert 'href: "/versions", label: "Compare versions"' in block


def test_sidebar_fix_items():
    """Fix has the steward inbox plus Cleaning, Exceptions, Duplicates, AI rule review."""
    block = _group_block(_nav(), "Fix")
    assert 'href: "/workbench", label: "Steward inbox"' in block
    assert '"/stewardship"' not in block
    for href in ("/cleaning", "/exceptions", "/dedup", "/ai/rules"):
        assert f'"{href}"' in block, f"{href} missing from Fix"
    assert 'label: "Workbench"' not in _nav(), "duplicate 'Workbench' labels must be gone"


def test_sidebar_master_data_items():
    """Master data has Golden records, Glossary, Contracts, Relationships."""
    block = _group_block(_nav(), "Master data")
    for href in ("/golden-records", "/glossary", "/contracts", "/relationships"):
        assert f'"{href}"' in block


def test_sidebar_process_and_impact_items():
    """Process & impact has the process map, readiness, config impact and pattern mining."""
    block = _group_block(_nav(), "Process & impact")
    for href in ("/process", "/business-process", "/config-impact", "/mining"):
        assert f'"{href}"' in block


def test_sidebar_reports_and_admin_items():
    """Reports has Reports; Admin has Users & audit and Settings with its sub-pages."""
    content = _nav()
    assert '"/reports"' in _group_block(content, "Reports")
    admin = _group_block(content, "Admin")
    assert '"/admin"' in admin and '"/settings"' in admin
    for href in ("/settings/rules", "/settings/field-mapping", "/settings/ai", "/settings/licence"):
        assert f'"{href}"' in content


def test_pages_removed_from_nav_stay_routable():
    """Off-nav pages keep their routes and still get a header title."""
    content = _nav()
    for href in ("/command-centre", "/connectivity", "/run-sync"):
        assert f'href: "{href}"' not in content, f"{href} should no longer be a nav item"
        assert f'"{href}":' in content, f"{href} needs a header title"
        assert Path(f"frontend/app/(dashboard){href}/page.tsx").exists()


def test_nav_permission_gating():
    """Items gate on 'any of' backend permission names; the filter applies them."""
    content = _nav()
    assert 'anyOf: ["review_ai_rules"]' in content
    assert 'anyOf: ["manage_users"]' in content
    assert 'anyOf: ["trigger_sync"]' in content
    assert 'anyOf: ["approve", "apply", "assign", "mdm.write", "review_ai_rules"]' in content
    assert "anyOf.some((p) => can(p))" in content
    assert "isMenuItemEnabled(item.licenceKey)" in content


def test_settings_cards_are_gated():
    """Settings cards use the same gate as their nav entries."""
    content = Path("frontend/app/(dashboard)/settings/page.tsx").read_text(encoding="utf-8")
    assert "isItemVisible" in content
    assert "SETTINGS_ITEMS" in content


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


# ── O.4 Team settings — ai_reviewer role ────────────────────────────────────


# RBAC role administration moved from /settings to /admin (settings is now an
# index page that delegates user management to /admin).
def test_settings_has_ai_reviewer_role():
    """Admin page includes ai_reviewer in the invitable roles."""
    path = Path("frontend/components/admin/users.tsx")
    content = path.read_text(encoding="utf-8")
    assert "ai_reviewer" in content
    assert "AI Reviewer" in content


def test_settings_ai_reviewer_distinct_badge():
    """ai_reviewer role has its own badge tone (Aurora status tones, not hex)."""
    path = Path("frontend/components/admin/users.tsx")
    content = path.read_text(encoding="utf-8")
    assert "ai_reviewer: \"warning\"" in content


def test_settings_ai_reviewer_tooltip():
    """ai_reviewer has descriptive tooltip."""
    path = Path("frontend/components/admin/users.tsx")
    content = path.read_text(encoding="utf-8")
    assert "approve proposed rules" in content


def test_settings_permissions_table_comes_from_the_api():
    """Role capabilities table is the server's matrix (GET /auth/roles), never a local copy."""
    path = Path("frontend/components/admin/users.tsx")
    content = path.read_text(encoding="utf-8")
    assert "getRoleMatrix" in content and "ai_feedback" not in content


# ── O.5 Upload page — connected systems banner ─────────────────────────────


def test_upload_page_connected_systems_banner():
    """Upload page shows banner when SAP systems are connected."""
    path = Path("frontend/components/data/import.tsx")
    content = path.read_text(encoding="utf-8")
    assert "connected" in content and "Download from the source" in content
    assert "one-off assessments" in content
    assert "getSystems" in content

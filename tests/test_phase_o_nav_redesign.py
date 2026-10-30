"""Role names in the frontend: one module (frontend/lib/roles.ts) that Administration and the account menu read.

The grouped navigation, the index bar and the old settings and upload pages this file used to check were retired at the
cut-over to the map, canvas and inspector (Meridian 2, step 7); frontend/__tests__/legacy-redirects.test.ts checks that
each of their addresses still opens the page that does the same job.
"""

from pathlib import Path


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

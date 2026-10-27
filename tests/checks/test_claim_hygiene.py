"""Claim hygiene: README and docs/market-positioning.md quote library numbers in a
product whose differentiator is "every number here is checkable" (docs/market-positioning.md:8-9).
They drifted anyway (8,114 vs 8,380 rules; 20 vs 21 classes; 9,791 vs 10,109 proofs) — the audits
found the stale claims and fixed them by hand, which is how they rotted a second time.

This test recomputes every quoted number from the tree and asserts the documents carry exactly
those values. A rule added, a class registered, a proof parametrized: the docs fail until they
are updated in the same commit. That is the whole point.

Run: pytest tests/checks/test_claim_hygiene.py
"""

from __future__ import annotations

import glob
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _rule_counts() -> tuple[int, int, int]:
    """(total, enabled, disabled) across every shipped rule YAML, sidecars included —
    the same traversal the rule audits measured with."""
    total = enabled = 0
    for f in glob.glob(str(ROOT / "checks/rules/*/*.yaml")):
        import yaml
        try:
            d = yaml.safe_load(open(f))
        except Exception:
            continue
        rules = d.get("rules", d) if isinstance(d, dict) else d
        if isinstance(rules, dict):
            rules = rules.get("rules", [])
        for r in rules or []:
            if isinstance(r, dict) and "check_class" in r:
                total += 1
                if r.get("enabled", True):
                    enabled += 1
    return total, enabled, total - enabled


def _collected(test_file: str) -> int:
    out = subprocess.run([sys.executable, "-m", "pytest", test_file, "--collect-only", "-q"],
                         cwd=ROOT, capture_output=True, text=True, timeout=600)
    m = re.search(r"(\d+) tests? collected", out.stdout)
    assert m, f"could not read a collection count from {test_file}:\n{out.stdout[-400:]}{out.stderr[-400:]}"
    return int(m.group(1))


@pytest.fixture(scope="module")
def numbers() -> dict:
    from checks.runner import REGISTRY
    total, enabled, disabled = _rule_counts()
    return {"classes": len(REGISTRY), "rules": total, "enabled": enabled, "disabled": disabled,
            "proofs": _collected("tests/checks/test_rule_proofs.py"),
            "integrity": _collected("tests/checks/test_rule_integrity.py")}


def test_registry_class_count_is_21(numbers):
    assert numbers["classes"] == 21  # guards the market-positioning row; REGISTRY changing means docs change


def test_rule_split_adds_up(numbers):
    assert numbers["enabled"] + numbers["disabled"] == numbers["rules"]


def test_readme_quotes_the_live_rule_total(numbers):
    txt = (ROOT / "README.md").read_text()
    assert f"**{numbers['rules']:,} validation rules**" in txt, \
        f"README:3 must carry the live count ({numbers['rules']:,})"
    assert f"— {numbers['enabled']:,} hand-authored plus {numbers['disabled']:,} derived" in txt, \
        "README:10 must carry the live enabled/derived split"


def test_market_positioning_table_quotes_live_numbers(numbers):
    txt = (ROOT / "docs/market-positioning.md").read_text()
    checks = [
        rf"\*\*{numbers['rules']:,} validation rules\*\*.*\({numbers['enabled']:,} hand-authored \+ {numbers['disabled']:,}",
        rf"{numbers['enabled']:,} hand-authored \+ {numbers['disabled']:,} DDIC-derived",
        rf"\*\*{numbers['classes']} check classes\*\*",
        rf"test_rule_proofs\.py` — {numbers['proofs']:,} cases",
        rf"test_rule_integrity\.py` — {numbers['integrity']:,} cases",
    ]
    for pat in checks:
        assert re.search(pat, txt), f"docs/market-positioning.md must carry /{pat}/ (live numbers)"


def test_stale_counts_are_gone(numbers):
    """The exact previous drift, banned from returning as prose."""
    for p in (ROOT / "README.md", ROOT / "docs/market-positioning.md"):
        txt = p.read_text()
        for stale in ("8,114", "5,395", "2,719", "20 check classes", "9,791", "1,898 cases"):
            assert stale not in txt, f"{p.name} still quotes the stale {stale!r}"

import uuid
from pathlib import Path

import pandas as pd
import pytest
import yaml

from checks.runner import run_checks
from checks.base import CheckResult

RULES_DIR = Path(__file__).parent.parent.parent / "checks" / "rules" / "successfactors"

# Expected rule counts per module
EXPECTED_COUNTS = {
    "employee_central": 14,
    "compensation": 8,
    "recruiting_onboarding": 7,
    "learning_management": 5,
    "performance_goals": 5,
    "succession_planning": 3,
    "time_attendance": 5,
    "benefits": 4,
    "payroll_integration": 6,
}

REQUIRED_ENRICHMENT_FIELDS = ["fix_map", "rule_authority", "why_it_matters", "sap_impact"]


def _load_rules(module_name: str) -> list[dict]:
    """Load rules from a YAML file."""
    path = RULES_DIR / f"{module_name}.yaml"
    with open(path, "r") as f:
        config = yaml.safe_load(f)
    return config.get("rules", [])


def _make_ec_dataframe(n: int = 50) -> pd.DataFrame:
    """Create a synthetic Employee Central DataFrame with known dirty rows."""
    import random
    from datetime import datetime, timedelta, timezone

    random.seed(42)
    now = datetime.now(timezone.utc)

    rows = []
    for i in range(n):
        clean = i >= 10  # first 10 rows are dirty
        rows.append({
            "EMPEMPLOYMENT.USERID": (
                f"user.{i}" if clean else ("" if i < 3 else "bad user/id!")
            ),
            "PERINFO.FIRSTNAME": "Alice" if clean else (None if i < 2 else "Alice"),
            "PERINFO.LASTNAME": "Smith" if clean else (None if i < 2 else "Smith"),
            "EMPEMPLOYMENT.START_DATE": (
                "2024-01-15" if clean else ("" if i < 3 else "15/01/2024")
            ),
            "EMPEMPLOYMENT.COMPANY": "ACME" if clean else (None if i < 4 else "ACME"),
            "EMPEMPLOYMENT.DEPARTMENT": "IT" if clean else (None if i < 3 else "IT"),
            "EMPEMPLOYMENT.JOB_CODE": "DEV01" if clean else (None if i < 3 else "DEV01"),
            "EMPEMPLOYMENT.EMPLOYMENT_TYPE": (
                random.choice(["P", "T", "C"]) if clean else ("X" if i == 5 else None)
            ),
            "EMPEMPLOYMENT.MANAGER_ID": "mgr.001" if clean else (None if i < 4 else "mgr.001"),
            "EMPEMPLOYMENT.POSITION": "POS001" if clean else (None if i < 4 else "POS001"),
            "EMPEMPLOYMENT.LOCATION": "JHB" if clean else (None if i < 4 else "JHB"),
            "EMPEMPLOYMENT.CREATED_DATE": (
                (now - timedelta(days=random.randint(1, 300))).isoformat()
                if clean
                else (now - timedelta(days=4000)).isoformat()
            ),
        })
    return pd.DataFrame(rows)


# ---- Test 1: All YAML files load without error ----

@pytest.mark.parametrize("module_name", list(EXPECTED_COUNTS.keys()))
def test_yaml_loads_without_error(module_name: str):
    """Each YAML file should parse without error."""
    rules = _load_rules(module_name)
    assert len(rules) > 0, f"{module_name}.yaml has no rules"


# ---- Test 2: Rule counts match expected ----

@pytest.mark.parametrize("module_name,expected_count", list(EXPECTED_COUNTS.items()))
def test_rule_counts(module_name: str, expected_count: int):
    """Each module should have the exact expected number of rules."""
    rules = _load_rules(module_name)
    assert len(rules) == expected_count, (
        f"{module_name}: expected {expected_count} rules, got {len(rules)}"
    )


# ---- Test 3: Every rule has required enrichment fields ----

@pytest.mark.parametrize("module_name", list(EXPECTED_COUNTS.keys()))
def test_all_rules_have_enrichment(module_name: str):
    """Every rule must have fix_map, rule_authority, why_it_matters, sap_impact."""
    rules = _load_rules(module_name)
    for rule in rules:
        rule_id = rule.get("id", "UNKNOWN")
        for field in REQUIRED_ENRICHMENT_FIELDS:
            assert rule.get(field), (
                f"{module_name}/{rule_id} is missing '{field}'"
            )


# ---- Test 4: Running null_check against blank data produces enriched results ----

def test_ec_null_check_finds_failures_with_enrichment():
    """Running employee_central checks against blank data should produce failing
    results with rule_context and value_fix_map populated."""
    df = _make_ec_dataframe(50)
    results = run_checks("employee_central", df, "test-tenant")

    assert len(results) == 14
    assert all(isinstance(r, CheckResult) for r in results)

    failing = [r for r in results if not r.passed and not r.error]
    assert len(failing) > 0, "Expected at least some failing checks with dirty data"

    # At least one failing result should have rule_context populated
    with_context = [r for r in failing if r.rule_context]
    assert len(with_context) > 0, "Expected rule_context on failing results"

    # Check that rule_context has expected keys
    ctx = with_context[0].rule_context
    assert "why_it_matters" in ctx
    assert "rule_authority" in ctx
    assert "sap_impact" in ctx

    # At least one failing result should have value_fix_map populated
    with_fixes = [r for r in failing if r.value_fix_map]
    assert len(with_fixes) > 0, "Expected value_fix_map on failing results"


# ---- Test 5: Total rule count across all SF modules ----

def test_total_sf_rule_count():
    """Total across all 9 SF modules should be 57 rules."""
    total = 0
    for module_name in EXPECTED_COUNTS:
        rules = _load_rules(module_name)
        total += len(rules)
    assert total == 57, f"Expected 57 total SF rules, got {total}"


# ---- Test 6: domain_value_check rules have valid_values_with_labels ----

@pytest.mark.parametrize("module_name", list(EXPECTED_COUNTS.keys()))
def test_domain_value_checks_have_labels(module_name: str):
    """All domain_value_check rules should have valid_values_with_labels."""
    rules = _load_rules(module_name)
    for rule in rules:
        if rule.get("check_class") == "domain_value_check":
            assert rule.get("valid_values_with_labels"), (
                f"{module_name}/{rule['id']} is a domain_value_check but missing "
                f"valid_values_with_labels"
            )
            assert rule.get("allowed_values"), (
                f"{module_name}/{rule['id']} is a domain_value_check but missing "
                f"allowed_values"
            )

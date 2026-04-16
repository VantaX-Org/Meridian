import uuid
from pathlib import Path

import pandas as pd
import pytest
import yaml

from checks.runner import run_checks
from checks.base import CheckResult

RULES_DIR = Path(__file__).parent.parent.parent / "checks" / "rules" / "ecc"

# Expected rule counts per module
EXPECTED_COUNTS = {
    "accounts_payable": 10,
    "accounts_receivable": 10,
    "asset_accounting": 9,
    "mm_purchasing": 8,
    "sd_customer_master": 10,
    "sd_sales_orders": 9,
    "production_planning": 10,
    "plant_maintenance": 8,
}

REQUIRED_ENRICHMENT_FIELDS = ["fix_map", "rule_authority", "why_it_matters", "sap_impact"]


def _load_rules(module_name: str) -> list[dict]:
    """Load rules from a YAML file."""
    path = RULES_DIR / f"{module_name}.yaml"
    with open(path, "r") as f:
        config = yaml.safe_load(f)
    return config.get("rules", [])


def _make_ap_dataframe(n: int = 50) -> pd.DataFrame:
    """Create a synthetic Accounts Payable DataFrame with known dirty rows."""
    import random

    random.seed(42)

    rows = []
    for i in range(n):
        clean = i >= 10  # first 10 rows are dirty
        rows.append({
            "LFB1.LIFNR": (
                f"{1000000000 + i}" if clean else ("" if i < 3 else "ABC123")
            ),
            "LFA1.NAME1": "Vendor Corp" if clean else (None if i < 2 else "Vendor Corp"),
            "LFA1.LAND1": "ZA" if clean else (None if i < 3 else "ZA"),
            "LFB1.AKONT": "210000" if clean else (None if i < 4 else "210000"),
            "LFB1.ZTERM": "ZB30" if clean else (None if i < 3 else "ZB30"),
            "LFA1.STCD1": "4123456789" if clean else (None if i < 4 else "4123456789"),
            "LFB1.PERNR": ("" if clean else ("00012345" if i == 5 else "")),
            "LFA1.SMTP_ADDR": (
                "vendor@example.com" if clean else ("" if i < 3 else "bad-email")
            ),
            "LFB1.FDGRV": "A1" if clean else (None if i < 4 else "A1"),
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


# ---- Test 4: Runner discovers and executes rules from each new module ----

def test_ap_checks_run_with_enrichment():
    """Running accounts_payable checks against dirty data should produce failing
    results with rule_context and value_fix_map populated."""
    df = _make_ap_dataframe(50)
    results = run_checks("accounts_payable", df, "test-tenant")

    assert len(results) == 10
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


# ---- Test 5: Total rule count across all 8 new ECC modules ----

def test_total_new_ecc_rule_count():
    """Total across all 8 new ECC modules should be 74 rules."""
    total = 0
    for module_name in EXPECTED_COUNTS:
        rules = _load_rules(module_name)
        total += len(rules)
    assert total == 74, f"Expected 74 total new ECC rules, got {total}"


# ---- Test 6: domain_value_check rules have valid_values_with_labels ----

@pytest.mark.parametrize("module_name", list(EXPECTED_COUNTS.keys()))
def test_domain_value_checks_have_labels(module_name: str):
    """All domain_value_check rules with allowed_values should have valid_values_with_labels."""
    rules = _load_rules(module_name)
    for rule in rules:
        if rule.get("check_class") == "domain_value_check" and rule.get("allowed_values"):
            assert rule.get("valid_values_with_labels"), (
                f"{module_name}/{rule['id']} is a domain_value_check but missing "
                f"valid_values_with_labels"
            )

import uuid
from pathlib import Path

import pandas as pd
import pytest
import yaml

from checks.runner import run_checks
from checks.base import CheckResult

RULES_DIR = Path(__file__).parent.parent.parent / "checks" / "rules" / "warehouse"

# Expected rule counts per module
EXPECTED_COUNTS = {
    "ewms_stock": 8,
    "ewms_transfer_orders": 7,
    "fleet_management": 8,
    "cross_system_integration": 8,
    "transport_management": 7,
    "batch_management": 7,
    "wm_interface": 6,
    "grc_compliance": 6,
    "mdg_master_data": 8,
}

REQUIRED_ENRICHMENT_FIELDS = ["fix_map", "rule_authority", "why_it_matters", "sap_impact"]


def _load_rules(module_name: str) -> list[dict]:
    """Load rules from a YAML file."""
    path = RULES_DIR / f"{module_name}.yaml"
    with open(path, "r") as f:
        config = yaml.safe_load(f)
    return config.get("rules", [])


# ---- Test 1: All 9 YAML files load without error ----

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


# ---- Test 4: Runner discovers warehouse modules ----

def test_runner_discovers_warehouse_modules():
    """The check runner should be able to load and execute warehouse module rules."""
    # Create a minimal DataFrame for ewms_stock
    df = pd.DataFrame({
        "LGPLA.LGNUM": ["WH01", "", None, "WH01", "WH01"],
        "LGPLA.LGTYP": ["001", "001", "001", "", "001"],
        "LGPLA.LGPLA": ["BIN-001", "BIN-002", "BIN-003", "BIN-004", None],
        "LQUA.MATNR": ["MAT001", "MAT002", None, "MAT004", "MAT005"],
        "LQUA.WERKS": ["1000", "1000", "1000", None, "1000"],
        "LQUA.BESTQ": ["", "Q", "X", "S", ""],
        "LQUA.CHARG": ["BATCH01", None, "BATCH03", "BATCH04", ""],
        "LGPLA.LGBER": ["001", "", "001", "001", None],
    })
    results = run_checks("ewms_stock", df, "test-tenant")

    assert len(results) == 8
    assert all(isinstance(r, CheckResult) for r in results)

    # Should have some failing checks with the dirty data
    failing = [r for r in results if not r.passed and not r.error]
    assert len(failing) > 0, "Expected at least some failing checks with dirty data"


# ---- Test 5: Total rule count across all 9 warehouse modules ----

def test_total_warehouse_rule_count():
    """Total across all 9 warehouse modules should be 65 rules."""
    total = 0
    for module_name in EXPECTED_COUNTS:
        rules = _load_rules(module_name)
        total += len(rules)
    assert total == 65, f"Expected 65 total warehouse rules, got {total}"


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

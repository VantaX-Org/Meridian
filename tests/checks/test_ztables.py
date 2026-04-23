"""Tests for Z-table (customer-namespace) rule support."""

from __future__ import annotations

import pandas as pd
import pytest
import yaml
from pathlib import Path

from checks.ztables import (
    discover_ztable_rules,
    is_customer_namespace,
)


# ---------------------------------------------------------------------------
# Namespace detection
# ---------------------------------------------------------------------------


def test_is_customer_namespace_standard_tables():
    assert not is_customer_namespace("MARA.MATNR")
    assert not is_customer_namespace("BUT000.PARTNER")
    assert not is_customer_namespace("T077Y")
    assert not is_customer_namespace("")


def test_is_customer_namespace_z_tables():
    assert is_customer_namespace("ZVENDOR_EXT")
    assert is_customer_namespace("ZPARTNER_EXT.ZPARTNER_ID")
    assert is_customer_namespace("ZMARA_EXTN")


def test_is_customer_namespace_y_tables():
    """Y* is also customer namespace in SAP."""
    assert is_customer_namespace("YSALES_EXT")
    assert is_customer_namespace("YCOST_ALLOC.ITEM")


def test_is_customer_namespace_zz_fields_on_standard_tables():
    """Extension fields (ZZ_*) on standard tables are still customer-ns."""
    assert is_customer_namespace("MARA.ZZ_REACH_COMPLIANT")
    assert is_customer_namespace("LFA1.ZZ_SUPPLIER_RISK_SCORE")
    assert is_customer_namespace("BUT000.ZZ_CUSTOM_FLAG")


def test_is_customer_namespace_edge_cases():
    # Single-letter prefix that's NOT Y/Z
    assert not is_customer_namespace("MARA.XFIELD")
    # Y or Z alone isn't a valid identifier but the regex permits it
    assert is_customer_namespace("Z")
    # Lowercase z is not customer namespace in SAP
    assert not is_customer_namespace("zmara.matnr")


# ---------------------------------------------------------------------------
# Rule discovery
# ---------------------------------------------------------------------------


def test_discover_common_ztable_rules():
    """The shipped common.yaml must load."""
    rules = discover_ztable_rules()
    ids = {r.get("id") for r in rules}
    assert "ZT001" in ids  # MARA.ZZ_REACH_COMPLIANT
    assert "ZT002" in ids  # LFA1.ZZ_SUPPLIER_RISK_SCORE
    assert "ZT003" in ids  # ZPARTNER_EXT.ZPARTNER_ID
    # Every rule is stamped customer-namespace
    assert all(r.get("namespace") == "customer" for r in rules)


def test_discover_tenant_specific_rules(tmp_path, monkeypatch):
    """A tenant-scoped YAML in checks/rules/ztables/tenant/<tid>.yaml is
    loaded in addition to the common pack when tenant_id is passed."""
    import checks.ztables as ztables_mod

    fake_tenant = "_test_tenant_abc"
    base = Path(ztables_mod.__file__).parent / "rules" / "ztables"
    tenant_dir = base / "tenant"
    tenant_dir.mkdir(exist_ok=True)
    tenant_yaml = tenant_dir / f"{fake_tenant}.yaml"

    try:
        tenant_yaml.write_text(yaml.dump({
            "module": "tenant_specific",
            "rules": [
                {
                    "id": "ZTEN001",
                    "field": "ZTENANT_TABLE.ZFIELD",
                    "check_class": "null_check",
                    "severity": "medium",
                    "dimension": "completeness",
                    "message": "Tenant-specific Z-field must be populated",
                },
            ],
        }))

        # Without tenant_id: only common pack
        common = discover_ztable_rules()
        common_ids = {r.get("id") for r in common}
        assert "ZTEN001" not in common_ids

        # With tenant_id: common + tenant pack
        combined = discover_ztable_rules(tenant_id=fake_tenant)
        combined_ids = {r.get("id") for r in combined}
        assert "ZTEN001" in combined_ids
        assert combined_ids.issuperset(common_ids)
    finally:
        if tenant_yaml.exists():
            tenant_yaml.unlink()


def test_discover_tenant_missing_file_returns_common_only():
    """A nonexistent tenant id yields just the common pack, not an error."""
    rules = discover_ztable_rules(tenant_id="nonexistent_tenant_zz99")
    # Should be identical to the no-tenant call
    baseline = discover_ztable_rules()
    assert len(rules) == len(baseline)


# ---------------------------------------------------------------------------
# End-to-end: running a Z-rule against a DataFrame
# ---------------------------------------------------------------------------


def test_ztable_rule_executes_against_df():
    """A Z-field rule evaluates correctly against an extract that has
    the Z-field populated (demonstrates the worker pattern)."""
    from checks.types.domain_value_check import DomainValueCheck

    df = pd.DataFrame({
        "MARA.MATNR": ["M1", "M2", "M3", "M4"],
        "MARA.ZZ_REACH_COMPLIANT": ["X", "X", "", "INVALID"],
    })

    rules = discover_ztable_rules()
    rule = next(r for r in rules if r["id"] == "ZT001")

    result = DomainValueCheck(rule).run(df)
    assert result is not None
    # Non-null population: 3 records (M1, M2 with X; M4 with INVALID)
    #   (M3 is blank which DomainValueCheck treats as null per SAP convention)
    # Of those, M4 ('INVALID') is out of domain; M1/M2 pass
    assert result.affected_count == 1
    assert result.total_count == 3  # Excludes the blank M3


def test_ztable_rule_skips_when_zfield_missing():
    """When the extract has no Z-fields (customer doesn't use them),
    the Z-rules skip silently — no false failures."""
    from checks.types.null_check import NullCheck

    df = pd.DataFrame({"MARA.MATNR": ["M1", "M2"]})  # no Z fields
    rules = discover_ztable_rules()
    rule = next(r for r in rules if r["id"] == "ZT003")

    # Rule targets ZPARTNER_EXT.ZPARTNER_ID — not in this df
    result = NullCheck(rule).run(df)
    assert result is None  # skipped, not failed

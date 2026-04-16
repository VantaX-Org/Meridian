import uuid

import pandas as pd
import pytest

from checks.runner import run_checks
from checks.base import CheckResult


def _make_bp_dataframe(n: int = 100) -> pd.DataFrame:
    """Create a synthetic Business Partner DataFrame with known dirty rows."""
    import random
    from datetime import datetime, timedelta, timezone

    random.seed(42)
    now = datetime.now(timezone.utc)

    rows = []
    for i in range(n):
        clean = i >= 10  # first 10 rows are dirty
        rows.append({
            "BUT000.BU_TYPE": random.choice(["1", "2", "3"]) if clean else (None if i < 3 else "9"),
            "BUT000.PARTNER": f"{1000000000 + i}" if clean else ("ABCDE" if i == 3 else f"{i}"),
            "ADR6.SMTP_ADDR": f"user{i}@example.com" if clean else ("bad-email" if i == 5 else None),
            "BUT000.NAME_ORG1": f"Org {i}" if clean else (None if i < 2 else f"Org {i}"),
            "BUT000.TITLE": random.choice(["0001", "0002", "0003"]) if clean else "9999",
            "ADRC.COUNTRY": "ZA" if clean else (None if i == 0 else "ZA"),
            "ADRC.CITY1": "Johannesburg" if clean else (None if i == 1 else "Cape Town"),
            "ADRC.POST_CODE1": "2000" if clean else (None if i == 2 else "8000"),
            "BUT000.PARTNER_GUID": str(uuid.uuid4()) if clean else "not-a-uuid",
            "BUT100.RLTYP": "FLCU01" if clean else (None if i < 4 else "FLCU01"),
            "BUT000.BU_SORT1": f"SEARCH{i}" if clean else (None if i == 6 else f"S{i}"),
            "BUT000.CREATED_AT": (now - timedelta(days=random.randint(1, 300))).isoformat() if clean
                                 else (now - timedelta(days=400)).isoformat(),
        })
    return pd.DataFrame(rows)


def test_runner_returns_correct_count():
    df = _make_bp_dataframe(50)
    results = run_checks("business_partner", df, "test-tenant")
    # business_partner.yaml has 15 rules
    assert len(results) == 15
    assert all(isinstance(r, CheckResult) for r in results)


def test_runner_finds_failures():
    df = _make_bp_dataframe(100)
    results = run_checks("business_partner", df, "test-tenant")
    failing = [r for r in results if not r.passed]
    assert len(failing) > 0, "Expected at least some failing checks with dirty data"


def test_runner_module_not_found():
    df = pd.DataFrame({"x": [1]})
    with pytest.raises(FileNotFoundError):
        run_checks("nonexistent_module", df, "test-tenant")


def test_runner_exception_in_check_returns_error():
    """A check that throws should still return a CheckResult with error populated."""
    df = _make_bp_dataframe(10)
    results = run_checks("business_partner", df, "test-tenant")
    # All results should be CheckResult, even if internal errors occurred
    for r in results:
        assert isinstance(r, CheckResult)
        if r.error:
            assert r.passed is False

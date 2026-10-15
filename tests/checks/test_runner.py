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
            "BUT000.TYPE": random.choice(["1", "2", "3"]) if clean else (None if i < 3 else "9"),
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
            "BUT000.CRDAT": (now - timedelta(days=random.randint(1, 300))).isoformat() if clean
                                 else (now - timedelta(days=400)).isoformat(),
        })
    return pd.DataFrame(rows)


def test_runner_returns_correct_count():
    df = _make_bp_dataframe(50)
    results = run_checks("business_partner", df, "test-tenant")
    # Non-None results = rules whose fields exist in this synthetic extract.
    # 21: BP220 (role vs category), BP226 (organisation name similarity), BP273 (creation date in
    # the future) and BP296 (BUT100.RLTYP is a defined role) find their fields here too.
    assert len(results) == 21
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


def test_wholly_blank_field_is_reported_as_unmaintained_not_as_defects():
    """A presence check on a field no row populates is one systemic gap, not N defects.

    Counting it per row put 12.2M of material_master's 38.2M flagged rows on optional
    fields the system never fills (MVKE.DWERK: blank 200000/200000) and drove those rules'
    scores to 0.00.
    """
    df = _make_bp_dataframe(100)
    df["BUT000.BU_SORT1"] = None  # BP011 (medium, null_check) now has nothing to judge
    stats: dict[str, int] = {}

    results = run_checks("business_partner", df, "test-tenant", stats=stats)

    assert not any(r.check_id == "BP011" for r in results), \
        "a wholly blank field must not be scored as 100 failing records"
    assert stats.get("field_unmaintained", 0) >= 1, "the gap must still be reported"


def test_a_wholly_blank_critical_field_still_counts_as_a_defect():
    """A critical field blank in every record is a catastrophic systemic gap, not an
    unmaintained column: it must keep failing loudly rather than be filed away."""
    df = _make_bp_dataframe(100)
    df["BUT000.TYPE"] = None  # BP003 (critical, null_check); not the frame's key
    stats: dict[str, int] = {}

    results = run_checks("business_partner", df, "test-tenant", stats=stats)

    missing = [r for r in results if r.check_id == "BP003"]
    assert missing, "a critical presence check must not be suppressed"
    assert not missing[0].passed


def test_a_few_populated_rows_do_not_make_an_empty_field_a_defect():
    """The bar is a ratio, not exact equality: a field blank in all but a handful of rows
    is still unmaintained. On material_master MVKE.DWERK is blank in 200000 of a 200000-row
    profile, yet MM038's check still passed 50 of its 5,728,702 rows."""
    df = _make_bp_dataframe(2000)
    df["BUT000.BU_SORT1"] = None
    df.loc[df.index[:1], "BUT000.BU_SORT1"] = "SEARCH"  # one populated row in 2000
    stats: dict[str, int] = {}

    results = run_checks("business_partner", df, "test-tenant", stats=stats)

    assert not any(r.check_id == "BP011" for r in results)
    assert stats.get("field_unmaintained", 0) >= 1


def test_a_mostly_populated_field_is_still_judged_normally():
    """The converse: a field that is genuinely in use keeps producing real defects."""
    df = _make_bp_dataframe(2000)
    df["BUT000.BU_SORT1"] = "SEARCH"          # populate it for everyone
    df.loc[df.index[:300], "BUT000.BU_SORT1"] = None  # 15% missing: a real gap
    stats: dict[str, int] = {}

    results = run_checks("business_partner", df, "test-tenant", stats=stats)

    found = [r for r in results if r.check_id == "BP011"]
    assert found, "a 15%-blank field must still be judged"
    assert found[0].affected_count == 300
    assert stats.get("field_unmaintained", 0) == 0


def test_a_small_population_is_judged_on_its_merits():
    """Over a handful of rows "every value is blank" carries no information.

    Regression: without a floor, a one-record population where the field is blank hit the
    100% bar and was filed as an unmaintained column, silencing a real defect —
    test_field_status_rules' AP022 case (one supplier with no telephone number).
    """
    from checks.runner import _unmaintained

    class _R:
        error = None

        def __init__(self, affected, total):
            self.affected_count, self.total_count = affected, total

    rule = {"check_class": "null_check", "severity": "low"}
    assert _unmaintained(rule, _R(1, 1)) is False, "one blank record is a defect"
    assert _unmaintained(rule, _R(2, 2)) is False
    assert _unmaintained(rule, _R(49, 49)) is False, "below the floor"
    assert _unmaintained(rule, _R(50, 50)) is True, "at the floor"
    assert _unmaintained(rule, _R(5728652, 5728702)) is True, "the real material_master case"

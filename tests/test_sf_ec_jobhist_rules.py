"""Employee Central job-history date and shift rules (EC904-EC906): one record must fail, one must pass."""
import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

RULES = {r["id"]: r for r in yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]}
K = {"USERID": ["u1", "u2"], "START_DATE": ["2026-01-01"] * 2}
FIXTURES = {
    "EC904": dict(HIRE_DATE=["2026-01-01"] * 2, PROBATION_END_DATE=["2025-07-01", "2026-07-01"]),
    "EC905": dict(HIRE_DATE=["2026-01-01"] * 2, TERMINATION_DATE=["2025-12-31", "2026-12-31"]),
    "EC906": dict(IS_SHIFT_EMPLOYEE=["true", "true"], SHIFT_CODE=["", "NIGHT"]),
}


@pytest.mark.parametrize("rid", sorted(FIXTURES))
def test_fixture_fails_bad_and_passes_good(rid):
    df = pd.DataFrame({f"EMPJOBHIST.{k}": v for k, v in {**K, **FIXTURES[rid]}.items()})
    frames = TableFrames({"EMPJOBHIST": df}, get_dictionary("s4hana"), module="employee_central")
    _, res = run_rule(dict(RULES[rid]), frames, {})
    assert res is not None and not res.error, res and res.error
    assert res.affected_count == 1

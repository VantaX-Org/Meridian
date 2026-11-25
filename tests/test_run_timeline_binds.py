"""Every caller of run_timeline._RUNS_SQL must bind every parameter the SQL names; a missing one is a 500."""
import re
from pathlib import Path

from api.routes import run_timeline


def test_runs_sql_callers_bind_every_parameter() -> None:
    names = set(re.findall(r"(?<!:):([a-z_]+)\b", run_timeline._RUNS_SQL))
    src = Path(run_timeline.__file__).read_text()
    calls = re.findall(r"text\(_RUNS_SQL\),\s*(\{[^}]*\})", src)
    assert calls, "no _RUNS_SQL callers found"
    for call in calls:
        bound = set(re.findall(r'"([a-z_]+)":', call))
        assert names <= bound, f"missing binds {names - bound} in {call}"

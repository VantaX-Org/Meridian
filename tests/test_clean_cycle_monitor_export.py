"""Monitor skip and since-previous alerts; load-ordered export and the S/4 layout note (synthetic data only)."""
import io
import zipfile
from datetime import datetime
from types import SimpleNamespace as NS

import pandas as pd
from openpyxl import load_workbook

from api.services import monitor
from api.services.migration import export


class _R(list):
    def fetchone(self):
        return self[0] if self else None

    def fetchall(self):
        return list(self)

    def scalar(self):
        return self[0][0] if self else None


class _Session:
    """Answers each statement by the first marker it contains; everything else returns no rows."""

    def __init__(self, routes):
        self.routes, self.sql = routes, []

    def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append(q)
        return _R(next((rows for marker, rows in self.routes if marker in q), []))


def test_check_takes_skipped_issues_off_the_regression():
    diff = [NS(check_id="C1", module="m", severity="high", new=2, ran_v1=True, ran_v2=True, truncated=False, resolved=0)]
    s = _Session([("WHERE version_id = :v1", diff), ("metadata->>'baseline'", [("b", datetime(2026, 1, 1))]),
                  ("count(*) AS n", [NS(check_id="C1", n=2)])])
    out = monitor.check(s, "t", "v", "sys", skip=["i1", "i2"])
    assert (out["new_records"], out["regressed_check_count"], out["fix_not_in_source"]) == (0, 0, 2)
    assert not any("remediation_items" in q for q in s.sql)  # nothing left to draft


def test_check_without_a_pinned_baseline_returns_none():
    assert monitor.check(_Session([]), "t", "v", "sys") is None


def test_notify_since_previous(monkeypatch):
    from api.services import notifications

    sent: list[dict] = []
    monkeypatch.setattr(notifications, "create_notification_sync", lambda **k: sent.append(k))
    assert monitor.notify_since_previous(_Session([]), "t", "v", "sys") == {} and not sent
    s = _Session([("first_seen_version", [NS(module="material_master", new=3, reopened=1)])])
    assert monitor.notify_since_previous(s, "t", "v", "sys") == {"material_master": {"new": 3, "reopened": 1}}
    assert sent[0]["title"] == "3 new and 1 reopened issue(s) since the previous run" and sent[0]["type"] == "monitor"


def test_layout_note_only_on_the_s4_field_list_layout():
    s4 = {"Field List": pd.DataFrame({"a": [1]}), "Data": pd.DataFrame()}
    assert list(export.with_layout_note(s4)) == ["Read me", "Field List", "Data"]
    sf = {"Job": pd.DataFrame()}
    assert export.with_layout_note(sf) is sf


def test_keep_order_in_xlsx_and_csv():
    tables = {"ZZ": pd.DataFrame({"x": [1]}), "AA": pd.DataFrame({"y": [2]})}
    assert zipfile.ZipFile(io.BytesIO(export.to_csv_zip(tables, keep_order=True))).namelist() == ["01_ZZ.csv", "02_AA.csv"]
    assert sorted(zipfile.ZipFile(io.BytesIO(export.to_csv_zip(tables))).namelist()) == ["AA.csv", "ZZ.csv"]
    assert load_workbook(io.BytesIO(export.to_xlsx(tables, keep_order=True))).sheetnames[:2] == ["ZZ", "AA"]

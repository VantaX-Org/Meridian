"""interface_health: IDoc rules on synthetic EDIDC data, plus the EDIDC/EDIDS extraction window."""

from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest
import yaml

from checks.runner import _find_module_yaml, run_checks
from sap.ddic import get_dictionary
from sap.extraction_plan import plan_modules, render_where
from sap.extraction_registry import ECC_EXTRACTIONS

NOW = datetime.now(timezone.utc).replace(tzinfo=None)
HOUR, DAY = timedelta(hours=1), timedelta(days=1)

# (DIRECT, STATUS, MESTYP, created/last-changed age, SNDPRN, SNDPRT, RCVPRN, RCVPRT)
DIRTY = [
    ("2", "51", "ORDERS", 30 * DAY, "SND01", "LS", "OWN", "LS"),   # IDH001 fail
    ("2", "56", "INVOIC", 2 * DAY, "SND01", "LS", "OWN", "LS"),    # IDH001 in scope, recent
    ("2", "53", "ORDERS", 30 * DAY, "SND01", "LS", "OWN", "LS"),   # posted: no error rule
    ("1", "02", "ORDERS", 30 * DAY, "OWN", "LS", "RCV01", "LS"),   # IDH002 fail
    ("1", "26", "DESADV", 30 * DAY, "OWN", "LS", "RCV01", "LS"),   # IDH002 fail
    ("1", "29", "INVOIC", 1 * DAY, "OWN", "LS", "RCV01", "LS"),    # IDH002 in scope, recent
    ("2", "51", "MATMAS", 3 * DAY, "SND01", "LS", "OWN", "LS"),    # IDH003 fail (not IDH001)
    ("1", "02", "DEBMAS", 1 * HOUR, "OWN", "LS", "RCV01", "LS"),   # IDH003 in scope, recent
    ("2", "64", "ORDERS", 3 * DAY, "SND01", "LS", "OWN", "LS"),    # IDH004 fail
    ("1", "30", "ORDERS", 1 * HOUR, "OWN", "LS", "RCV01", "LS"),   # IDH004 in scope, recent
    ("2", "53", "ORDERS", 1 * HOUR, "", "", "OWN", "LS"),          # IDH005 + IDH006 fail
    ("1", "03", "ORDERS", 1 * HOUR, "OWN", "LS", "", "LS"),        # IDH007 fail
]

# rule → (affected, total)
EXPECTED_DIRTY = {
    "IDH001": (1, 2), "IDH002": (2, 3), "IDH003": (1, 2), "IDH004": (1, 2),
    "IDH005": (1, 6), "IDH006": (1, 6), "IDH007": (1, 6), "IDH008": (0, 6),
}


def _frame(rows) -> pd.DataFrame:
    out = []
    for i, (direct, status, mestyp, age, sndprn, sndprt, rcvprn, rcvprt) in enumerate(rows):
        ts = NOW - age
        out.append({
            "EDIDC.DOCNUM": f"{i + 1:016d}", "EDIDC.DIRECT": direct, "EDIDC.STATUS": status,
            "EDIDC.MESTYP": mestyp, "EDIDC.IDOCTP": mestyp + "01",
            "EDIDC.CREDAT": ts.strftime("%Y%m%d"), "EDIDC.CRETIM": ts.strftime("%H%M%S"),
            "EDIDC.UPDDAT": ts.strftime("%Y%m%d"), "EDIDC.UPDTIM": ts.strftime("%H%M%S"),
            "EDIDC.SNDPRN": sndprn, "EDIDC.SNDPRT": sndprt, "EDIDC.RCVPRN": rcvprn, "EDIDC.RCVPRT": rcvprt,
        })
    return pd.DataFrame(out)


def _counts(df: pd.DataFrame) -> dict:
    return {r.check_id: (r.affected_count, r.total_count)
            for r in run_checks("interface_health", df, "t1") if r.check_id.startswith("IDH")}


def test_dirty_counts():
    assert _counts(_frame(DIRTY)) == EXPECTED_DIRTY


def test_clean_counts():
    clean = [(d, s, m, HOUR, sp or "SND01", st or "LS", rp or "RCV01", rt or "LS")
             for d, s, m, _, sp, st, rp, rt in DIRTY]
    assert _counts(_frame(clean)) == {k: (0, total) for k, (_, total) in EXPECTED_DIRTY.items()}


def test_time_field_gives_hour_precision():
    # created 23h ago: day-only parsing would read yesterday 00:00 and fail the 24h rule
    ts = NOW - 23 * HOUR
    df = _frame([("2", "64", "ORDERS", 23 * HOUR, "S", "LS", "O", "LS")])
    if ts.date() == NOW.date():
        pytest.skip("needs the 23h-old timestamp on the previous calendar day")
    assert _counts(df)["IDH004"] == (0, 1)


def test_rules_carry_enrichment():
    rules = yaml.safe_load(_find_module_yaml("interface_health").read_text())["rules"]
    assert len(rules) == 8
    for r in rules:
        for key in ("fix_map", "rule_authority", "why_it_matters", "sap_impact", "record_fix_template"):
            assert r.get(key), (r["id"], key)


def test_days_ago_placeholder():
    assert render_where("CREDAT >= '{days_ago:90}'", date(2026, 3, 31)) == "CREDAT >= '20251231'"


def test_plan_windows_edidc_and_never_reads_it_in_full():
    plans = plan_modules(["interface_health"], get_dictionary("ecc6"))
    p = plans["EDIDC"]
    cutoff = (date.today() - timedelta(days=90)).strftime("%Y%m%d")
    assert p.where == f"CREDAT >= '{cutoff}'" and p.partial
    assert {"DOCNUM", "STATUS", "DIRECT", "MESTYP", "CREDAT", "CRETIM", "UPDDAT", "UPDTIM",
            "SNDPRN", "SNDPRT", "RCVPRN", "RCVPRT"} <= p.fields
    # a download's date range replaces the default window on the same field
    scoped = plan_modules(["interface_health"], get_dictionary("ecc6"),
                          {"date_from": "2026-01-01", "date_to": "2026-01-31"})["EDIDC"]
    assert scoped.where == "CREDAT >= '20260101' AND CREDAT <= '20260131'"


def test_registry_targets_are_windowed():
    targets = {t.source: t for t in ECC_EXTRACTIONS["interface_health"]}
    assert set(targets) == {"EDIDC", "EDIDS", "TRFCQOUT", "TRFCQIN", "ARFCSSTATE"}
    D = get_dictionary("ecc6")
    for t in targets.values():
        assert t.filter and t.max_rows, t.source
        assert all(D.field(t.source, f) is not None for f in t.fields), t.source

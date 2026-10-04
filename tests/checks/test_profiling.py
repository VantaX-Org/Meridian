"""Field profiling + dependency discovery (checks/profiling.py)."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.profiling import (
    discover_dependencies,
    is_sensitive,
    profile_frames,
    profile_module,
    shape_of,
)
from sap.ddic import get_dictionary


@pytest.fixture(scope="module")
def ddic():
    return get_dictionary("ecc6")


def _by_field(records):
    return {r["field"]: r["stats"] for r in records}


def _materials(n=1000, violators=5):
    """MTART → MBRSH for all but ``violators`` materials (the first ones)."""
    types = np.array(["FERT", "HALB", "ROH", "HAWA"])[np.arange(n) % 4]
    sector = np.array([{"FERT": "M", "HALB": "M", "ROH": "C", "HAWA": "A"}[t] for t in types])
    sector[:violators] = "X"
    return pd.DataFrame({
        "MARA.MATNR": [f"{i:018d}" for i in range(n)],
        "MARA.MTART": types,
        "MARA.MBRSH": sector,
    })


# ── stats ────────────────────────────────────────────────────────────────────


def test_counts_lengths_numbers_and_dates(ddic):
    df = pd.DataFrame({
        "MARA.MATNR": ["000000000000000001", "000000000000000002", "000000000000000003", "000000000000000004"],
        "MARA.MANDT": ["100"] * 4,
        "MARA.MTART": ["FERT", "  ", None, "ROH"],
        "MARA.BRGEW": ["1,234.50", "12.5-", "abc", ""],
        "MARA.ERSDA": ["20240131", "00000000", "2023-06-01", "20249999"],
    })
    stats = _by_field(profile_frames(TableFrames({"MARA": df}, ddic), ddic, ["MARA"]))
    assert "MANDT" not in stats  # client field is not profiled

    mtart = stats["MTART"]
    assert (mtart["rows"], mtart["blank"], mtart["blank_pct"], mtart["distinct"]) == (4, 2, 50.0, 2)
    assert (mtart["min_length"], mtart["max_length"]) == (3, 4)
    assert mtart["sampled"] is False and mtart["ddic_type"] == "CHAR" and mtart["ddic_length"] == 4

    brgew = stats["BRGEW"]  # QUAN: SAP trailing minus + thousands separator
    assert brgew["numeric"] == {"min": -12.5, "max": 1234.5, "mean": 611.0, "non_numeric": 1}
    assert brgew["blank"] == 1

    ersda = stats["ERSDA"]  # DATS: '00000000' is blank, '20249999' is not a date
    assert ersda["blank"] == 1
    assert ersda["dates"] == {"min": "2023-06-01", "max": "2024-01-31", "invalid": 1}
    assert "numeric" not in stats["MTART"] and "dates" not in stats["BRGEW"]


def test_shapes():
    assert shape_of("ZA-1234 b") == "AA-9999 A"
    assert shape_of("DE89370400440532013000") == "AA99999999999999999999"[:20]
    assert len(shape_of("X" * 50)) == 20
    assert shape_of("Ärger_1") == "AAAAA_9"  # unicode letters are letters; '_' is kept


def test_top_shapes_and_values(ddic):
    df = pd.DataFrame({"MARA.MATNR": [f"{i:018d}" for i in range(10)],
                       "MARA.MTART": ["FERT"] * 6 + ["ROH"] * 3 + ["Z1"]})
    s = _by_field(profile_frames(TableFrames({"MARA": df}, ddic), ddic, ["MARA"]))["MTART"]
    assert s["shapes"] == [{"shape": "AAAA", "count": 6, "share": 0.6}, {"shape": "AAA", "count": 3, "share": 0.3},
                           {"shape": "A9", "count": 1, "share": 0.1}]
    assert s["masked"] is False
    assert s["top_values"] == [{"value": "FERT", "count": 6}, {"value": "ROH", "count": 3}, {"value": "Z1", "count": 1}]


def test_top_shapes_capped_at_five(ddic):
    vals = ["A", "AA", "AAA", "AAAA", "AAAAA", "AAAAAA", "9"]
    df = pd.DataFrame({"MARA.MATNR": [f"{i:018d}" for i in range(len(vals))], "MARA.MTART": vals})
    s = _by_field(profile_frames(TableFrames({"MARA": df}, ddic), ddic, ["MARA"]))["MTART"]
    assert len(s["shapes"]) == 5 and s["shape_count"] == 7


# ── masking ──────────────────────────────────────────────────────────────────


def test_hr_table_and_name_fields_never_get_top_values(ddic):
    pa = pd.DataFrame({"PA0002.PERNR": [f"{i:08d}" for i in range(1, 21)],
                       "PA0002.GESCH": ["1", "2"] * 10,          # code-like, but HR → masked
                       "PA0002.NACHN": ["Smith", "Jones"] * 10})
    lfa1 = pd.DataFrame({"LFA1.LIFNR": [f"{i:010d}" for i in range(20)],
                         "LFA1.NAME1": ["Acme", "Bolt"] * 10,      # few distinct, still a name
                         "LFA1.LAND1": ["ZA", "DE"] * 10})
    frames = TableFrames({"PA0002": pa, "LFA1": lfa1}, ddic)
    recs = profile_frames(frames, ddic, ["PA0002", "LFA1"])
    for r in recs:
        if r["table"] == "PA0002" or r["field"] == "NAME1":
            assert r["stats"]["top_values"] is None and r["stats"]["masked"] is True, r
            assert r["stats"]["mask_reason"] == "privacy"
            assert r["stats"]["shapes"], "masked fields keep their shapes"
            assert r["stats"]["distinct"] == (20 if r["field"] == "PERNR" else 2)
    lfa = _by_field([r for r in recs if r["table"] == "LFA1"])
    assert lfa["LAND1"]["top_values"] == [{"value": "DE", "count": 10}, {"value": "ZA", "count": 10}]
    # raw values of masked fields appear nowhere in the stored record
    blob = json.dumps(recs)
    assert "Acme" not in blob and "Smith" not in blob


def test_code_like_requires_few_values_and_short_ddic_length(ddic):
    df = pd.DataFrame({"MARA.MATNR": [f"{i:018d}" for i in range(60)],
                       "MARA.MTART": [f"T{i:02d}" for i in range(60)],   # 60 distinct > 50
                       "MARA.MATKL": ["001"] * 60,                       # length 9 → code-like
                       "MARA.ZZFREE": ["x"] * 60})                       # not in DDIC → no length
    s = _by_field(profile_frames(TableFrames({"MARA": df}, ddic), ddic, ["MARA"]))
    assert s["MTART"]["top_values"] is None and s["MTART"]["mask_reason"] == "not_code_like"
    assert s["MATNR"]["top_values"] is None  # DDIC length 18
    assert s["MATKL"]["top_values"] == [{"value": "001", "count": 60}]
    assert s["ZZFREE"]["top_values"] is None


@pytest.mark.parametrize("table,field,element", [
    ("PA0001", "BUKRS", None), ("HRPY_RGDIR", "ABKRS", None), ("ZMERIDIAN_X", "A", None),
    ("PERINFO", "X", None), ("PERPHONE", "X", None), ("PEREMAIL", "X", None), ("PERADDRESS", "X", None),
    ("EMPEMPLOYMENT", "X", None),
    ("LFA1", "NAME1", None), ("LFA1", "NAME_CO", None), ("LFA1", "STRAS", None), ("ADRC", "STREET", None),
    ("LFA1", "ORT01", None), ("ADRC", "CITY1", None), ("LFA1", "PSTLZ", None), ("ADRC", "POST_CODE1", None),
    ("LFA1", "TELF1", None), ("ADR6", "SMTP_ADDR", None), ("LFBK", "BANKN", None), ("TIBAN", "IBAN", None),
    ("KNA1", "STCD1", None), ("KNA1", "STCEG", None), ("PA0002", "PERID", None), ("PA0185", "ICNUM", None),
    ("PA0105", "USRID_LONG", None),
    ("LFA1", "ZZCONTACT", "AD_SMTPADR"), ("LFA1", "ZZSTREET2", "STRAS_GP"), ("BUT000", "ZZN", "BU_NAMEOR1"),
])
def test_sensitive(table, field, element):
    assert is_sensitive(table, field, element)


@pytest.mark.parametrize("table,field", [("MARA", "MTART"), ("LFA1", "LAND1"), ("LFB1", "BUKRS"),
                                         ("KNA1", "KTOKD"), ("EKKO", "BSART")])
def test_not_sensitive(table, field, ddic):
    f = ddic.field(table, field)
    assert not is_sensitive(table, field, f.data_element if f else None)


# ── sampling ─────────────────────────────────────────────────────────────────


def test_sampling_is_bounded_and_recorded(ddic):
    df = _materials(300)
    recs = profile_frames(TableFrames({"MARA": df}, ddic), ddic, ["MARA"], max_rows=100)
    s = _by_field(recs)["MTART"]
    assert s["rows"] == 100 and s["table_rows"] == 300 and s["sampled"] is True
    assert recs == profile_frames(TableFrames({"MARA": df}, ddic), ddic, ["MARA"], max_rows=100)


# ── dependency discovery ─────────────────────────────────────────────────────


def test_finds_99_percent_dependency_with_violators():
    df = _materials(1000, violators=5)
    deps = discover_dependencies(df, list(df.columns), key_cols=["MARA.MATNR"])
    assert len(deps) == 1
    d = deps[0]
    assert (d["determinant"], d["dependent"]) == ("MARA.MTART", "MARA.MBRSH")
    assert d["support"] == 0.995 and d["violations"] == 5 and d["rows"] == 1000
    assert d["sample_keys"] == [f"MATNR={i:018d}" for i in range(5)]


def test_ignores_exact_and_weak_dependencies():
    exact = _materials(1000, violators=0)      # 100 % → a rule the system enforces, not a hidden one
    assert discover_dependencies(exact, list(exact.columns)) == []
    weak = _materials(1000, violators=20)      # 98 % < 99 %
    assert discover_dependencies(weak, list(weak.columns)) == []


def test_min_rows_and_blank_determinants():
    small = _materials(40, violators=0)
    assert discover_dependencies(small, list(small.columns)) == []
    df = _materials(1000, violators=5)
    df.loc[df.index[-500:], "MARA.MTART"] = ""   # only populated determinant rows count
    d = discover_dependencies(df, list(df.columns))[0]
    assert d["rows"] == 500 and d["violations"] == 5 and d["sample_keys"][0] == "row:0"


def test_candidate_caps():
    n = 1000
    rng = np.random.default_rng(7)
    df = _materials(n, violators=5)
    df["MARA.HIGH"] = [f"V{i % 250}" for i in range(n)]       # 250 distinct > 200
    df["MARA.CONST"] = "1"                                     # 1 distinct < 2
    assert {(d["determinant"], d["dependent"]) for d in discover_dependencies(df, list(df.columns))} == {
        ("MARA.MTART", "MARA.MBRSH")}
    # ≤ 20 % of rows: 50 rows, 12 distinct values → not a candidate
    few = _materials(50, violators=1)
    few["MARA.MTART"] = [f"T{i % 12}" for i in range(50)]
    assert all(d["determinant"] != "MARA.MTART" for d in discover_dependencies(few, list(few.columns), min_support=0.9))
    # at most max_candidates columns are considered (first in order)
    noise = pd.DataFrame({f"T.C{i}": rng.integers(0, 3, n).astype(str) for i in range(3)})
    wide = pd.concat([noise, df[["MARA.MTART", "MARA.MBRSH"]]], axis=1)
    assert discover_dependencies(wide, list(wide.columns), max_candidates=3) == []
    assert len(discover_dependencies(wide, list(wide.columns), max_candidates=5)) == 1


def test_near_constant_dependent_is_not_reported():
    n = 1000
    df = pd.DataFrame({"T.A": [f"A{i % 10}" for i in range(n)], "T.B": ["x"] * (n - 5) + ["y"] * 5})
    assert discover_dependencies(df, ["T.A", "T.B"]) == []


def test_profile_module_is_deterministic(ddic):
    df = _materials(1000, violators=5)
    shuffled_cols = df[["MARA.MBRSH", "MARA.MATNR", "MARA.MTART"]]
    a = profile_module(TableFrames({"MARA": df}, ddic), ddic, ["MARA"])
    b = profile_module(TableFrames({"MARA": df.copy()}, ddic), ddic, ["MARA"])
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    _, deps = profile_module(TableFrames({"MARA": shuffled_cols}, ddic), ddic, ["MARA"])
    assert [(d["table"], d["determinant"], d["dependent"], d["violations"]) for d in deps] == [
        ("MARA", "MARA.MTART", "MARA.MBRSH", 5)]
    assert deps[0]["sample_keys"][0] == "MATNR=000000000000000000"  # DDIC key of MARA


def test_flat_upload_unsplittable_table(ddic):
    flat = pd.DataFrame({"LFA1.LAND1": ["ZA", "DE", "ZA"], "LFA1.NAME1": ["a", "b", "c"]})  # no LIFNR key
    frames = TableFrames.from_flat(flat, ddic)
    assert "LFA1" in frames.unsplittable
    s = _by_field(profile_frames(frames, ddic, ["LFA1"]))
    assert s["LAND1"]["distinct"] == 2 and s["NAME1"]["top_values"] is None


def test_only_code_fields_are_mined(ddic):
    """The creator (ERNAM) tracks the material type in the data, but is no rule."""
    df = _materials(1000, violators=5)
    df["MARA.ERNAM"] = np.where(df["MARA.MTART"] == "ROH", "BUYER1", "PLANNER1")
    df.loc[500:504, "MARA.ERNAM"] = "TEMP1"  # imperfect, so MTART → ERNAM would be a candidate
    _, deps = profile_module(TableFrames({"MARA": df}, ddic), ddic, ["MARA"])
    assert {d["determinant"] for d in deps} == {"MARA.MTART"}
    assert all(d["dependent"] != "MARA.ERNAM" for d in deps)

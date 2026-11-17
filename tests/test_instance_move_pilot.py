"""Pilot sample, excluded countries and target-config compare for the instance move (synthetic, no SF or DB)."""
import pandas as pd
import pytest

from api.routes import instance_move as route
from api.services.migration import instance_move as im
from checks.frames import TableFrames
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def _job(rows):
    cols = ["USERID", "START_DATE", "SEQ_NUMBER", "PAY_GRADE", "COUNTRY_OF_COMPANY", "STATUS", "MANAGER_ID"]
    return pd.DataFrame([dict(zip([f"EMPJOBHIST.{c}" for c in cols], r)) for r in rows])


def _frames(job_rows, rel_rows=()):
    rel = pd.DataFrame([{"EMPJOBRELATIONSHIPS.USERID": u, "EMPJOBRELATIONSHIPS.RELATIONSHIP_TYPE": "HR",
                         "EMPJOBRELATIONSHIPS.START_DATE": "2020-01-01", "EMPJOBRELATIONSHIPS.RELATED_USER_ID": m}
                        for u, m in rel_rows], columns=["EMPJOBRELATIONSHIPS.USERID",
                                                         "EMPJOBRELATIONSHIPS.RELATIONSHIP_TYPE",
                                                         "EMPJOBRELATIONSHIPS.START_DATE",
                                                         "EMPJOBRELATIONSHIPS.RELATED_USER_ID"])
    co = pd.DataFrame({"FOCOMPANY.EXTERNAL_CODE": ["KZA", "KNA"], "FOCOMPANY.COUNTRY": ["ZAF", "NAM"]})
    return TableFrames({"EMPJOBHIST": _job(job_rows), "EMPJOBRELATIONSHIPS": rel, "FOCOMPANY": co})


def test_band_edges():
    assert [im.band(g) for g in ("AA", "A1", "b2", "F", "G", "H3", "APPR_1", "APPR_X", "No Grade", "", None,
                                 float("nan"), "Z9")] == \
        ["A", "A", "B", "F", "G", "H", "APPR", "APPR", "No Grade", "UNGRADED", "UNGRADED", "UNGRADED", "Z9"]


def test_person_keyed_classification_over_the_sf_tables():
    sf = [n for n in D.tables if n.startswith(("EMP", "PER", "FO"))]
    f = TableFrames({n: pd.DataFrame({f"{n}.{k}": [] for k in D.keys(n)}) for n in sf})
    keyed = sorted(n for n in sf if im.person_column(n, f, D))
    assert keyed == sorted(n for n in sf if n.startswith(("EMP", "PER")))
    assert not any(n.startswith("FO") for n in keyed)  # foundation loads in full
    raw = TableFrames({"SFRAW_PerPersonal": pd.DataFrame({"SFRAW_PerPersonal.personIdExternal": ["p1"],
                                                          "__raw_key__": ["personIdExternal=p1|startDate=x"]}),
                       "SFRAW_FOJobCode": pd.DataFrame({"SFRAW_FOJobCode.externalCode": ["J1"],
                                                        "__raw_key__": ["externalCode=J1|startDate=x"]})})
    assert im.person_column("SFRAW_PerPersonal", raw, D) == "SFRAW_PerPersonal.personIdExternal"
    assert im.person_column("SFRAW_FOJobCode", raw, D) is None


def _population():
    rows = []
    for i in range(15):  # one ZAF/A/active cell of 15, latest grade from history when the newest row is blank
        u = f"Z{i:02d}"
        rows += [(u, "2020-01-01", 1, "AA", "ZAF", "A", "M1"), (u, "2022-01-01", 1, None, "ZAF", "A", "M1")]
    rows += [("T1", "2021-01-01", 1, "C2", "NAM", "T", "M1"),
             ("M1", "2019-01-01", 1, "G", "ZAF", "A", "M2"), ("M2", "2019-01-01", 1, "H", "ZAF", "A", "M3"),
             ("M3", "2019-01-01", 1, "H", "ZAF", "A", None),
             ("Y1", "2019-01-01", 1, "B", "ZMB", "A", None), ("Y2", "2019-01-01", 1, "B", "ZMB", "A", "M1"),
             ("U1", "2019-01-01", 1, None, "BWA", "A", "Y1")]
    return rows


def test_sample_is_stratified_deterministic_and_closes_over_managers():
    f = _frames(_population(), rel_rows=[("Z00", "M3")])
    s = im.move_scope(f, D, {"per_cell": 10})
    assert s == im.move_scope(f, D, {"per_cell": 10})
    assert s["cells"]["ZAF|A|active"] == 10
    assert s["cells"]["NAM|C|terminated/other"] == 1 and s["cells"]["BWA|UNGRADED|active"] == 1
    assert not any(c.startswith("ZMB") for c in s["cells"])
    assert [u for u in s["keep"] if u.startswith("Z")] == [f"Z{i:02d}" for i in range(10)]
    # M1/M2/M3 are cells of their own already; closure adds nothing new there
    assert set(s["keep"]) >= {"M1", "M2", "M3", "T1", "U1"} and "Y1" not in s["keep"]
    one = im.move_scope(f, D, {"per_cell": 1})
    assert "Z00" in one["keep"] and "Z05" not in one["keep"]
    assert set(one["closure_added"]) <= {"M1", "M2", "M3"}


def test_closure_cap_and_transitive_chain():
    rows = [("A1", "2020-01-01", 1, "A", "ZAF", "A", "B1"), ("B1", "2020-01-01", 1, "A", "ZAF", "A", "C1"),
            ("C1", "2020-01-01", 1, "A", "ZAF", "A", "D1"), ("D1", "2020-01-01", 1, "A", "ZAF", "A", None)]
    f = _frames(rows)
    assert im.move_scope(f, D, {"per_cell": 1})["closure_added"] == ["B1", "C1", "D1"]
    assert im.move_scope(f, D, {"per_cell": 1, "closure_cap": 2})["closure_added"] == ["B1", "C1"]


def test_apply_keeps_history_blanks_outside_managers_and_keeps_foundation():
    rows = [("A1", "2020-01-01", 1, "A", "ZAF", "A", "B1"), ("A1", "2021-01-01", 1, "A", "ZAF", "A", "B1"),
            ("B1", "2020-01-01", 1, "A", "ZAF", "A", "C1"), ("C1", "2020-01-01", 1, "A", "ZAF", "A", None)]
    f = _frames(rows)
    s = im.move_scope(f, D, {"per_cell": 1, "closure_cap": 1})
    assert s["keep"] == ["A1", "B1"]
    out, rep = im.apply_scope(f, D, s)
    job = out.frames["EMPJOBHIST"]
    assert sorted(job["EMPJOBHIST.USERID"]) == ["A1", "A1", "B1"]  # every history row of A1
    assert len(out.frames["FOCOMPANY"]) == 2
    assert job.loc[job["EMPJOBHIST.USERID"] == "B1", "EMPJOBHIST.MANAGER_ID"].isna().all()
    assert rep["blanked"] == 1 and rep["needs_review"][0]["reason"] == im.OUT_OF_SAMPLE
    assert rep["needs_review"][0]["field"] == "MANAGER_ID" and rep["needs_review"][0]["value"] == "C1"
    assert len(f.frames["EMPJOBHIST"]) == 4  # input untouched


def test_zmb_is_excluded_at_selection_with_one_count_line_and_no_review():
    f = _frames(_population())
    s = im.move_scope(f, D)  # full move, default exclusion
    assert s["excluded_lines"] == ["ZMB excluded (out of scope): 2 users"] and s["keep"] is None
    out, rep = im.apply_scope(f, D, s)
    assert not out.frames["EMPJOBHIST"]["EMPJOBHIST.USERID"].isin(["Y1", "Y2"]).any()
    assert not any(r["record_key"].startswith(("Y1", "Y2")) for r in rep["needs_review"])
    assert {r["reason"] for r in rep["needs_review"]} == {im.OUT_OF_SCOPE}  # U1 pointed at Y1
    assert rep["users"] == len(s["known"]) - 2
    p = im.move_scope(f, D, {"per_cell": 10})
    assert "Y1" not in p["keep"] and "Y2" not in p["keep"] and p["excluded"] == {"ZMB": 2}


def test_no_sample_and_no_exclusion_changes_nothing():
    f = _frames(_population())
    out, rep = im.apply_scope(f, D, im.move_scope(f, D, None, exclude_countries=[]))
    assert out is f and rep["needs_review"] == [] and rep["excluded_lines"] == []


def test_plan_body_defaults_full_move_with_zmb_excluded():
    b = route.PlanBody(source_system_id="00000000-0000-0000-0000-000000000001",
                       target_system_id="00000000-0000-0000-0000-000000000002", modules=["employee_central"])
    assert b.sample is None and b.exclude_countries == ["ZMB"]
    b = route.PlanBody(source_system_id="00000000-0000-0000-0000-000000000001",
                       target_system_id="00000000-0000-0000-0000-000000000002", modules=["employee_central"],
                       sample={"per_cell": 5})
    assert b.sample.per_cell == 5 and b.sample.closure_cap == im.PILOT_CLOSURE_CAP
    with pytest.raises(ValueError):
        route.PlanBody(source_system_id="00000000-0000-0000-0000-000000000001",
                       target_system_id="00000000-0000-0000-0000-000000000002", modules=["x"], sample={"per_cell": 0})


def test_config_diff_against_a_fake_target_maps_creates_and_flags_conflicts():
    src = {"FOCompany": [{"externalCode": "KZA", "name": "Komatsu ZA"}, {"externalCode": "KNA", "name": "NA"},
                         {"externalCode": "KBW", "name": "BW"}]}
    tgt = {"FOCompany": [{"externalCode": "KZA", "name": "Komatsu ZA"}, {"externalCode": "KNA", "name": "Other"}]}
    d = im.config_diff(src, tgt)["FOCompany"]
    assert d["mapped"] == [{"externalCode": "KZA"}]
    assert [r["externalCode"] for r in d["create_values"]] == ["KBW"]
    assert d["conflict"] == 1 and d["conflicts"][0]["key"] == {"externalCode": "KNA"}

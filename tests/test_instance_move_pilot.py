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


# ── closure reporting and the DECISIONS.md defaults ─────────────────────────


def test_closure_reports_cut_excluded_and_not_found_refs():
    rows = [("A1", "2020-01-01", 1, "AA", "ZAF", "A", "B1"), ("A1", "2021-01-01", 1, "AA", "ZAF", "A", "GONE"),
            ("B1", "2019-01-01", 1, "G", "ZAF", "T", "C1"), ("C1", "2019-01-01", 1, "H", "NAM", "A", "NO_MANAGER"),
            ("Y1", "2019-01-01", 1, "B", "ZMB", "A", None)]
    f = _frames(rows, rel_rows=[("A1", "Y1")])
    sc = im.move_scope(f, D, {"per_cell": 1, "closure_cap": 1})
    assert sc["keep"] == ["A1", "B1", "C1"] or "C1" in sc["cut_by_cap"]
    assert sc["refs_not_found"] == ["GONE"] and sc["refs_to_excluded"] == ["Y1"]
    assert "NO_MANAGER" not in sc["keep"] + sc["cut_by_cap"] + sc["refs_not_found"]
    # the sample already holds A1, B1 (terminated cell) and C1; with every cell sampled nothing is cut
    sc = im.move_scope(f, D, {"per_cell": 10, "closure_cap": 0})
    assert sc["cut_by_cap"] == [] and sc["by_country"] == {"NAM": 1, "ZAF": 2}


def _people_frames(extra: dict):
    job = _job([("A1", "2020-01-01", 1, "AA", "ZAF", "A", "T1"), ("T1", "2019-01-01", 1, "G", "ZAF", "T", "NO_MANAGER"),
                ("A2", "2020-01-01", 1, "AA", "ZAF", "A", "NO_MANAGER"), ("A3", "2020-01-01", 1, "AA", "ZAF", "A", "X9"),
                ("R1", "2020-01-01", 1, "AA", "ZAF", "RNS", "A1")])
    emp = pd.DataFrame({"EMPEMPLOYMENT.USERID": ["A1", "T1", "A2", "A3", "R1"],
                        "EMPEMPLOYMENT.PERSON_ID": ["A1", "T1", "A2", "A3", "R1"],
                        "EMPEMPLOYMENT.PAY_SCALE_TYPE": ["ZAF/01", "ZAF/01", "ZAF/09", None, None],
                        "EMPEMPLOYMENT.PAY_SCALE_LEVEL": ["No Level", None, None, None, None]})
    user = pd.DataFrame({"USERACCOUNT.USER_ID": ["A1", "A2", "A3", "SVC"], "USERACCOUNT.USERNAME": ["a1", "", "a3", "svc"],
                         "USERACCOUNT.STATUS": ["t", "t", "t", "t"]})
    return TableFrames({"EMPJOBHIST": job, "EMPEMPLOYMENT": emp, "USERACCOUNT": user, **extra})


def test_defaults_d1_user_accounts():
    f = _people_frames({})
    out, review, s = im.apply_defaults(f, D, im.move_scope(f, D))
    u = out.frames["USERACCOUNT"].set_index("USERACCOUNT.USER_ID")
    assert u.loc["A2", "USERACCOUNT.USERNAME"] == "A2"  # blank username = user ID
    assert "SVC" not in u.index and s["D1"]["left_out"] == ["SVC"]  # no employment: left out, listed
    assert u.loc["T1", "USERACCOUNT.STATUS"] == "f" and u.loc["T1", "USERACCOUNT.USERNAME"] == "T1"
    assert s["D1"]["created_inactive"] == ["T1"] and s["D1"]["no_account"] == ["R1"]  # RNS is not terminated
    d1 = {(r["record_key"], r["reason"]) for r in review if r["decision"] == "D1"}
    assert d1 == {("USERACCOUNT|SVC", im.D1_NO_EMPLOYMENT), ("R1", im.D1_NO_ACCOUNT)} or \
        {r for _, r in d1} == {im.D1_NO_EMPLOYMENT, im.D1_NO_ACCOUNT}
    assert len(f.frames["USERACCOUNT"]) == 4  # input untouched


def test_defaults_d1_without_employment_changes_nothing():
    f = TableFrames({"USERACCOUNT": pd.DataFrame({"USERACCOUNT.USER_ID": ["S1"], "USERACCOUNT.USERNAME": ["s"]})})
    out, review, s = im.apply_defaults(f, D, im.move_scope(f, D))
    assert out is f and review == [] and "skipped" in s["D1"]


def test_defaults_d2_duplicate_addresses():
    cols = ["PERSON_ID", "ADDRESS_TYPE", "START_DATE", "CITY"]
    rows = [("P1", "home", "2018-10-01", "Joburg"), ("P1", "home", "2018-10-01", "Joburg"),  # true copy
            ("P2", "home", "2018-10-01", "Old"), ("P2", "Home", "2018-10-01", "New"),  # conflict, case differs
            ("P2", "home2", "2018-10-01", "Other")]  # home2 is its own type
    addr = pd.DataFrame([dict(zip([f"PERADDRESS.{c}" for c in cols], r)) for r in rows])
    f = TableFrames({"PERADDRESS": addr})
    out, review, s = im.apply_defaults(f, D, im.move_scope(f, D))
    a = out.frames["PERADDRESS"]
    assert len(a) == 3 and s["D2"] == {"identical_dropped": 1, "conflicts": 1, "rows_dropped": 1}
    assert set(a["PERADDRESS.CITY"]) == {"Joburg", "New", "Other"}  # latest (last) row wins
    (r,) = [r for r in review if r["decision"] == "D2"]
    assert r["differs"] == {"ADDRESS_TYPE": ("home", "Home"), "CITY": ("Old", "New")}


def test_defaults_d3_flags_only_and_d5_payscale():
    rel = pd.DataFrame({"EMPJOBRELATIONSHIPS.USERID": ["A1", "A1", "T1"],
                        "EMPJOBRELATIONSHIPS.RELATIONSHIP_TYPE": ["HR", "HR", "HR"],
                        "EMPJOBRELATIONSHIPS.START_DATE": ["2020-01-01", "2010-01-01", "2020-01-01"],
                        "EMPJOBRELATIONSHIPS.END_DATE": ["9999-12-31", "2011-01-01", "9999-12-31"],
                        "EMPJOBRELATIONSHIPS.RELATED_USER_ID": ["T1", "T1", "A1"]})
    pst = pd.DataFrame({"SFRAW_PayScaleType.code": ["ZAF/01"], "__raw_key__": ["code=ZAF/01|country=ZAF"]})
    f = _people_frames({"EMPJOBRELATIONSHIPS": rel, "SFRAW_PayScaleType": pst})
    out, review, s = im.apply_defaults(f, D, im.move_scope(f, D))
    d3 = sorted((r["record_key"], r["reason"]) for r in review if r["decision"] == "D3" and r["table"] == "EmpJob")
    assert d3 == [("A1", im.D3_TERMINATED), ("A2", im.D3_NO_MANAGER), ("A3", im.D3_NOT_FOUND)]
    assert s["D3"]["manager_ids_not_found"] == {"X9": 1}
    assert s["D3"]["current_relationship_terminated"] == 1  # the ended 2010 row and T1's own row are not flagged
    assert out.frames["EMPJOBHIST"].equals(f.frames["EMPJOBHIST"])  # history loads as is
    d5 = [(r["record_key"], r["rows"]) for r in review if r["decision"] == "D5"]
    assert d5 == [("ZAF/09", 1)] and s["D5"]["checked"]["PayScaleType"] == {"codes": 2, "missing": 1}
    assert s["D5"]["not_validated"] == ["PayScaleLevel: object not found in the extract"]  # "No Level" kept, not checked
    assert s["needs_review"]["D5"] == 1


def test_source_wins_for_foundation_create_only_for_picklists():
    src = [{"externalCode": "W0", "name": "HR-ZA: Monthly"}, {"externalCode": "W1", "name": "Same"}, {"externalCode": "W9", "name": "New"}]
    tgt = [{"externalCode": "W0", "name": "ZA - Monthly"}, {"externalCode": "W1", "name": "Same"}]
    pl_src = [{"PickListV2_id": "toy", "externalCode": "X", "label": "Source"}]
    pl_tgt = [{"PickListV2_id": "toy", "externalCode": "X", "label": "Target"}]
    cfg = im.config_diff({"FOPayGroup": src, "PickListValueV2": pl_src}, {"FOPayGroup": tgt, "PickListValueV2": pl_tgt})
    assert im.source_wins("FOPayGroup") and not im.source_wins("PickListValueV2")
    kept = im.config_filter({"entity": "FOPayGroup"}, [(r["externalCode"], r) for r in src], cfg)
    assert [k for k, _ in kept] == ["W0", "W9"]  # conflict upserts, identical drops
    assert im.config_filter({"entity": "PickListValueV2"}, [("X", pl_src[0])], cfg) == []
    assert im.overwrites(cfg) == [{"entity": "FOPayGroup", "key": {"externalCode": "W0"},
                                   "fields": {"name": {"target_before": "ZA - Monthly", "source": "HR-ZA: Monthly"}}}]
    ko = im.key_overwrites({"entity": "FOPayGroup"}, [(r["externalCode"], r) for r in src], tgt, ["externalCode"])
    assert [(o["record_key"], o["fields"]) for o in ko] == [
        ("W0", {"name": {"target_before": "ZA - Monthly", "source": "HR-ZA: Monthly"}})]


def test_default_cap_closes_full_manager_chain_and_relationships():
    rows = [(f"P{i}", "2020-01-01", 1, "A", "ZAF", "A", f"P{i + 1}" if i < 6 else None) for i in range(7)]
    f = _frames(rows, rel_rows=[("P0", "R1"), ("P3", "R1")])
    f.frames["EMPJOBHIST"] = pd.concat([f.frames["EMPJOBHIST"], _job([("R1", "2020-01-01", 1, "H", "NAM", "A", "P6")])])
    s = im.move_scope(f, D, {"per_cell": 1})
    assert s["closure_cap"] == im.PILOT_CLOSURE_CAP >= 1000
    assert set(s["keep"]) == {f"P{i}" for i in range(7)} | {"R1"}
    assert s["cut_by_cap"] == [] and s["refs_not_found"] == []
    out, rep = im.apply_scope(f, D, s)
    assert rep["blanked"] == 0
    assert out.frames["EMPJOBHIST"]["EMPJOBHIST.MANAGER_ID"].notna().sum() == 7

"""Instance move plan: SF waves from the dictionary, the manager pass, unplaced tables and SAP methods."""

from api.routes import load_plan as route
from api.services.migration import instance_move as im
from sap.ddic import get_dictionary

SF = ["succession_planning", "performance_goals", "benefits", "compensation", "employee_central"]


def _steps(plan):
    return [s for w in plan["waves"] for s in w["steps"]]


def _sf_plan():
    return im.build_move_plan(SF, get_dictionary("s4hana"))


def test_sf_waves_follow_import_order():
    plan = _sf_plan()
    wave_of = {(s["table"], s["pass"]): s["wave"] for s in _steps(plan)}
    assert wave_of[("POSITION", 1)] == 3
    assert wave_of[("USERACCOUNT", 1)] == 4
    assert wave_of[("PERINFO", 1)] == 5
    assert wave_of[("EMPEMPLOYMENT", 1)] == 6
    assert wave_of[("EMPJOBHIST", 1)] == wave_of[("EMPJOBHIST", 2)] == 7
    assert wave_of[("COMPINFO", 1)] == 8
    assert all(w == 1 for (t, _), w in wave_of.items() if t.startswith("FO"))
    assert [w["wave"] for w in plan["waves"]] == sorted(w["wave"] for w in plan["waves"])
    first, second = plan["waves"][0], plan["waves"][1]
    assert all(s["depends_on"] == sorted({x["entity"] for x in first["steps"]}) for s in second["steps"])
    assert plan["mode"] == "cleansed"


def test_job_history_full_purge_and_manager_second_pass():
    job = [s for s in _steps(_sf_plan()) if s["table"] == "EMPJOBHIST"]
    assert [s["pass"] for s in job] == [1, 2]
    p1, p2 = job
    assert p1["purge_type"] == "full" and p2["purge_type"] is None
    assert p1["exclude"] and "MANAGER_ID" in p2["fields"]


def test_wildcard_entities_are_unplaced_not_guessed():
    plan = _sf_plan()
    fam = {u["entity"] for u in plan["unplaced"] if "entity family" in u["reason"]}
    assert {"PerGlobalInfo*", "DevGoal_*", "Background_*"} <= fam
    assert not any("*" in s["entity"] for s in _steps(plan))


def test_sap_material_master_is_bapi_after_sf_waves():
    plan = im.build_move_plan(["material_master"], get_dictionary("s4hana"), columns_of=route._columns)
    steps = _steps(plan)
    assert steps and all(s["wave"] >= im.SAP_WAVE_BASE for s in steps)
    for s in steps:
        assert s["method"] == ("archive_only" if s["table"] in ("CDHDR", "CDPOS") else "bapi")


def test_public_plan_drops_internal_fields():
    s = im.public_plan(_sf_plan())["waves"][0]["steps"][0]
    assert set(s) == {"module", "entity", "method", "rows", "history_rows", "purge_type", "depends_on", "raw"}


def test_config_list_adds_wave_zero_step():
    cfg = im.config_diff({"ToyList": [{"externalCode": "A"}]}, {"ToyList": []})
    plan = im.build_move_plan([], get_dictionary("s4hana"), config_lists=cfg)
    s = plan["waves"][0]["steps"][0]
    assert (s["entity"], s["method"], s["wave"], s["rows"]) == ("ToyList", "config_create", 0, 1)
    assert plan["config"]["ToyList"] == {"present": 0, "create": 1, "conflict": 0}

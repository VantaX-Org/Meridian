"""Instance move sequence: FO order and cycles, raw entity sets carried whole with history, methods per set,
the not-reachable list, and the move extract of the raw sets. Synthetic data; no system is contacted."""
from types import SimpleNamespace

import pandas as pd

from api.services.connectivity_manager import ConnectivityManager
from api.services.migration import instance_move as im
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
SF = ["succession_planning", "performance_goals", "benefits", "compensation", "employee_central"]


def _steps(plan):
    return [s for w in plan["waves"] for s in w["steps"]]


def _wave(plan, n):
    return next(w for w in plan["waves"] if w["wave"] == n)["steps"]


def test_fo_wave_is_topological_with_second_passes_for_cycles_and_self_references():
    fo = [s for s in _wave(im.build_move_plan(SF, D), 1) if not s.get("raw")]
    first = [s["entity"] for s in fo if s["pass"] == 1]
    assert first.index("FOCompany") < first.index("FOBusinessUnit") < first.index("FODivision")
    assert first.index("FODivision") < first.index("FODepartment")
    assert first.index("FOPayGrade") < first.index("FOJobCode")
    late = {s["entity"]: s for s in fo if s["pass"] == 2}
    assert {"FODivision", "FODepartment", "FOPayComponent"} <= set(late)  # self parent + the pay component cycle
    for ent, s in late.items():
        p1 = next(x for x in fo if x["entity"] == ent and x["pass"] == 1)
        assert p1["exclude"] and s["purge_type"] is None
        assert len(s["fields"]) == len(set(s["fields"]))
    # pass 2 runs after every pass 1 of the wave
    assert max(i for i, s in enumerate(fo) if s["pass"] == 1) < min(i for i, s in enumerate(fo) if s["pass"] == 2)


def test_required_order_of_the_move():
    plan = im.build_move_plan(SF, D)
    wave = {s["entity"]: s["wave"] for s in _steps(plan) if s["pass"] == 1}
    assert wave["PickListV2"] == 0 < wave["FOCompany"] < wave["Position"] < wave["User"] < wave["PerPersonal"]
    assert wave["PerPersonal"] < wave["EmpEmployment"] < wave["EmpJob"] < wave["EmpCompensation"]
    labels = [w["label"] for w in plan["waves"]]
    assert labels.index("Workflow history") < labels.index("Attachments") == len(labels) - 1  # attachments last


def test_methods_per_set():
    assert im.method_of("FormAuditTrail") == im.method_of("WfRequestStep") == "history_import"
    assert im.method_of("EMEventAttribute") == im.method_of("TrendData_SysOverallPotential") == "history_import"
    assert im.method_of("FormHeader") == "file_load"
    assert im.method_of("EmpJob") == im.method_of("Attachment") == "upsert"


def test_not_reachable_sets_are_listed_never_loaded():
    plan = im.build_move_plan(SF, D)
    listed = {n["entity"] for n in plan["not_reachable"]}
    assert listed == {"ExternalLearner*", "Achievement", "Activity", "ContinuousFeedback*", "CPM*",
                      "Background_VarPayEmpHistData"}
    assert im.not_reachable("ExternalLearnerDetail") and im.not_reachable("CPMAchievement")
    assert im.not_reachable("EmpJob") is None
    assert not any(im.not_reachable(s["entity"]) for s in _steps(plan))
    assert im.build_move_plan(["material_master"], D)["not_reachable"] == []


def test_raw_steps_from_extracted_frames_and_records_oldest_first():
    t = "SFRAW_PerGlobalInfoZAF"
    df = pd.DataFrame({f"{t}.personIdExternal": ["P1", "P1", "P2"],
                       f"{t}.startDate": ["2024-01-01", "2020-01-01", "2022-01-01"],
                       f"{t}.genericString1": ["new", "old", None]})
    df["__raw_key__"] = [f"personIdExternal={p}|startDate={d}" for p, d in
                         zip(df[f"{t}.personIdExternal"], df[f"{t}.startDate"])]
    frames = SimpleNamespace(frames={t: df})
    plan = im.build_move_plan(["employee_central"], D, frames=frames)
    step = next(s for s in _steps(plan) if s["entity"] == "PerGlobalInfoZAF")
    assert step["raw"] and step["rows"] == 3 and step["wave"] == im.stage_of("PerPersonal")
    assert not any(u["entity"] == "PerGlobalInfo*" for u in plan["unplaced"] if "entity" in u)
    recs = im.raw_records(step, frames, {"P1": "N1"})
    assert [r["startDate"] for _, r in recs] == ["2020-01-01", "2022-01-01", "2024-01-01"]
    assert len({k for k, _ in recs}) == 3
    assert recs[0][1]["personIdExternal"] == "N1" and "genericString1" not in recs[1][1]  # blank left out
    batches = im.person_batches(step, recs, size=1)
    assert [sorted({r["personIdExternal"] for _, r in b}) for b in batches] == [["N1"], ["P2"]]


EDMX = """<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
<edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2008/09/edm" Namespace="SFOData">
<EntityType Name="PerGlobalInfoZAF"><Key><PropertyRef Name="personIdExternal"/><PropertyRef Name="startDate"/></Key>
  <Property Name="personIdExternal"/><Property Name="startDate"/></EntityType>
<EntityType Name="JobProfile"><Key><PropertyRef Name="externalCode"/></Key><Property Name="externalCode"/></EntityType>
<EntityType Name="Bank"><Key><PropertyRef Name="externalCode"/></Key><Property Name="externalCode"/></EntityType>
<EntityType Name="Position"><Key><PropertyRef Name="code"/><PropertyRef Name="effectiveStartDate"/></Key>
  <Property Name="code"/></EntityType>
<EntityContainer Name="EC"><EntitySet Name="PerGlobalInfoZAF" EntityType="SFOData.PerGlobalInfoZAF"/>
  <EntitySet Name="JobProfile" EntityType="SFOData.JobProfile"/><EntitySet Name="Bank" EntityType="SFOData.Bank"/>
  <EntitySet Name="Position" EntityType="SFOData.Position"/></EntityContainer>
</Schema></edmx:DataServices></edmx:Edmx>"""


class FakeSF:
    def __init__(self):
        self.calls = []

    def metadata(self):
        return EDMX

    def read_entity_set(self, ent, **kw):
        self.calls.append((ent, kw))
        if ent == "Bank":
            raise RuntimeError("boom")
        if ent == "PerGlobalInfoZAF":
            return pd.DataFrame({"personIdExternal": ["P1", "P1"], "startDate": ["2024-01-01", "2020-01-01"],
                                 "__metadata": [{}, {}], "nav": [{"a": 1}, {"a": 2}]})
        return pd.DataFrame({"externalCode": ["J1"]})


def test_move_extract_reads_raw_sets_whole_with_history():
    mgr = ConnectivityManager.__new__(ConnectivityManager)
    conn, frames = FakeSF(), {}
    coverage = [{"table": "POSITION", "status": "live", "entities": ["Position"]}]
    mgr._sf_raw_sets(conn, ["employee_central"], frames, coverage)
    cov = {c["table"]: c for c in coverage}
    read = [c[0] for c in conn.calls]
    assert "Position" not in read  # a canonical table already read it
    assert dict(conn.calls)["PerGlobalInfoZAF"] == {"from_date": "1900-01-01", "to_date": "9999-12-31"}
    assert dict(conn.calls)["JobProfile"] == {}  # not effective dated
    g = frames["SFRAW_PerGlobalInfoZAF"]
    assert list(g["SFRAW_PerGlobalInfoZAF.startDate"]) == ["2020-01-01", "2024-01-01"]
    assert set(g.columns) == {"SFRAW_PerGlobalInfoZAF.personIdExternal", "SFRAW_PerGlobalInfoZAF.startDate",
                              "__raw_key__"}
    assert cov["SFRAW_PerGlobalInfoZAF"]["history"] == "full" and cov["SFRAW_PerGlobalInfoZAF"]["duplicate_keys"] == 0
    assert cov["SFRAW_Bank"]["status"] == "failed"  # one set failing never stops the others
    assert cov["SFRAW_JobProfile"]["status"] == "live"
    assert cov["SFRAW_FOCompany"]["status"] == "not_in_system"  # absent from $metadata: stated, not read
    assert "FOCompany" not in read

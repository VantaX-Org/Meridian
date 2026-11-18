"""Instance move pre-flight: config list diff, $metadata checks, key conflicts and unresolved references.

Every list, entity and value here is synthetic; only the shapes match SuccessFactors."""

from types import SimpleNamespace

from api.services.migration import instance_move as im

SRC = [{"externalCode": "TOY_STD", "name": "Standard", "status": "A"},
       {"externalCode": "TOY_CUSTOM", "name": "Custom", "status": "A"},
       {"externalCode": "TOY_CLASH", "name": "Source label", "status": "A"}]
TGT = [{"externalCode": "TOY_STD", "name": "Standard", "status": "A"},
       {"externalCode": "TOY_CLASH", "name": "Target label", "status": "A"}]


def test_config_diff_existing_skipped_custom_planned_conflict_reported():
    d = im.config_diff({"ToyEventReason": SRC}, {"ToyEventReason": TGT})["ToyEventReason"]
    assert (d["present"], d["create"], d["conflict"]) == (1, 1, 1)
    assert [r["externalCode"] for r in d["create_values"]] == ["TOY_CUSTOM"]
    assert d["conflicts"] == [{"key": {"externalCode": "TOY_CLASH"}, "differs": {"name": ("Source label", "Target label")}}]
    assert im.config_records("ToyEventReason", {"ToyEventReason": d}) == [("externalCode=TOY_CUSTOM", SRC[1])]
    kept = im.config_filter({"entity": "ToyEventReason"}, [(r["externalCode"], r) for r in SRC], {"ToyEventReason": d})
    assert [k for k, _ in kept] == ["TOY_CUSTOM"]


def test_picklist_matches_on_list_id_and_code():
    src = [{"PickListV2_id": "toyA", "externalCode": "X"}, {"PickListV2_id": "toyB", "externalCode": "X"}]
    tgt = [{"PickListV2_id": "toyA", "externalCode": "X"}]
    d = im.config_diff({"PickListValueV2": src}, {"PickListValueV2": tgt})["PickListValueV2"]
    assert d["keys"] == ["PickListV2_id", "externalCode"]
    assert (d["present"], d["create"], d["conflict"]) == (1, 1, 0)


META = """<?xml version="1.0"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:sap="http://www.successfactors.com/edm/sap">
 <edmx:DataServices><Schema xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
  <EntityType Name="ToyEntity" sap:upsertable="true">
   <Property Name="toyId" Nullable="false"/><Property Name="toyName" sap:required="true"/><Property Name="toyNote"/>
  </EntityType>
  <EntityType Name="ToyReadOnly" sap:upsertable="false"><Property Name="toyId"/></EntityType>
  <EntityContainer><EntitySet Name="ToyEntity"/><EntitySet Name="ToyReadOnly"/></EntityContainer>
 </Schema></edmx:DataServices>
</edmx:Edmx>"""


def test_parse_metadata_flags_and_required():
    m = im.parse_metadata(META)
    assert m["ToyEntity"]["upsertable"] and not m["ToyReadOnly"]["upsertable"]
    assert m["ToyEntity"]["properties"] == {"toyId": {"required": True}, "toyName": {"required": True},
                                            "toyNote": {"required": False}}


def test_metadata_issues_missing_field_required_and_archive_only():
    m = im.parse_metadata(META)
    step = {"entity": "ToyEntity", "method": "upsert", "pass": 1}
    issues = im.metadata_issues(step, [("toyId=1", {"toyId": "1", "toyGhost": "x"})], m)
    assert {(i["field"], i["severity"]) for i in issues} == {("toyGhost", "error"), ("toyName", "error")}
    assert all(set(i) == {"entity", "field", "records", "reason", "severity"} for i in issues)
    assert im.metadata_issues({**step, "pass": 2}, [("toyId=1", {"toyId": "1"})], m) == []
    ro = {"entity": "ToyReadOnly", "method": "upsert"}
    [w] = im.metadata_issues(ro, [("k", {"toyId": "1"})], m)
    assert w["severity"] == "warning" and ro["method"] == "archive_only"
    [e] = im.metadata_issues({"entity": "ToyMissing", "method": "upsert"}, [], m)
    assert e["severity"] == "error"


def test_key_conflicts_warns_on_different_data():
    recs = [("toyId=1", {"toyId": "1", "toyName": "A"}), ("toyId=2", {"toyId": "2", "toyName": "B"})]
    tgt = [{"toyId": "1", "toyName": "A"}, {"toyId": "2", "toyName": "Changed"}]
    [w] = im.key_conflicts({"entity": "ToyEntity"}, recs, tgt, ["toyId"])
    assert w["severity"] == "warning" and w["records"] == ["toyId=2"]


def test_unresolved_reference_blocks():
    f = SimpleNamespace(source="ToyJob.eventReason", key=False, picklist=None, check_table="ToyEventReason",
                        check_field="externalCode", name="EVENT_REASON")
    dic = SimpleNamespace(table=lambda n: SimpleNamespace(fields={"EVENT_REASON": f}))
    cfg = im.config_diff({"ToyEventReason": SRC}, {"ToyEventReason": TGT})
    step = {"entity": "ToyJob", "table": "TOYJOB"}
    ok = [("u1", {"eventReason": "TOY_STD"}), ("u2", {"eventReason": "TOY_CUSTOM"})]
    assert im.reference_issues(step, ok, dic, cfg) == []
    [e] = im.reference_issues(step, ok + [("u3", {"eventReason": "TOY_NOWHERE"})], dic, cfg)
    assert e["severity"] == "error" and e["records"] == ["u3"]


def test_preflight_progress_stores_a_running_status_with_the_step_and_issue_counts():
    import json
    from unittest import mock

    from workers.tasks import run_instance_move as task

    session = mock.MagicMock()
    issues = [{"severity": "error"}, {"severity": "warning"}]
    with mock.patch.object(task, "_rls"):
        task._preflight_progress(session, "t", "p", 3, 9, {"wave": 4, "entity": "ToyEntity"}, 120, issues)
    p = json.loads(session.execute.call_args.args[1]["p"])
    assert {k: p[k] for k in ("status", "step", "of", "wave", "entity", "rows", "issues_so_far", "errors_so_far")} == {
        "status": "running", "step": 3, "of": 9, "wave": 4, "entity": "ToyEntity", "rows": 120,
        "issues_so_far": 2, "errors_so_far": 1}
    session.commit.assert_called_once()

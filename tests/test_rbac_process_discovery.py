"""Process discovery rights (spec §6): the process_analyst persona and the `process` resource."""

from api.services import rbac
from api.services.rbac import (
    LEGACY_ACTION_MAP, RESOURCES, VALID_ROLES, _expand, has_permission, home_for, legacy_actions_for_pairs,
    permissions_for, resource_matrix,
)
from tests.test_rbac_legacy_snapshot import ALL_ACTIONS, LEGACY_SNAPSHOT

NEW = {"run_process_discovery", "export_process"}


def test_pre_existing_pairs_unchanged() -> None:
    for role, acts in LEGACY_SNAPSHOT.items():
        for action in sorted(set(ALL_ACTIONS) - NEW):
            assert has_permission(role, action) is (action in acts), (role, action)


def test_who_holds_the_new_actions() -> None:
    run = {r for r in VALID_ROLES if has_permission(r, "run_process_discovery")}
    export = {r for r in VALID_ROLES if has_permission(r, "export_process")}
    assert run == {"admin", "platform_admin", "process_analyst", "programme_lead", "data_steward", "sap_basis"}
    assert export == {"admin", "platform_admin", "process_analyst", "manager", "programme_lead"}
    assert has_permission("viewer", "export_process") is False
    assert has_permission("manager", "run_process_discovery") is False


def test_process_analyst_is_read_plus_process() -> None:
    assert set(permissions_for("process_analyst")) == rbac._READ | NEW
    assert has_permission("process_analyst", "manage_rules") is False
    assert has_permission("process_analyst", "export") is False
    assert "process_analyst" in VALID_ROLES and home_for("process_analyst") == "/home/process"
    assert rbac.BUILTIN_NAMES["process_analyst"] == "Process analyst"


def test_process_resource() -> None:
    assert RESOURCES[-1] == "process"
    assert LEGACY_ACTION_MAP["run_process_discovery"] == {("process", "run")}
    assert LEGACY_ACTION_MAP["export_process"] == {("process", "export")}
    assert ("process", "export") not in _expand({("*", "export")})
    assert ("process", "view") in _expand({("*", "view")})
    analyst = resource_matrix(set(permissions_for("analyst")))["process"]
    assert analyst["view"] and not analyst["export"] and not analyst["run"]
    pa = resource_matrix(set(permissions_for("process_analyst")))["process"]
    assert pa["view"] and pa["export"] and pa["run"]


def test_every_export_holder_gains_nothing_on_process() -> None:
    for role in VALID_ROLES:
        acts = set(permissions_for(role))
        got = resource_matrix(acts)["process"]["export"]
        assert got is ("export_process" in acts), role


def test_custom_role_with_all_export_pairs_does_not_reach_export_process() -> None:
    pairs = _expand({("*", "export")})
    assert "export" in legacy_actions_for_pairs(pairs)
    assert "export_process" not in legacy_actions_for_pairs(pairs)
    assert "export_process" in legacy_actions_for_pairs(pairs | {("process", "export")})

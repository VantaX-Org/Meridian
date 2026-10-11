"""Legacy (role, action) answers are frozen: snapshot of api/services/rbac.py as of wave 13."""

from api.services.rbac import PERMISSIONS, PERSONA_ROLES, VALID_ROLES, has_permission, permissions_for

LEGACY_SNAPSHOT: dict[str, list[str]] = {
    "admin": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'export_process', 'manage_field_mappings', 'manage_llm', 'manage_rules', 'manage_settings', 'manage_system', 'manage_systems', 'manage_users', 'mdm.read', 'mdm.write', 'review_ai_rules', 'run_process_discovery', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence', 'view_audit'],
    "manager": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'export_process', 'manage_systems', 'mdm.read', 'mdm.write', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence', 'view_audit'],
    "steward": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'manage_rules', 'mdm.read', 'mdm.write', 'review_ai_rules', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence'],
    "analyst": ['analyse', 'export', 'mdm.read', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence'],
    "approver": ['approve', 'export', 'mdm.read', 'view', 'view_ai_confidence'],
    "auditor": ['export', 'mdm.read', 'view', 'view_ai_confidence', 'view_audit'],
    "ai_reviewer": ['ai_feedback', 'mdm.read', 'review_ai_rules', 'view', 'view_ai_confidence'],
    "viewer": ['mdm.read', 'view', 'view_ai_confidence'],
}

ALL_ACTIONS = sorted({a for acts in LEGACY_SNAPSHOT.values() for a in acts})


def test_permissions_dict_unchanged() -> None:
    assert {r: sorted(p) for r, p in PERMISSIONS.items()} == LEGACY_SNAPSHOT


def test_every_legacy_role_action_pair_unchanged() -> None:
    for role, acts in LEGACY_SNAPSHOT.items():
        assert permissions_for(role) == acts
        for action in ALL_ACTIONS:
            assert has_permission(role, action) is (action in acts), (role, action)


def test_unknown_role_and_action_still_denied() -> None:
    assert not has_permission("nobody", "view")
    assert not has_permission("viewer", "no_such_action")


def test_persona_roles_equal_the_legacy_role_they_replace() -> None:
    for persona, legacy in (("programme_lead", "manager"), ("data_steward", "steward"),
                            ("data_owner", "approver"), ("platform_admin", "admin")):
        assert permissions_for(persona) == LEGACY_SNAPSHOT[legacy]
    assert set(PERSONA_ROLES) <= VALID_ROLES and set(LEGACY_SNAPSHOT) <= VALID_ROLES


def test_sap_basis_is_analyst_plus_integration_actions() -> None:
    extra = set(permissions_for("sap_basis")) - set(LEGACY_SNAPSHOT["analyst"])
    assert extra == {"manage_systems", "manage_field_mappings"}  # manage_system (platform update) is admin-only
    assert not has_permission("sap_basis", "manage_users")

"""Legacy (role, action) answers are frozen: snapshot of api/services/rbac.py as of wave 13.

Intentional changes since: handoff_rule (hand one blocking rule to a steward) is held by every `assign`
holder, so admin, manager and steward gained it (feat-process-handoff); manage_triage (edit triage teams,
assignment rules and SLA policies) is held by the persona roles programme_lead and data_steward and, because
the admin holds every action, by admin. Legacy manager and steward did not gain it. manage_workflows (create, version
and activate approval workflow definitions) is the administrator's alone. manage_digests (the scheduled digests) is
held by programme_lead and, as every action, by admin; legacy manager did not gain it."""

from api.services.rbac import PERMISSIONS, PERSONA_ROLES, VALID_ROLES, has_permission, permissions_for

LEGACY_SNAPSHOT: dict[str, list[str]] = {
    "admin": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'export_process', 'handoff_rule', 'manage_digests', 'manage_field_mappings', 'manage_llm', 'manage_rules', 'manage_settings', 'manage_system', 'manage_systems', 'manage_triage', 'manage_users', 'manage_workflows', 'mdm.read', 'mdm.write', 'review_ai_rules', 'run_process_discovery', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence', 'view_audit'],
    "manager": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'export_process', 'handoff_rule', 'manage_systems', 'mdm.read', 'mdm.write', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence', 'view_audit'],
    "steward": ['ai_feedback', 'analyse', 'apply', 'approve', 'assign', 'export', 'handoff_rule', 'manage_rules', 'mdm.read', 'mdm.write', 'review_ai_rules', 'trigger_ai', 'trigger_sync', 'upload', 'view', 'view_ai_confidence'],
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
    # Leads and stewards also run process discovery (owner decision 2026-10-26); nothing else differs.
    # They also edit triage teams, rules and SLA policies (manage_triage); the legacy keys stay unchanged.
    extra = {"programme_lead": ["run_process_discovery", "manage_triage", "manage_digests"],
             "data_steward": ["run_process_discovery", "manage_triage"]}
    for persona, legacy in (("programme_lead", "manager"), ("data_steward", "steward"),
                            ("data_owner", "approver"), ("platform_admin", "admin")):
        assert permissions_for(persona) == sorted(LEGACY_SNAPSHOT[legacy] + extra.get(persona, []))
    assert set(PERSONA_ROLES) <= VALID_ROLES and set(LEGACY_SNAPSHOT) <= VALID_ROLES


def test_sap_basis_is_analyst_plus_integration_actions() -> None:
    extra = set(permissions_for("sap_basis")) - set(LEGACY_SNAPSHOT["analyst"])
    # manage_system (platform update) is admin-only; Basis runs process discovery on the systems it connects.
    assert extra == {"manage_systems", "manage_field_mappings", "run_process_discovery"}
    assert not has_permission("sap_basis", "manage_users")


def test_handoff_rule_is_implied_by_assign() -> None:
    """Every role that assigns work can also hand a rule to a steward; process_analyst gets handoff_rule alone."""
    from api.services.rbac import VALID_ROLES
    for role in VALID_ROLES:
        if has_permission(role, "assign"):
            assert has_permission(role, "handoff_rule"), role
    holders = {r for r in VALID_ROLES if has_permission(r, "handoff_rule")}
    assert holders - {r for r in VALID_ROLES if has_permission(r, "assign")} == {"process_analyst"}
    assert not has_permission("process_analyst", "assign")

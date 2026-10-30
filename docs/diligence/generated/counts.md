# Measured figures (generated)

Written by `scripts/diligence_counts.py` (via `bash scripts/diligence_audit.sh`). Do not edit by hand.

```json
{
  "api": {
    "include_router_calls": 120,
    "middleware": [
      "MetricsMiddleware",
      "SecurityHeadersMiddleware",
      "GZipMiddleware",
      "CORSMiddleware",
      "AuditMiddleware",
      "LicenceMiddleware",
      "TenantMiddleware",
      "LocalAuthMiddleware"
    ],
    "route_modules": 125,
    "service_modules": 176
  },
  "celery_beat_entries": 31,
  "code_size": {
    "agents": {
      "files": 13,
      "lines": 2287
    },
    "api": {
      "files": 326,
      "lines": 89071
    },
    "checks": {
      "files": 49,
      "lines": 7715
    },
    "db": {
      "files": 128,
      "lines": 15027
    },
    "frontend (ts, tsx)": {
      "files": 476,
      "lines": 85386
    },
    "llm": {
      "files": 2,
      "lines": 513
    },
    "sap": {
      "files": 31,
      "lines": 14860
    },
    "scripts": {
      "files": 22,
      "lines": 6241
    },
    "tests (py)": {
      "files": 526,
      "lines": 81662
    },
    "updater": {
      "files": 1,
      "lines": 126
    },
    "workers": {
      "files": 60,
      "lines": 12900
    }
  },
  "migrations": {
    "files": 114,
    "newest_file": "116_record_history.py"
  },
  "openapi": {
    "by_method": {
      "delete": 37,
      "get": 401,
      "patch": 19,
      "post": 187,
      "put": 49
    },
    "operations": 693,
    "paths": 594,
    "scim_operations": 17
  },
  "rbac": {
    "action_count": 26,
    "actions": [
      "ai_feedback",
      "analyse",
      "apply",
      "approve",
      "assign",
      "export",
      "export_process",
      "handoff_rule",
      "manage_field_mappings",
      "manage_llm",
      "manage_rules",
      "manage_settings",
      "manage_system",
      "manage_systems",
      "manage_triage",
      "manage_users",
      "mdm.read",
      "mdm.write",
      "review_ai_rules",
      "run_process_discovery",
      "trigger_ai",
      "trigger_sync",
      "upload",
      "view",
      "view_ai_confidence",
      "view_audit"
    ],
    "role_count": 14,
    "roles": [
      "platform_admin",
      "admin",
      "programme_lead",
      "manager",
      "data_steward",
      "steward",
      "sap_basis",
      "data_owner",
      "approver",
      "process_analyst",
      "analyst",
      "ai_reviewer",
      "auditor",
      "viewer"
    ]
  },
  "rls": {
    "alembic_head": [
      "116"
    ],
    "rls_tables": [
      "access_requests",
      "ai_feedback_log",
      "ai_proposed_rules",
      "alert_channels",
      "analysis_run_steps",
      "analysis_versions",
      "api_keys",
      "assignment_rules",
      "assignment_templates",
      "audit_log",
      "cleaning_audit",
      "cleaning_metrics",
      "cleaning_queue",
      "cleaning_rules",
      "comments",
      "config_alignment_findings",
      "config_drift_alerts",
      "config_drift_log",
      "config_health_scores",
      "config_impact_results",
      "config_inventory",
      "config_items",
      "config_loads",
      "config_matches",
      "config_process_steps",
      "config_processes",
      "config_snapshots",
      "contract_breaches",
      "contract_compliance_history",
      "contract_versions",
      "contracts",
      "cost_avoidance",
      "data_anomalies",
      "data_duplicates",
      "data_owners",
      "data_relationships",
      "ddic_domains",
      "ddic_snapshots",
      "ddic_tables",
      "dedup_candidates",
      "delegations",
      "digest_deliveries",
      "digest_schedules",
      "dqs_history",
      "escalation_steps",
      "exception_billing",
      "exception_comments",
      "exception_rules",
      "exceptions",
      "export_packages",
      "extraction_changes",
      "field_dependencies",
      "field_mappings",
      "field_profiles",
      "finding_records",
      "finding_root_causes",
      "findings",
      "glossary_change_log",
      "glossary_term_rules",
      "glossary_terms",
      "golden_writeback_requests",
      "health_samples",
      "impact_records",
      "insight_feedback",
      "known_issues",
      "learned_rule_proposals",
      "llm_audit_log",
      "llm_decision_cache",
      "master_record_history",
      "master_records",
      "match_rules",
      "match_scores",
      "mdm_merge_events",
      "mdm_metrics",
      "mdm_pair_constraints",
      "migration_export_files",
      "migration_gap_findings",
      "migration_runs",
      "migration_waves",
      "notification_deliveries",
      "notification_subscriptions",
      "notifications",
      "policy_field_classes",
      "policy_packs",
      "process_derivations",
      "process_discovery_runs",
      "process_discovery_schedules",
      "process_discovery_variants",
      "process_events",
      "process_model_versions",
      "process_models",
      "process_variants",
      "proven_cost_results",
      "purge_log",
      "record_fixes",
      "record_hashes",
      "record_issue_events",
      "record_issues",
      "record_relationships",
      "remediation_batches",
      "remediation_events",
      "remediation_items",
      "report_files",
      "report_schedule_runs",
      "report_schedules",
      "reports",
      "role_permissions",
      "roles",
      "rule_suppressions",
      "rule_versions",
      "rules",
      "sap_systems",
      "saved_views",
      "scim_group_members",
      "scim_group_role_map",
      "scim_groups",
      "scim_tokens",
      "scim_users",
      "share_links",
      "skipped_deliveries",
      "sla_policies",
      "steward_assignments",
      "steward_metrics",
      "stewardship_queue",
      "survivorship_rules",
      "sync_profiles",
      "sync_runs",
      "system_credentials",
      "system_module_map",
      "system_update_log",
      "table_profiles",
      "tenant_settings",
      "transfer_field_mappings",
      "transfer_value_mappings",
      "triage_settings",
      "triage_team_members",
      "triage_teams",
      "undo_actions",
      "user_role_scopes",
      "users",
      "watches",
      "wave_certificate_signatures",
      "wave_certificates",
      "wave_gates",
      "webhook_deliveries",
      "webhooks",
      "work_counts",
      "work_groups",
      "work_records",
      "write_back_log",
      "z_object_anomalies",
      "z_object_baselines",
      "z_object_findings",
      "z_object_profiles",
      "z_object_registry",
      "z_object_rules"
    ],
    "tables": 160,
    "tables_with_tenant_id": 153,
    "tables_without_tenant_id": [
      [
        "alembic_version",
        false
      ],
      [
        "config_process_steps",
        true
      ],
      [
        "relationship_types",
        false
      ],
      [
        "role_permissions",
        true
      ],
      [
        "rules_hq_cache",
        false
      ],
      [
        "system_credentials",
        true
      ],
      [
        "tenants",
        false
      ]
    ],
    "tenant_tables_rls_enabled": 153,
    "tenant_tables_rls_forced": 152,
    "tenant_tables_rls_not_forced": [
      "system_update_log"
    ],
    "tenant_tables_with_policy": 153,
    "tenant_tables_without_rls": []
  },
  "rules": {
    "by_check_class": {
      "aggregate_check": 5,
      "balance_check": 2,
      "cross_field_check": 1944,
      "dependency_check": 6,
      "domain_value_check": 915,
      "exists_check": 978,
      "format_check": 8,
      "freshness_check": 108,
      "group_sum_check": 14,
      "hierarchy_check": 9,
      "interval_check": 37,
      "null_check": 1181,
      "referential_check": 2600,
      "regex_check": 361,
      "similarity_check": 11,
      "uniqueness_check": 201
    },
    "by_dimension": {
      "accuracy": 295,
      "completeness": 1516,
      "consistency": 4032,
      "freshness": 2,
      "lifecycle": 66,
      "timeliness": 229,
      "uniqueness": 212,
      "validity": 2028
    },
    "by_severity": {
      "critical": 387,
      "high": 3933,
      "info": 8,
      "low": 1093,
      "medium": 2959
    },
    "by_system": {
      "ariba": 141,
      "concur": 97,
      "ecc": 6004,
      "successfactors": 1556,
      "warehouse": 581,
      "ztables": 1
    },
    "check_type_classes": 21,
    "enabled_by_default": 5623,
    "generated_from_ddic": 2757,
    "hand_written": 5623,
    "modules": 47,
    "total": 8380
  },
  "tests": {
    "playwright_spec_files": 18,
    "playwright_specs": [
      "guided-tours-v2.spec.ts",
      "redirects.spec.ts",
      "sign-in-states.spec.ts",
      "v2-a11y.spec.ts",
      "v2-admin.spec.ts",
      "v2-help.spec.ts",
      "v2-landscape.spec.ts",
      "v2-mdm.spec.ts",
      "v2-object.spec.ts",
      "v2-people.spec.ts",
      "v2-roles.spec.ts",
      "v2-rules.spec.ts",
      "v2-runs.spec.ts",
      "v2-status.spec.ts",
      "v2-step10.spec.ts",
      "v2-step9.spec.ts",
      "v2-systems.spec.ts",
      "v2-work.spec.ts"
    ],
    "playwright_tests_declared (static count of test( calls)": 195,
    "pytest_files": 505,
    "pytest_files_postgres (_pg.py)": 89,
    "vitest_files": 121
  }
}
```

# Measured figures (generated)

Written by `scripts/diligence_counts.py` (via `bash scripts/diligence_audit.sh`). Do not edit by hand.

```json
{
  "api": {
    "include_router_calls": 135,
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
    "route_modules": 146,
    "service_modules": 227
  },
  "celery_beat_entries": 33,
  "code_size": {
    "agents": {
      "files": 13,
      "lines": 2257
    },
    "api": {
      "files": 400,
      "lines": 115382
    },
    "checks": {
      "files": 57,
      "lines": 9095
    },
    "db": {
      "files": 167,
      "lines": 17720
    },
    "frontend (ts, tsx)": {
      "files": 861,
      "lines": 157133
    },
    "llm": {
      "files": 2,
      "lines": 513
    },
    "sap": {
      "files": 36,
      "lines": 16875
    },
    "scripts": {
      "files": 27,
      "lines": 7193
    },
    "tests (py)": {
      "files": 714,
      "lines": 105937
    },
    "updater": {
      "files": 1,
      "lines": 142
    },
    "workers": {
      "files": 70,
      "lines": 14532
    }
  },
  "migrations": {
    "files": 153,
    "newest_file": "160_semantic_type_overrides.py"
  },
  "rbac": {
    "action_count": 28,
    "actions": [
      "ai_feedback",
      "analyse",
      "apply",
      "approve",
      "assign",
      "export",
      "export_process",
      "handoff_rule",
      "manage_digests",
      "manage_field_mappings",
      "manage_llm",
      "manage_rules",
      "manage_settings",
      "manage_system",
      "manage_systems",
      "manage_triage",
      "manage_users",
      "manage_workflows",
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
  "rules": {
    "by_check_class": {
      "aggregate_check": 5,
      "all_children_check": 1,
      "balance_check": 2,
      "contact_check": 13,
      "count_per_parent_check": 3,
      "cross_field_check": 2555,
      "dependency_check": 6,
      "domain_value_check": 947,
      "exists_check": 1166,
      "format_check": 40,
      "freshness_check": 113,
      "group_sum_check": 14,
      "hierarchy_check": 9,
      "interval_check": 40,
      "null_check": 1291,
      "referential_check": 2684,
      "regex_check": 593,
      "similarity_check": 12,
      "uniqueness_check": 236,
      "value_placement_check": 20
    },
    "by_dimension": {
      "accuracy": 371,
      "completeness": 1694,
      "consistency": 4600,
      "freshness": 2,
      "lifecycle": 77,
      "timeliness": 264,
      "uniqueness": 251,
      "validity": 2491
    },
    "by_severity": {
      "critical": 409,
      "high": 4372,
      "info": 8,
      "low": 1452,
      "medium": 3509
    },
    "by_system": {
      "ariba": 141,
      "concur": 97,
      "ecc": 6976,
      "successfactors": 1956,
      "warehouse": 579,
      "ztables": 1
    },
    "check_type_classes": 25,
    "enabled_by_default": 6988,
    "generated_from_ddic": 2762,
    "hand_written": 6988,
    "modules": 47,
    "total": 9750
  },
  "tests": {
    "playwright_spec_files": 20,
    "playwright_specs": [
      "acceptance.spec.ts",
      "guided-tours-v2.spec.ts",
      "redirects.spec.ts",
      "sign-in-states.spec.ts",
      "v2-a11y.spec.ts",
      "v2-admin.spec.ts",
      "v2-help.spec.ts",
      "v2-journeys.spec.ts",
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
    "playwright_tests_declared (static count of test( calls)": 219,
    "pytest_files": 688,
    "pytest_files_postgres (_pg.py)": 136,
    "vitest_files": 230
  }
}
```

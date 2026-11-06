# Measured figures (generated)

Written by `scripts/diligence_counts.py` (via `bash scripts/diligence_audit.sh`). Do not edit by hand.

```json
{
  "api": {
    "include_router_calls": 131,
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
    "route_modules": 139,
    "service_modules": 209
  },
  "celery_beat_entries": 33,
  "code_size": {
    "agents": {
      "files": 13,
      "lines": 2257
    },
    "api": {
      "files": 375,
      "lines": 105203
    },
    "checks": {
      "files": 56,
      "lines": 8943
    },
    "db": {
      "files": 160,
      "lines": 17376
    },
    "frontend (ts, tsx)": {
      "files": 784,
      "lines": 143014
    },
    "llm": {
      "files": 2,
      "lines": 513
    },
    "sap": {
      "files": 36,
      "lines": 16699
    },
    "scripts": {
      "files": 26,
      "lines": 7099
    },
    "tests (py)": {
      "files": 657,
      "lines": 99495
    },
    "updater": {
      "files": 1,
      "lines": 142
    },
    "workers": {
      "files": 67,
      "lines": 14225
    }
  },
  "migrations": {
    "files": 146,
    "newest_file": "148_external_db_key_version.py"
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
      "count_per_parent_check": 1,
      "cross_field_check": 2267,
      "dependency_check": 6,
      "domain_value_check": 949,
      "exists_check": 1118,
      "format_check": 40,
      "freshness_check": 115,
      "group_sum_check": 14,
      "hierarchy_check": 9,
      "interval_check": 39,
      "null_check": 1274,
      "referential_check": 2685,
      "regex_check": 560,
      "similarity_check": 12,
      "uniqueness_check": 231,
      "value_placement_check": 20
    },
    "by_dimension": {
      "accuracy": 359,
      "completeness": 1633,
      "consistency": 4406,
      "freshness": 2,
      "lifecycle": 76,
      "timeliness": 263,
      "uniqueness": 243,
      "validity": 2366
    },
    "by_severity": {
      "critical": 410,
      "high": 4305,
      "info": 8,
      "low": 1326,
      "medium": 3299
    },
    "by_system": {
      "ariba": 141,
      "concur": 97,
      "ecc": 6665,
      "successfactors": 1865,
      "warehouse": 579,
      "ztables": 1
    },
    "check_type_classes": 24,
    "enabled_by_default": 6581,
    "generated_from_ddic": 2767,
    "hand_written": 6581,
    "modules": 47,
    "total": 9348
  },
  "tests": {
    "playwright_spec_files": 19,
    "playwright_specs": [
      "acceptance.spec.ts",
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
    "playwright_tests_declared (static count of test( calls)": 216,
    "pytest_files": 631,
    "pytest_files_postgres (_pg.py)": 133,
    "vitest_files": 206
  }
}
```

# Feature claims verification

Branch feat/claims, 2026-11-23. Results: PASS (already true, test exists), FIXED (was false, fixed here, test added), FAILS-ENV (test exists but needs Postgres via MERIDIAN_TEST_DB_URL, not run here), NOT-TRUE (claim not backed by code).

| Claim / feature | Source | Test | Result |
|---|---|---|---|
| 45 modules, 9,846 rules (7,037 hand-authored, 2,809 DDIC-derived) | README, CLAUDE.md | tests/checks/test_claim_hygiene.py | FIXED (CLAUDE.md said 29 modules, 9,737 rules) |
| 25 check classes, 6 DQS dimensions | README | tests/checks/test_claim_hygiene.py | PASS |
| 53 config impact rules | README said 52 | tests/test_claims_load_file_roundtrip.py::test_readme_config_impact_rule_count_matches_seed | FIXED (seed has 53 unique check ids) |
| 7 SAP system types (ECC, S/4 Cloud, SuccessFactors, Concur, Ariba, eWMS, BTP) | README | sap/ has connectors for each; eWMS runs on the ABAP/RFC path (sap/config_loader.py ABAP_TYPES, connectivity_manager) with no dedicated connector module | PASS (eWMS shares the ECC connector) |
| Export centre: datasets, xlsx/csv/json | docs/roles-and-features.md | tests/test_export_centre.py | PASS |
| Export row cap is disclosed, not silent | export centre | test_csv_says_so_when_rows_are_cut_at_the_cap | FIXED (CSV truncated silently at 100k rows) |
| Fix-sheet export, fill in Excel, re-import | app-like cycle journey | tests/test_claims_fix_sheet_roundtrip.py (6) | PASS |
| Load files (xlsx, csv zip) in load order | migration docs | tests/test_claims_load_file_roundtrip.py (2) | PASS |
| Rules bulk export then import round trip | admin guide | tests/test_claims_rules_bulk_roundtrip.py (2) | FIXED (export cap 5000 vs import cap 500; one BULK_MAX=5000 now) |
| Rules workbook import in the UI | Rules screen | frontend/lib/api/__tests__/download.test.ts, frontend/ui/kit/FileDrop.test.tsx | FIXED (large xlsx overflowed the stack, no error toast; bytesToBase64 chunks) |
| Download filename from Content-Disposition, JSON error detail | all exports | download.test.ts | PASS |
| Process export routes | docs/roles-and-features.md | route-existence check | FIXED (doc named nonexistent /process-export/*) |
| User guide PDF renders | help guide | tests/test_user_guide.py | PASS |
| Board workbook, export packages, target workbook, work-exceptions export | export docs | test_board_workbook, test_export_packages_pg, test_target_workbook_pg, test_work_exceptions_export_pg | FAILS-ENV |
| Upload and AI column match | upload journey | none (api/routes/upload_match.py, api/services/ai_column_matcher.py); only parse/path/origin/checks are tested | NOT-TRUE as "verified": untested. Needs a deterministic fixture test of detect_module_and_match. |
| Baseline of 44 export/import test files | all | pytest | 450 passed, 11 skipped (PG-gated) |

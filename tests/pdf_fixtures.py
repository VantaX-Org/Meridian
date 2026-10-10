"""Generic fixtures for the PDF report tests and the preview images in
docs/report-previews/. Every name and number here is invented."""

from __future__ import annotations

from datetime import datetime, timezone

TENANT = "Example Manufacturing Ltd"
SYSTEM = {"name": "PRD ECC", "system_type": "ecc", "environment": "production"}
GENERATED = datetime(2026, 10, 4, 9, 30, tzinfo=timezone.utc)
DIMS = ("completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity")


def _summary(scores: dict[str, tuple[float, int, int, dict]]) -> dict:
    out = {}
    for mod, (score, checks, crit, dims) in scores.items():
        out[mod] = {"composite_score": score, "total_checks": checks, "passing_checks": checks - 3 - crit,
                    "critical_count": crit, "dimension_scores": {d: dims.get(d, 100.0) for d in DIMS},
                    "dimension_coverage": {d: (checks // 3 if d in dims else 0) for d in DIMS},
                    "cap_reason": "Capped at 85: one critical check fails" if crit == 1 else None}
    return out


def _f(module: str, check_id: str, severity: str, dimension: str, affected: int, total: int,
       error: str | None = None) -> dict:
    return {"module": module, "check_id": check_id, "severity": severity, "dimension": dimension,
            "affected_count": affected, "total_count": total,
            "pass_rate": round(100 * (1 - affected / total), 2) if total else None,
            "details": {"error": error} if error else {}}


V1 = {"id": "6f1c2a10-0000-4000-8000-000000000001", "label": "September baseline", "status": "complete",
      "run_at": datetime(2026, 9, 2, 6, 0, tzinfo=timezone.utc),
      "dqs_summary": _summary({
          "business_partner": (74.2, 42, 1, {"completeness": 71.0, "accuracy": 80.5, "consistency": 77.0, "validity": 69.0}),
          "material_master": (86.0, 51, 0, {"completeness": 88.0, "accuracy": 90.0, "uniqueness": 99.2, "validity": 74.0}),
          "accounts_payable": (68.5, 30, 2, {"completeness": 61.0, "accuracy": 70.0, "consistency": 72.0}),
      }),
      "metadata": {"source": "extraction", "row_count": 512_400,
                   "object_rows": {"business_partner": 48_200, "material_master": 120_500, "accounts_payable": 9_800}}}

V2 = {"id": "6f1c2a10-0000-4000-8000-000000000002", "label": "October re-run", "status": "complete",
      "run_at": datetime(2026, 10, 3, 6, 0, tzinfo=timezone.utc),
      "dqs_summary": _summary({
          "business_partner": (83.9, 42, 1, {"completeness": 84.0, "accuracy": 86.0, "consistency": 80.0, "validity": 82.0}),
          "material_master": (84.1, 51, 0, {"completeness": 85.5, "accuracy": 89.0, "uniqueness": 99.0, "validity": 70.5}),
          "accounts_payable": (79.0, 30, 1, {"completeness": 75.0, "accuracy": 80.0, "consistency": 81.0}),
          "fi_gl": (93.4, 24, 0, {"completeness": 95.0, "consistency": 92.0}),
      }),
      "metadata": {
          "source": "extraction", "system_id": "6f1c2a10-0000-4000-8000-0000000000aa",
          "modules": ["business_partner", "material_master", "accounts_payable", "fi_gl"],
          "scope": {"company_codes": ["1000", "2000"], "fiscal_years": ["2025", "2026"]},
          "started_at": "2026-10-03T05:31:12+00:00", "downloaded_at": "2026-10-03T05:52:40+00:00",
          "row_count": 547_930, "extraction_complete": False,
          "object_rows": {"business_partner": 48_950, "material_master": 121_340, "accounts_payable": 10_210, "fi_gl": 2_480},
          "coverage": [
              {"table": "BUT000", "status": "live", "rows": 48_950, "purpose": "Business partner general data", "seconds": 41.2, "source_rows": 48_950},
              {"table": "BUT020", "status": "live", "rows": 51_002, "purpose": "Business partner addresses", "seconds": 38.0},
              {"table": "LFA1", "status": "live", "rows": 10_210, "purpose": "Vendor master", "seconds": 9.4, "source_rows": 10_210},
              {"table": "LFB1", "status": "live", "rows": 14_880, "purpose": "Vendor company code data", "seconds": 11.1},
              {"table": "MARA", "status": "live", "rows": 121_340, "purpose": "Material general data", "seconds": 186.5, "source_rows": 121_340},
              {"table": "MARC", "status": "live", "rows": 200_000, "purpose": "Material plant data", "seconds": 402.7, "truncated": True, "window": None},
              {"table": "BSEG", "status": "live", "rows": 96_100, "purpose": "Accounting line items", "seconds": 512.3, "window": "Fiscal years 2025–2026", "partial": True, "source_rows": 96_140},
              {"table": "SKA1", "status": "live", "rows": 2_480, "purpose": "G/L account master", "seconds": 3.1},
              {"table": "SKB1", "status": "live", "rows": 2_968, "purpose": "G/L account company code data", "seconds": 3.8, "duplicate_keys": 12},
              {"table": "ADRC", "status": "failed", "detail": "RFC_READ_TABLE: DATA_BUFFER_EXCEEDED at host 192.0.2.10:3300", "seconds": 5.0},
              {"table": "T077K", "status": "not_in_system", "purpose": "Vendor account groups"},
          ],
      }}

FINDINGS1 = [
    _f("business_partner", "BP001", "critical", "completeness", 3_120, 48_200),
    _f("business_partner", "BP004", "high", "validity", 5_410, 48_200),
    _f("business_partner", "BP009", "medium", "consistency", 820, 48_200),
    _f("material_master", "MM003", "high", "validity", 9_800, 120_500),
    _f("material_master", "MM011", "medium", "completeness", 2_150, 120_500),
    _f("accounts_payable", "AP002", "critical", "completeness", 640, 9_800),
    _f("accounts_payable", "AP005", "critical", "accuracy", 210, 9_800),
    _f("accounts_payable", "AP010", "low", "consistency", 1_900, 9_800),
    _f("accounts_payable", "AP014", "high", "validity", 0, 9_800),
]
FINDINGS2 = [
    _f("business_partner", "BP001", "critical", "completeness", 1_045, 48_950),
    _f("business_partner", "BP004", "high", "validity", 2_200, 48_950),
    _f("business_partner", "BP009", "medium", "consistency", 0, 48_950),
    _f("material_master", "MM003", "high", "validity", 11_420, 121_340),
    _f("material_master", "MM011", "medium", "completeness", 2_090, 121_340),
    _f("material_master", "MM020", "low", "uniqueness", 0, 121_340, error="Field MARC.MMSTA not in extracted data"),
    _f("accounts_payable", "AP002", "critical", "completeness", 120, 10_210),
    _f("accounts_payable", "AP005", "critical", "accuracy", 0, 10_210),
    _f("accounts_payable", "AP010", "low", "consistency", 1_650, 10_210),
    _f("accounts_payable", "AP014", "high", "validity", 85, 10_210),
    _f("fi_gl", "GL003", "medium", "consistency", 37, 2_480),
]

RECORD_DIFF = [
    {"check_id": "BP001", "module": "business_partner", "severity": "critical", "new": 112, "resolved": 2_187, "persisting": 933, "comparable": True},
    {"check_id": "BP004", "module": "business_partner", "severity": "high", "new": 40, "resolved": 3_250, "persisting": 2_160, "comparable": True},
    {"check_id": "MM003", "module": "material_master", "severity": "high", "new": 1_900, "resolved": 280, "persisting": 9_520, "comparable": True},
    {"check_id": "AP014", "module": "accounts_payable", "severity": "high", "new": 85, "resolved": 0, "persisting": 0, "comparable": True},
    {"check_id": "MM020", "module": "material_master", "severity": "low", "new": 0, "resolved": 0, "persisting": 0, "comparable": False},
]

CLEANING = {
    "queue": [{"object_type": "business_partner", "status": "applied", "n": 1_240},
              {"object_type": "business_partner", "status": "approved", "n": 310},
              {"object_type": "business_partner", "status": "pending", "n": 2_080},
              {"object_type": "material_master", "status": "applied", "n": 860},
              {"object_type": "material_master", "status": "pending", "n": 4_400},
              {"object_type": "material_master", "status": "rejected", "n": 95}],
    "rules_applied": [
        {"name": "Trim leading and trailing spaces in names", "object_type": "business_partner", "category": "standardisation", "risk_level": "low", "applied": 1_020, "last_at": datetime(2026, 9, 28, 14, 2, tzinfo=timezone.utc)},
        {"name": "Upper-case country keys", "object_type": "business_partner", "category": "standardisation", "risk_level": "low", "applied": 220, "last_at": datetime(2026, 9, 28, 14, 5, tzinfo=timezone.utc)},
        {"name": "Default base unit of measure to EA", "object_type": "material_master", "category": "enrichment", "risk_level": "medium", "applied": 860, "last_at": datetime(2026, 9, 30, 8, 41, tzinfo=timezone.utc)},
    ],
    "audit": [{"action": "applied", "n": 2_100, "records": 2_100, "last_at": datetime(2026, 9, 30, 8, 41, tzinfo=timezone.utc)},
              {"action": "approved", "n": 2_410, "records": 2_410, "last_at": datetime(2026, 9, 30, 8, 40, tzinfo=timezone.utc)},
              {"action": "rejected", "n": 95, "records": 95, "last_at": datetime(2026, 9, 29, 16, 12, tzinfo=timezone.utc)}],
    "dedup": {"total": 640, "pending": 410, "merged": 180},
    "batches": [
        {"name": "Vendor bank data corrections", "status": "exported", "created_at": datetime(2026, 9, 12, 9, 0, tzinfo=timezone.utc), "approved_at": None, "exported_at": datetime(2026, 9, 14, 11, 20, tzinfo=timezone.utc), "records": 640, "fixed": 520, "still_failing": 120},
        {"name": "Missing partner names", "status": "exported", "created_at": datetime(2026, 9, 20, 9, 0, tzinfo=timezone.utc), "approved_at": None, "exported_at": datetime(2026, 9, 22, 15, 5, tzinfo=timezone.utc), "records": 2_187, "fixed": 2_075, "still_failing": 0},
        {"name": "Material type clean-up", "status": "approved", "created_at": datetime(2026, 10, 3, 10, 0, tzinfo=timezone.utc), "approved_at": None, "exported_at": None, "records": 1_900, "fixed": 0, "still_failing": 0},
    ],
    "batches_reason": None,
    "proposals": [{"source": "rule", "n": 3_500, "with_value": 3_310}, {"source": "steward", "n": 1_227, "with_value": 1_227}],
    "proposal_samples": [
        {"check_id": "MM003", "field": "MARA.MTART", "current_value": "", "proposed_value": "FERT", "n": 1_420},
        {"check_id": "BP004", "field": "BUT000.TYPE", "current_value": "0", "proposed_value": "2", "n": 610},
        {"check_id": "AP005", "field": "LFA1.LAND1", "current_value": "za", "proposed_value": "ZA", "n": 120},
    ],
    "proposal_source": "remediation_items",
    "record_fixes": [{"status": "pending", "n": 4_100}, {"status": "fixed", "n": 2_075}, {"status": "rejected", "n": 60}],
}

REPORT_JSON = {
    "ai_executive_summary": "Business partner and vendor data improved after the September corrections, but material "
                            "types are now the largest open issue. Fixing material types before the next load "
                            "would lift material master readiness to conditional.",
    "remediations": {"fix_sequence": [
        {"check_id": "AP014", "reason": "Vendors without a reconciliation account cannot be posted to", "estimated_effort": "2 days"},
        {"check_id": "BP001", "reason": "Partners without a number cannot be referenced by any transaction", "estimated_effort": "1 day"},
        {"check_id": "MM003", "reason": "Material type controls procurement, storage and valuation", "estimated_effort": "3 days"}]},
    "modules": [],
}

# T18: failing-record samples for the object report (module material_master, matching
# FINDINGS2's MM003/MM011 checks).
SAMPLES = [
    {"check_id": "MM003", "record_key": "MATNR=100-100", "field_values": {"MARA.MTART": "", "MARA.MATNR": "100-100"}},
    {"check_id": "MM003", "record_key": "MATNR=100-200", "field_values": {"MARA.MTART": "", "MARA.MATNR": "100-200"}},
    {"check_id": "MM011", "record_key": "MATNR=100-300", "field_values": {"MARA.ERSDA": None, "MARA.MATNR": "100-300"}},
]

# T19: Material 360 fix-sheet by_view sections, shaped like
# api.services.material_360.build_findings()'s "by_view" output.
BY_VIEW = [
    {"view": "basic", "label": "Basic data", "rules": 5, "passing_count": 3, "not_evaluated": [],
     "failing": [
         {"check_id": "MM003", "message": "Material type must be set", "severity": "high",
          "field": "MARA.MTART", "level": "client", "actual_value": "",
          "record_key": "MATNR=100-100", "issue_id": None, "issue_status": None,
          "record_fix": "Set MARA.MTART to a valid material type for MATNR=100-100."},
     ]},
    {"view": "plant", "label": "Plant data", "rules": 4, "passing_count": 4, "not_evaluated": ["MM099"],
     "failing": []},
]
BY_VIEW_CLEAN = [
    {"view": "basic", "label": "Basic data", "rules": 5, "passing_count": 5, "not_evaluated": [], "failing": []},
]

SUPPLEMENTARY = {
    "cleaning": {"total": 8_985, "applied": 2_100, "approved": 310, "pending": 6_480},
    "dedup": {"total": 640, "pending": 410, "merged": 180},
    "exceptions": {"total": 42, "critical": 3, "high": 11, "open_count": 19},
    "impact": {}, "contracts": {"total": 6, "active": 5, "breached": 1},
    "dqs_trend": [{"recorded_at": "2026-10-03T06:00:00+00:00", "dqs_score": 84.2, "module_id": None},
                  {"recorded_at": "2026-09-02T06:00:00+00:00", "dqs_score": 77.6, "module_id": None}],
    "mdm_snapshot": None, "golden_summary": [],
}

"""Config match Excel export service.

Generates a formatted .xlsx report from config_match results, routed through
the shared api.services.branded_xlsx.build_workbook writer (Cover sheet,
accent header styling, formula-injection guard, meridian- filename).

ponytail: per-row classification colour-coding (data_error/config_deviation/
ambiguous) is reduced to colouring only the "Classification" cell itself —
ColumnSpec.fill_by_value colours one column's own cell by its own value, not
the whole row. Full-row fill would need a SheetSpec row-fill hook that
build_workbook doesn't have yet; add one there if the whole-row highlight
is required again.
"""

from datetime import date

from api.services.branded_xlsx import ColumnSpec, SheetSpec, build_workbook

_CLASSIFICATION_FILL = {
    "data_error": "FFE8E8",
    "config_deviation": "FFFDE0",
    "ambiguous": "E8F0FF",
}

_CLASSIFICATION_COL = ColumnSpec("classification", "Classification", fill_by_value=_CLASSIFICATION_FILL)

_DATA_ERROR_COLS = [
    ColumnSpec("module", "Module"),
    ColumnSpec("check_id", "Check ID", kind="mono"),
    ColumnSpec("record_key", "Record Key", kind="mono"),
    ColumnSpec("field", "Field"),
    ColumnSpec("actual_value", "Actual Value"),
    ColumnSpec("std_rule_expectation", "Rule Expectation"),
    ColumnSpec("recommended_action", "Recommended Action"),
    ColumnSpec("sap_tcode", "SAP T-Code", kind="mono"),
    ColumnSpec("fix_priority", "Fix Priority", kind="int"),
]

_DEVIATION_COLS = [
    ColumnSpec("module", "Module"),
    ColumnSpec("check_id", "Check ID", kind="mono"),
    ColumnSpec("record_key", "Record Key", kind="mono"),
    ColumnSpec("field", "Field"),
    ColumnSpec("actual_value", "Actual Value"),
    ColumnSpec("config_evidence", "Config Evidence"),
    ColumnSpec("recommended_action", "Recommended Action"),
    ColumnSpec("sap_tcode", "SAP T-Code", kind="mono"),
    ColumnSpec("fix_priority", "Fix Priority", kind="int"),
]

_MODULE_COLS = [
    _CLASSIFICATION_COL,
    ColumnSpec("check_id", "Check ID", kind="mono"),
    ColumnSpec("record_key", "Record Key", kind="mono"),
    ColumnSpec("field", "Field"),
    ColumnSpec("actual_value", "Actual Value"),
    ColumnSpec("config_evidence", "Config Evidence"),
    ColumnSpec("recommended_action", "Recommended Action"),
    ColumnSpec("sap_tcode", "SAP T-Code", kind="mono"),
    ColumnSpec("fix_priority", "Fix Priority", kind="int"),
]

_SUMMARY_COLS = [ColumnSpec("metric", "Metric"), ColumnSpec("count", "Count", kind="int")]
_MODULE_BREAKDOWN_COLS = [
    ColumnSpec("module", "Module"),
    ColumnSpec("data_errors", "Data Errors", kind="int"),
    ColumnSpec("config_deviations", "Config Deviations", kind="int"),
    ColumnSpec("ambiguous", "Ambiguous", kind="int"),
    ColumnSpec("total", "Total", kind="int"),
]


def generate_config_match_excel(
    matches: list[dict],
    summary: dict,
    version_id: str,
    tenant_name: str = "Meridian",
) -> bytes:
    """Generate a formatted Excel report from config match results.

    Args:
        matches: List of classification dicts from the config matching agent.
        summary: Summary dict with data_errors, config_deviations, ambiguous,
                 and modules_with_deviations counts.
        version_id: Analysis version UUID (first 8 chars shown in report).

    Returns:
        Excel file contents as bytes.
    """
    total = summary.get("data_errors", 0) + summary.get("config_deviations", 0) + summary.get("ambiguous", 0)
    summary_rows = [
        {"metric": "Total Records Assessed", "count": total},
        {"metric": "Data Errors", "count": summary.get("data_errors", 0)},
        {"metric": "Config Deviations", "count": summary.get("config_deviations", 0)},
        {"metric": "Ambiguous — Needs Review", "count": summary.get("ambiguous", 0)},
    ]

    module_counts: dict[str, dict[str, int]] = {}
    for m in matches:
        mod = m.get("module", "unknown")
        clf = m.get("classification", "ambiguous")
        counts = module_counts.setdefault(mod, {"data_error": 0, "config_deviation": 0, "ambiguous": 0})
        counts[clf] = counts.get(clf, 0) + 1

    breakdown_rows = []
    for mod in summary.get("modules_with_deviations", []):
        counts = module_counts.get(mod, {})
        de, cd, am = counts.get("data_error", 0), counts.get("config_deviation", 0), counts.get("ambiguous", 0)
        breakdown_rows.append({"module": mod, "data_errors": de, "config_deviations": cd, "ambiguous": am, "total": de + cd + am})

    data_errors = sorted(
        (m for m in matches if m.get("classification") == "data_error"),
        key=lambda m: (m.get("fix_priority", 9), m.get("module", "")),
    )
    deviations = sorted(
        (m for m in matches if m.get("classification") == "config_deviation"),
        key=lambda m: (m.get("module", ""), m.get("fix_priority", 9)),
    )
    ambiguous = sorted(
        (m for m in matches if m.get("classification") == "ambiguous"),
        key=lambda m: (m.get("module", ""), m.get("fix_priority", 9)),
    )

    module_matches: dict[str, list[dict]] = {}
    for m in matches:
        module_matches.setdefault(m.get("module", "unknown"), []).append(m)

    sheets = [
        SheetSpec(title="Summary", columns=_SUMMARY_COLS, rows=summary_rows),
        SheetSpec(title="By module", columns=_MODULE_BREAKDOWN_COLS, rows=breakdown_rows),
        SheetSpec(title="Data Errors", columns=_DATA_ERROR_COLS, rows=data_errors),
        SheetSpec(title="Config Deviations", columns=_DEVIATION_COLS, rows=deviations),
        SheetSpec(title="Ambiguous — Review", columns=_DEVIATION_COLS, rows=ambiguous),
    ]
    for mod in sorted(module_matches):
        sorted_rows = sorted(module_matches[mod], key=lambda m: (m.get("fix_priority", 9), m.get("classification", "")))
        sheets.append(SheetSpec(title=mod[:31], columns=_MODULE_COLS, rows=sorted_rows))

    return build_workbook(
        tenant_name=tenant_name,
        run_label=version_id,
        run_id=version_id,
        title=f"Config match report — {date.today().isoformat()}",
        sheets=sheets,
    )

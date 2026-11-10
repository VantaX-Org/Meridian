"""Cleaning workbook: per-record rows, suggestions, instructions and sheet splitting (synthetic data)."""
import io

import openpyxl

from api.services import cleaning_workbook as cw
from api.services.branded_xlsx import build_workbook

RULES = {
    "EC-001": {"id": "EC-001", "field": "PERINFO.GENDER", "severity": "high", "message": "Gender must be M, F or U.",
               "why_it_matters": "Payroll reporting needs it.", "sap_impact": "Statutory reports fail.",
               "rule_authority": "sap_standard",
               "fix_map": {"__blank__": "Set gender in Personal Information.", "__other__": "Replace '{invalid_value}'."},
               "record_fix_template": "Employee {PERINFO.PERSON_ID}: {fix_instruction}"},
    "EC-002": {"id": "EC-002", "field": "PERINFO.FIRSTNAME", "severity": "critical", "message": "Name has spaces.",
               "fix_map": {"__other__": "Trim '{invalid_value}'."},
               "auto_fix": {"steps": [{"op": "strip"}], "confidence": "high"}},
}


def _data(records):
    return {"module": "employee_central", "findings": [
        {"check_id": "EC-001", "severity": "high", "dimension": "validity", "affected_count": 2, "total_count": 10,
         "pass_rate": 80.0, "field": "PERINFO.GENDER", "message": "", "value_fix_map": {"X": {"suggested_value": "U"}},
         "record_fixes": [{"record_key": "PERSON_ID=P2", "proposed_value": "F", "confidence": "high",
                           "fix_instruction": "Stored instruction"}]},
        {"check_id": "EC-002", "severity": "critical", "dimension": "consistency", "affected_count": 1,
         "total_count": 10, "pass_rate": 90.0, "field": "PERINFO.FIRSTNAME", "message": "", "value_fix_map": {},
         "record_fixes": []},
    ], "records": records}


RECS = [
    {"check_id": "EC-001", "grain": "PERINFO", "record_key": "PERSON_ID=P1", "field_values": {"PERINFO.GENDER": "X"}},
    {"check_id": "EC-001", "grain": "PERINFO", "record_key": "PERSON_ID=P2", "field_values": {"PERINFO.GENDER": ""}},
    {"check_id": "EC-002", "grain": "PERINFO", "record_key": "PERSON_ID=P3",
     "field_values": {"PERINFO.FIRSTNAME": " Ann "}},
]


def _records_sheet(sheets):
    return next(s for s in sheets if s.title.startswith("Records"))


def test_rows_suggestions_and_instructions():
    sheets, counts = cw.cleaning_context(_data(RECS), RULES)
    rows = list(_records_sheet(sheets).rows)
    assert counts == {"rules": 2, "records": 3, "suggested": 3}
    assert [r["rule"] for r in rows] == ["EC-002", "EC-001", "EC-001"]  # critical first
    trim, p1, p2 = rows
    assert (trim["suggested"], trim["source"]) == ("Ann", "Rule auto-fix")
    assert (p1["suggested"], p1["source"]) == ("U", "Value suggestion")
    assert p1["instruction"] == "Employee P1: Replace 'X'."  # template filled from the record key
    assert (p2["suggested"], p2["source"], p2["instruction"]) == ("F", "Run proposal", "Stored instruction")
    assert p2["why"].startswith("The value is blank")
    assert all(r["status"] == "Open" and r["corrected"] == "" for r in rows)


def test_instructions_sheet_lists_fix_steps():
    sheets, _ = cw.cleaning_context(_data(RECS), RULES)
    instr = {r["rule"]: r for r in next(s for s in sheets if s.title == "Instructions").rows}
    assert instr["EC-001"]["steps"].splitlines() == ["1. When blank: Set gender in Personal Information.",
                                                     "2. Any other value: Replace 'the value'."]
    assert instr["EC-002"]["auto"] == "strip (confidence high)"


def test_multi_field_value_and_no_invented_suggestion():
    rec = [{"check_id": "EC-001", "grain": "JOBAPPLICATION", "record_key": "APP_ID=A1",
            "field_values": {"JOBAPPLICATION.A": "1", "JOBAPPLICATION.B": None}}]
    data = _data(rec)
    data["findings"][0]["field"] = None
    rules = {"EC-001": {**RULES["EC-001"], "field": None}}
    rows = list(_records_sheet(cw.cleaning_context(data, rules)[0]).rows)
    assert rows[0]["current"] == "JOBAPPLICATION.A=1; JOBAPPLICATION.B="
    assert rows[0]["suggested"] == ""


def test_large_module_splits_records(monkeypatch):
    monkeypatch.setattr(cw, "ROW_CAP", 2)
    sheets, counts = cw.cleaning_context(_data(RECS), RULES)
    titles = [s.title for s in sheets]
    assert titles[-2:] == ["Records to clean 1", "Records to clean 2"] and counts["records"] == 3


def test_renders_xlsx_with_status_dropdown():
    sheets, _ = cw.cleaning_context(_data(RECS), RULES)
    body = build_workbook(tenant_name="T", run_label="R", run_id="r", title="Cleaning", sheets=sheets)
    wb = openpyxl.load_workbook(io.BytesIO(body))
    assert {"How to use", "Summary", "Instructions", "Records to clean"} <= set(wb.sheetnames)
    assert wb["Records to clean"].data_validations.dataValidation


def test_listed_note_flags_partial_lists():
    from api.services.cleaning_workbook import listed_note

    assert listed_note(10, 10) == ""
    assert listed_note(0, 0) == ""
    note = listed_note(344_795, 99_871)
    assert "244,924 of 344,795" in note and "rerun" in note


def test_sf_keys_carry_unique_ids():
    import yaml

    d = yaml.safe_load(open("sap/dictionaries/canonical/successfactors.yaml"))
    t = d.get("tables", d)
    assert "APPLICATION_ID" in t["JOBAPPLICATION"]["keys"]
    assert "FORM_DATA_ID" in t["PMREVIEWRESULT"]["keys"]
    assert "PROCESS_ID" in t["ONBOARDINGCANDIDATEINFO"]["keys"]

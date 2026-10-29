"""The fix sheet in business words (api/services/fix_sheet.py, api/routes/work.py _readable): key columns named by
SAP with their technical names, the record's name under its object's heading, the field's description beside its
SAP name, possible values with meanings, and the ids the import reads kept at the end."""
import io

import openpyxl

from api.routes.work import _readable
from api.services.branded_xlsx import SheetSpec, build_workbook
from api.services.fix_sheet import possible_values, readable_key, split_key


def _row(key: str, module: str = "material_master", **kw) -> dict:
    return {"module": module, "record_key": key, "name": "Hex bolt M8", "check_id": "MM014", "severity": "high",
            "message": "Unit is not valid", "field": "MARA.MEINS", "rule_module": module,
            "valid_values": {"EA": "each", "KG": "kilogram"}, "current_value": "ST", "suggested_value": "EA",
            "new_value": None, "decision": None, "reason": None, **kw}


def test_one_object_gets_sap_named_key_columns_and_readable_values():
    cols, rows = _readable([_row("MATNR=000000000000000101|WERKS=3000")])
    headers = [c.header for c in cols]
    assert headers[:5] == ["Material number (MATNR)", "Plant (WERKS)", "Material name", "Field description", "SAP field"]
    assert headers[-3:] == ["Object", "Record", "Check"]  # the import's headers, unchanged
    r = rows[0]
    assert (r["key:MATNR"], r["key:WERKS"]) == ("000000000000000101", "3000")
    assert (r["field_name"], r["sap_field"]) == ("Base unit of measure", "MARA-MEINS")
    assert r["possible"] == "EA (each), KG (kilogram)"
    assert (r["current_text"], r["suggested_text"]) == ("ST", "EA (each)")


def test_mixed_objects_keep_the_record_as_one_readable_text():
    cols, rows = _readable([_row("MATNR=1|WERKS=3000"), _row("LIFNR=7|BUKRS=1000", module="accounts_payable")])
    headers = [c.header for c in cols]
    assert headers[:3] == ["Object name", "Key", "Material name"]
    assert rows[1]["record_text"] == "Vendor number 7, Company code 1000"
    assert rows[1]["object_name"] != "accounts_payable"


def test_workbook_keeps_leading_zeros_and_offers_the_decisions():
    cols, rows = _readable([_row("MATNR=000000000000000101|WERKS=3000")])
    wb = openpyxl.load_workbook(io.BytesIO(build_workbook(
        tenant_name="T", run_label=None, run_id="r", title="Fix sheet", sheets=[SheetSpec("Fix sheet", cols, rows)])))
    ws = wb["Fix sheet"]
    assert ws["A2"].value == "000000000000000101"
    assert any('"fix,not an issue,accept risk"' in (dv.formula1 or "") for dv in ws.data_validations.dataValidation)


def test_long_value_lists_are_capped_and_keys_split():
    assert possible_values([{"value": str(i), "label": None} for i in range(25)]).endswith("and 5 more")
    assert split_key("000101") == [("", "000101")] and readable_key("000101") == "000101"

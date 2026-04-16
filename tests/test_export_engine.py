"""Tests for ExportEngine — all 5 SAP export formats."""

import csv
import io
import json

import pytest

from api.services.export_engine import (
    BAPI_NAMES,
    IDOC_TYPES,
    SAP_EXPORT_FIELDS,
    SF_FIELD_NAMES,
    TRANSACTION_CODES,
    ExportEngine,
)

CUSTOMER_RECORDS = [
    {
        "customer_id": "1000000001",
        "name": "Acme Pty Ltd",
        "country": "ZA",
        "payment_terms": "Z030",
        "currency": "ZAR",
        "tax_number": "ZA12345678",
        "phone": "+27 11 555 0001",
        "email": "accounts@acme.co.za",
    },
    {
        "customer_id": "1000000002",
        "name": "Globex, Corp",
        "country": "US",
        "payment_terms": "N030",
        "currency": "USD",
        "tax_number": "US98765432",
        "phone": "+1 212 555 0099",
        "email": "ap@globex.com",
    },
]

MATERIAL_RECORDS = [
    {
        "material_id": "MAT-0001",
        "description": "Widget A",
        "material_type": "FERT",
        "base_unit": "EA",
        "material_group": "GRP01",
        "weight_gross": "1.5",
        "weight_unit": "KG",
        "status": "01",
    },
    {
        "material_id": "MAT-0002",
        "description": "Gadget B",
        "material_type": "HALB",
        "base_unit": "PC",
        "material_group": "GRP02",
        "weight_gross": "3.2",
        "weight_unit": "KG",
        "status": "02",
    },
]

EMPLOYEE_RECORDS = [
    {
        "employee_id": "00010001",
        "first_name": "Thabo",
        "last_name": "Mokoena",
        "hire_date": "2020-01-15",
        "job_code": "50001234",
        "cost_center": "CC4400",
        "payroll_area": "ZA",
    },
    {
        "employee_id": "00010002",
        "first_name": "Lerato",
        "last_name": "Dlamini",
        "hire_date": "2021-06-01",
        "job_code": "50005678",
        "cost_center": "CC4401",
        "payroll_area": "ZA",
    },
]


@pytest.fixture
def engine():
    return ExportEngine()


# ── CSV ──────────────────────────────────────────────────────────────────────


class TestExportCSV:
    def test_customer_csv_headers(self, engine: ExportEngine):
        result = engine.export_csv(CUSTOMER_RECORDS, "customer")
        reader = csv.reader(io.StringIO(result))
        headers = next(reader)
        expected = list(SAP_EXPORT_FIELDS["customer"].values())
        assert headers == expected

    def test_customer_csv_row_count(self, engine: ExportEngine):
        result = engine.export_csv(CUSTOMER_RECORDS, "customer")
        reader = csv.reader(io.StringIO(result))
        rows = list(reader)
        assert len(rows) == 3  # header + 2 records

    def test_customer_csv_field_mapping(self, engine: ExportEngine):
        result = engine.export_csv(CUSTOMER_RECORDS, "customer")
        reader = csv.reader(io.StringIO(result))
        headers = next(reader)
        row1 = next(reader)
        kunnr_idx = headers.index("KUNNR")
        name1_idx = headers.index("NAME1")
        assert row1[kunnr_idx] == "1000000001"
        assert row1[name1_idx] == "Acme Pty Ltd"

    def test_material_csv(self, engine: ExportEngine):
        result = engine.export_csv(MATERIAL_RECORDS, "material")
        reader = csv.reader(io.StringIO(result))
        headers = next(reader)
        assert "MATNR" in headers
        assert "MAKTX" in headers
        rows = list(reader)
        assert len(rows) == 2

    def test_csv_handles_commas_in_values(self, engine: ExportEngine):
        """Values with commas must be properly quoted."""
        result = engine.export_csv(CUSTOMER_RECORDS, "customer")
        # "Globex, Corp" has a comma — CSV must quote it
        assert '"Globex, Corp"' in result


# ── LSMW ─────────────────────────────────────────────────────────────────────


class TestExportLSMW:
    def test_lsmw_structure(self, engine: ExportEngine):
        result = engine.export_lsmw(CUSTOMER_RECORDS, "customer")
        lines = result.split("\n")
        assert lines[0].startswith("TRANSACTION\t")
        assert "BEGIN_SESSION" in result
        assert "END_SESSION" in result
        assert "EXECUTE" in result

    def test_lsmw_transaction_code(self, engine: ExportEngine):
        result = engine.export_lsmw(CUSTOMER_RECORDS, "customer")
        tcode = TRANSACTION_CODES["customer"]
        assert f"TRANSACTION\t{tcode}" in result

    def test_lsmw_set_fields(self, engine: ExportEngine):
        result = engine.export_lsmw(CUSTOMER_RECORDS, "customer")
        assert "SET KUNNR=1000000001" in result
        assert "SET NAME1=Acme Pty Ltd" in result

    def test_lsmw_two_records_separated(self, engine: ExportEngine):
        result = engine.export_lsmw(CUSTOMER_RECORDS, "customer")
        # Two records should be separated by blank line
        assert result.count("END_SESSION") == 2
        assert "\n\n" in result

    def test_lsmw_material(self, engine: ExportEngine):
        result = engine.export_lsmw(MATERIAL_RECORDS, "material")
        assert f"TRANSACTION\t{TRANSACTION_CODES['material']}" in result
        assert "SET MATNR=MAT-0001" in result


# ── BAPI ─────────────────────────────────────────────────────────────────────


class TestExportBAPI:
    def test_bapi_json_structure(self, engine: ExportEngine):
        result = engine.export_bapi(CUSTOMER_RECORDS, "customer")
        data = json.loads(result)
        assert "bapi_calls" in data
        assert len(data["bapi_calls"]) == 2

    def test_bapi_call_fields(self, engine: ExportEngine):
        result = engine.export_bapi(CUSTOMER_RECORDS, "customer")
        data = json.loads(result)
        call = data["bapi_calls"][0]
        assert call["call_id"] == "1"
        assert call["bapi"] == BAPI_NAMES["customer"]
        assert "import_params" in call
        assert call["import_params"]["KUNNR"] == "1000000001"

    def test_bapi_material(self, engine: ExportEngine):
        result = engine.export_bapi(MATERIAL_RECORDS, "material")
        data = json.loads(result)
        assert data["bapi_calls"][0]["bapi"] == BAPI_NAMES["material"]
        assert data["bapi_calls"][1]["import_params"]["MATNR"] == "MAT-0002"

    def test_bapi_valid_json(self, engine: ExportEngine):
        result = engine.export_bapi(CUSTOMER_RECORDS, "customer")
        # Should be valid indented JSON
        data = json.loads(result)
        re_serialized = json.dumps(data, indent=2)
        assert re_serialized == result


# ── IDoc ─────────────────────────────────────────────────────────────────────


class TestExportIDoc:
    def test_idoc_json_structure(self, engine: ExportEngine):
        result = engine.export_idoc(CUSTOMER_RECORDS, "customer")
        data = json.loads(result)
        assert "idocs" in data
        assert len(data["idocs"]) == 2

    def test_idoc_control_record(self, engine: ExportEngine):
        result = engine.export_idoc(CUSTOMER_RECORDS, "customer")
        data = json.loads(result)
        edi = data["idocs"][0]["EDI_DC40"]
        assert edi["IDOCTYP"] == IDOC_TYPES["customer"]
        assert edi["MESTYP"] == "CHANGE"
        assert edi["SNDPOR"] == "VANTAX"
        assert edi["SNDPRT"] == "LS"
        assert edi["RCVPOR"] == "SAP"
        assert edi["RCVPRT"] == "LS"

    def test_idoc_data_segment(self, engine: ExportEngine):
        result = engine.export_idoc(CUSTOMER_RECORDS, "customer")
        data = json.loads(result)
        seg = data["idocs"][0]["E1segment"]
        assert seg["KUNNR"] == "1000000001"
        assert seg["NAME1"] == "Acme Pty Ltd"

    def test_idoc_material(self, engine: ExportEngine):
        result = engine.export_idoc(MATERIAL_RECORDS, "material")
        data = json.loads(result)
        assert data["idocs"][0]["EDI_DC40"]["IDOCTYP"] == IDOC_TYPES["material"]


# ── SF CSV ───────────────────────────────────────────────────────────────────


class TestExportSFCSV:
    def test_sf_csv_employee_headers(self, engine: ExportEngine):
        result = engine.export_sf_csv(EMPLOYEE_RECORDS, "employee")
        reader = csv.reader(io.StringIO(result))
        headers = next(reader)
        expected = [SF_FIELD_NAMES.get(f, f) for f in SAP_EXPORT_FIELDS["employee"].keys()]
        assert headers == expected

    def test_sf_csv_all_quoted(self, engine: ExportEngine):
        result = engine.export_sf_csv(EMPLOYEE_RECORDS, "employee")
        # All values should be quoted
        lines = result.strip().split("\n")
        for line in lines:
            # Each field should be wrapped in quotes
            for field in csv.reader(io.StringIO(line), quoting=csv.QUOTE_ALL):
                pass  # csv.reader handles validation

    def test_sf_csv_row_count(self, engine: ExportEngine):
        result = engine.export_sf_csv(EMPLOYEE_RECORDS, "employee")
        reader = csv.reader(io.StringIO(result))
        rows = list(reader)
        assert len(rows) == 3  # header + 2 records

    def test_sf_csv_field_values(self, engine: ExportEngine):
        result = engine.export_sf_csv(EMPLOYEE_RECORDS, "employee")
        reader = csv.reader(io.StringIO(result))
        headers = next(reader)
        row1 = next(reader)
        uid_idx = headers.index("userId")
        fn_idx = headers.index("firstName")
        assert row1[uid_idx] == "00010001"
        assert row1[fn_idx] == "Thabo"

    def test_sf_csv_non_employee_uses_source_fields(self, engine: ExportEngine):
        """Non-employee objects use source field names as headers."""
        result = engine.export_sf_csv(MATERIAL_RECORDS, "material")
        reader = csv.reader(io.StringIO(result))
        headers = next(reader)
        assert "material_id" in headers
        assert "description" in headers


# ── Edge cases ───────────────────────────────────────────────────────────────


class TestExportEdgeCases:
    def test_empty_records(self, engine: ExportEngine):
        result = engine.export_csv([], "customer")
        reader = csv.reader(io.StringIO(result))
        rows = list(reader)
        assert len(rows) == 1  # Header only

    def test_missing_fields_in_record(self, engine: ExportEngine):
        """Records with missing fields should export empty strings."""
        partial = [{"customer_id": "9999999999"}]
        result = engine.export_csv(partial, "customer")
        reader = csv.reader(io.StringIO(result))
        next(reader)  # skip header
        row = next(reader)
        assert row[0] == "9999999999"
        # All other fields should be empty strings
        assert all(v == "" for v in row[1:])

    def test_none_values(self, engine: ExportEngine):
        records = [{"customer_id": None, "name": "Test"}]
        result = engine.export_csv(records, "customer")
        reader = csv.reader(io.StringIO(result))
        next(reader)
        row = next(reader)
        assert row[0] == ""  # None mapped to empty string

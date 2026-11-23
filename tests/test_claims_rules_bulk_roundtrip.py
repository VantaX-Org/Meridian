"""Claim: the rules workbook / YAML Meridian exports imports back; the export cap equals the import cap."""
import asyncio
import base64
import io
import types

import openpyxl
import yaml

from api.routes import admin_tools as at

SRC = "id: r1\nname: Plant set\nseverity: high\n"
ROW = {"module": "material_master", "name": "Plant set", "description": "why", "category": "c", "severity": "high",
       "enabled": True, "source_yaml": SRC, "source": "tenant"}


class _Res:
    def mappings(self): return self
    def all(self): return [ROW]


class _Db:
    async def execute(self, q, params=None):
        self.params = params
        return _Res()


def _export(fmt):
    db = _Db()
    tenant = types.SimpleNamespace(id="00000000-0000-0000-0000-000000000001", name="T")
    return asyncio.run(at.export_rules_bulk(fmt, None, db, tenant)), db


def test_xlsx_export_parses_back_to_the_same_rule():
    resp, db = _export("xlsx")
    assert db.params["cap"] == at.BULK_MAX
    assert openpyxl.load_workbook(io.BytesIO(resp.body))
    rows = at.parse_bulk("xlsx", base64.b64encode(resp.body).decode(), None)
    assert rows[0]["module"] == "material_master" and yaml.safe_load(rows[0]["rule_yaml"]) == yaml.safe_load(SRC)


def test_yaml_export_parses_back_to_the_same_rule():
    resp, _ = _export("yaml")
    rows = at.parse_bulk("yaml", resp.body.decode(), None)
    assert rows[0]["module"] == "material_master" and yaml.safe_load(rows[0]["rule_yaml"])["name"] == "Plant set"

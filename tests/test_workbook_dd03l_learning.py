"""An SAP workbook column the dictionary lacks is resolved against the system's DD03L."""
from unittest.mock import MagicMock

import pandas as pd

from api.services.migration import workbook as wb
from api.services.source_design import with_learned
from sap import ddic_reader
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
SCOPE = {"MARA", "MARC", "MAKT"}
# Synthetic customer-append fields: ZZFOO on MARA only, ZZBAR on MARA and MARC, ZZNONE nowhere.
DD03L = pd.DataFrame({"TABNAME": ["MARA", "MARA", "MARC"], "FIELDNAME": ["ZZFOO", "ZZBAR", "ZZBAR"]})


def book(*ids):
    cols = ["MATNR", "MTART", *ids]
    return wb.Workbook([wb.Sheet("Material Data", "grid", [wb.Column(header=i, id=i) for i in cols])], {}, None)


def connector():
    conn = MagicMock()
    conn.read_table_full.return_value = DD03L
    return conn


def lookup(system_id, conn, opened):
    def connect():
        opened.append(1)
        return conn
    return lambda ts, fs: ddic_reader.known_fields(system_id, ts, fs, connect)


def test_unique_match_is_learned_as_table_field_and_extracted_next():
    ddic_reader._DD03L.clear()
    conn, opened = connector(), []
    learned, unresolved = wb.learn_sap(book("ZZFOO"), D, SCOPE, lookup("sys-a", conn, opened))
    assert learned == {"MARA": {"ZZFOO": "MARA.ZZFOO"}} and unresolved == {}
    table, fields, keys = conn.read_table_full.call_args.args
    where = conn.read_table_full.call_args.kwargs["where"]
    assert (table, fields, keys) == ("DD03L", ["TABNAME", "FIELDNAME"], ["TABNAME"])
    assert "TABNAME IN (" in where and "FIELDNAME IN ('ZZFOO')" in where and "AS4LOCAL = 'A'" in where
    conn.close.assert_called_once()
    d = with_learned(D, learned)
    f = d.field("MARA", "ZZFOO")
    assert f.provenance == "workbook" and f.source is None  # no entity, so the sheet stays a by-field sheet
    assert "ZZFOO" in wb._candidates(book("ZZFOO").sheets[0], d)["MARA"]


def test_ambiguous_and_missing_fields_are_reported_not_guessed():
    from api.routes.migration import _learned_pending, _mark_learned

    ddic_reader._DD03L.clear()
    learned, unresolved = wb.learn_sap(book("ZZBAR", "ZZNONE", "MAKT-ZZFOO"), D, SCOPE,
                                       lookup("sys-b", connector(), []))
    assert learned == {}
    assert unresolved == {"ZZBAR": ["MARA", "MARC"], "ZZNONE": [], "MAKT-ZZFOO": []}
    report = {"sheets": [{"unmapped": [{"id": "ZZBAR"}, {"id": "ZZNONE"}, {"id": "MAKT-ZZFOO"}]}]}
    assert _mark_learned(report, _learned_pending({}, D), unresolved) == (0, 2)
    bar, none, named = report["sheets"][0]["unmapped"]
    assert bar["candidates"] == ["MARA", "MARC"] and not bar["not_in_system"] and not bar["learned"]
    assert none["not_in_system"] and named["not_in_system"] and "candidates" not in none


def test_named_table_outside_scope_is_asked_and_learned():
    ddic_reader._DD03L.clear()
    conn, opened = MagicMock(), []
    conn.read_table_full.return_value = pd.DataFrame({"TABNAME": ["LFA1"], "FIELDNAME": ["ZZFOO"]})
    learned, unresolved = wb.learn_sap(book("LFA1-ZZFOO"), D, SCOPE, lookup("sys-c", conn, opened))
    assert learned == {"LFA1": {"ZZFOO": "LFA1.ZZFOO"}} and unresolved == {}
    assert opened == [1]


def test_hit_on_table_the_dictionary_lacks_is_learned():
    ddic_reader._DD03L.clear()
    conn = MagicMock()
    conn.read_table_full.return_value = pd.DataFrame({"TABNAME": ["ZZTAB"], "FIELDNAME": ["ZZFOO"]})
    learned, unresolved = wb.learn_sap(book("ZZTAB-ZZFOO", "ZZTAB-ZZNONE"), D, SCOPE, lookup("sys-f", conn, []))
    # the caller reads ZZTAB's definition from the DDIC, so the next extraction reads the table
    assert learned == {"ZZTAB": {"ZZFOO": "ZZTAB.ZZFOO"}} and unresolved == {"ZZTAB-ZZNONE": []}


def test_lookups_are_cached_per_system():
    ddic_reader._DD03L.clear()
    conn, opened = connector(), []
    look = lookup("sys-d", conn, opened)
    first = wb.learn_sap(book("ZZFOO", "ZZNONE"), D, SCOPE, look)
    assert wb.learn_sap(book("ZZFOO", "ZZNONE"), D, SCOPE, look) == first
    assert opened == [1] and conn.read_table_full.call_count == 1
    wb.learn_sap(book("ZZFOO"), D, SCOPE, lookup("sys-e", conn, opened))  # another system reads its own DD03L
    assert opened == [1, 1]


def test_learned_sap_field_waits_for_the_next_run():
    from api.routes.migration import _learned_pending

    d = with_learned(D, {"MARA": {"ZZFOO": "MARA.ZZFOO"}})
    assert _learned_pending({}, d) == {"ZZFOO": False, "MARA-ZZFOO": False, "MARA.ZZFOO": False}


def test_learned_field_on_unplanned_table_is_planned_for_extraction():
    from sap.extraction_plan import plan_modules

    assert "ZZFOO" not in plan_modules(["material_master"], D).get("LFA1", type("P", (), {"fields": set()})).fields
    plans = plan_modules(["material_master"], with_learned(D, {"LFA1": {"ZZFOO": "LFA1.ZZFOO"}}))
    assert "ZZFOO" in plans["LFA1"].fields and plans["LFA1"].keys == list(D.keys("LFA1"))
    assert "material_master" in plans["LFA1"].modules

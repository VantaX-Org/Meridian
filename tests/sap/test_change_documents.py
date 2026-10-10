"""Change-document delta helpers (sap/change_documents.py) and the IN-list chunker."""

import pandas as pd

from sap.ddic import get_dictionary
from sap.extraction_plan import in_lists
from sap.rfc import where_options


def test_in_lists_chunks_dedups_and_escapes():
    assert in_lists("MATNR", ["B", "A", " A ", "", "O'K"], chunk=2) == ["MATNR IN ('A','B')", "MATNR IN ('O''K')"]


def test_in_lists_lines_fit_rfc_options():
    clauses = in_lists("MATNR", [f"{i:040d}" for i in range(200)])
    assert len(clauses) == 4
    assert all(len(o["TEXT"]) <= 72 for c in clauses for o in where_options(c))


def test_in_lists_of_nothing_is_no_clause():
    assert in_lists("LIFNR", []) == []


from sap.change_documents import (
    cdhdr_where, changed_keys, class_of, delta_tables, merge_delta, since_date,
)


def test_class_of_maps_master_tables_and_leaves_stock_tables_out():
    assert class_of("MARC") == ("MATERIAL", "MATNR")
    assert class_of("KNVV") == ("DEBI", "KUNNR")
    assert class_of("LFB1") == ("KRED", "LIFNR")
    assert class_of("MBEW") is None and class_of("MARD") is None and class_of("BKPF") is None


def test_cdhdr_where_uses_the_class_prefix_and_fits_options():
    w = cdhdr_where("MATERIAL", "20261008")
    assert w == "OBJECTCLAS = 'MATERIAL' AND UDATE >= '20261008'"
    assert all(len(o["TEXT"]) <= 72 for o in where_options(w))


def test_since_date_is_a_day_before_the_baseline_start():
    assert since_date("2026-10-09T01:00:00+00:00") == "20261008"
    assert since_date("2026-01-01T00:00:00+00:00") == "20251231"


def test_changed_keys_groups_object_ids_by_class():
    cdhdr = pd.DataFrame({"OBJECTCLAS": ["MATERIAL", "MATERIAL", "KRED ", "BELEG"],
                          "OBJECTID": ["M1", "M1 ", "V9", "X"]})
    assert changed_keys(cdhdr) == {"MATERIAL": {"M1"}, "DEBI": set(), "KRED": {"V9"}}


def test_delta_tables_needs_the_class_key_among_the_ddic_keys():
    got = delta_tables(["MARA", "MARC", "MBEW", "T001", "LFB1"], get_dictionary("ecc6"))
    assert got == {"MARA": ("MATERIAL", "MATNR"), "MARC": ("MATERIAL", "MATNR"), "LFB1": ("KRED", "LIFNR")}


def test_merge_delta_replaces_changed_adds_created_drops_deleted():
    baseline = pd.DataFrame({"MATNR": ["A", "B", "C"], "MTART": ["FERT", "HALB", "ROH"]})
    fresh = pd.DataFrame({"MATNR": ["B", "D"], "MTART": ["FERT", "HAWA"]})  # C deleted, D created
    out = merge_delta(baseline, fresh, "MATNR", {"B", "C", "D"})
    assert sorted(map(tuple, out.values.tolist())) == [("A", "FERT"), ("B", "FERT"), ("D", "HAWA")]

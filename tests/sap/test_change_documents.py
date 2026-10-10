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

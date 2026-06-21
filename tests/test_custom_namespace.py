"""Tests for sap/custom_namespace.py — SAP customer-namespace (Z/Y) detection.

The module recognises customer-created objects purely from SAP's namespace
rules — no hardcoded customer names (which Meridian must never guess). These
tests pin the rules: Z/Y repository objects, ZZ/YY append fields, /NS/ partner
namespaces, the T9* customizing range, and the observed-vs-known transaction
partition.
"""

from __future__ import annotations

import pytest

from sap.custom_namespace import (
    TransactionPartition,
    field_tail,
    is_custom_field,
    is_custom_object,
    is_custom_table,
    is_custom_transaction,
    partition_transactions,
    table_part,
)


# ── Field-name helpers ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "qualified,expected",
    [
        ("LFA1.ZZRISK", "ZZRISK"),
        ("LFA1-ZZRISK", "ZZRISK"),
        ("STRUCT~ZZRISK", "ZZRISK"),
        ("ZZRISK", "ZZRISK"),
        ("lfa1.zzrisk", "ZZRISK"),  # normalised to upper
        ("  LFA1.ZZRISK  ", "ZZRISK"),  # stripped
        (None, ""),
    ],
)
def test_field_tail(qualified, expected):
    assert field_tail(qualified) == expected


@pytest.mark.parametrize(
    "qualified,expected",
    [
        ("LFA1.ZZRISK", "LFA1"),
        ("LFA1-ZZRISK", "LFA1"),
        ("ZZTABLE", "ZZTABLE"),  # no separator → whole token is the table
        ("zfa1.field", "ZFA1"),
        (None, ""),
    ],
)
def test_table_part(qualified, expected):
    assert table_part(qualified) == expected


# ── Custom field detection ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name",
    [
        "ZZRISK_CLASS",      # ZZ append field
        "YYFLAG",            # YY append field
        "ZSEGMENT",          # single-Z custom field
        "LFA1.ZZRISK",       # qualified, dotted
        "LFA1-ZZRISK",       # qualified, dashed
        "/ACME/FIELD",       # partner namespace
        "zzrisk_class",      # case-insensitive
    ],
)
def test_is_custom_field_true(name):
    assert is_custom_field(name) is True


@pytest.mark.parametrize(
    "name",
    [
        "NAME1",         # standard field
        "LFA1.NAME1",    # standard, qualified
        "TELF1",
        "KTOKK",
        "",
        None,
        "ANYTHING",      # standard-namespace word that merely contains no Z/Y prefix
    ],
)
def test_is_custom_field_false(name):
    assert is_custom_field(name) is False


# ── Custom table detection ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name",
    [
        "ZVENDOR_EXT",   # Z table
        "YCUSTOM",       # Y table
        "/ACME/ORDERS",  # partner namespace table
        "T900",          # customer customizing range
        "T999",
        "T950",
        "ZTABLE.FIELD",  # qualified — table part is custom
    ],
)
def test_is_custom_table_true(name):
    assert is_custom_table(name) is True


@pytest.mark.parametrize(
    "name",
    [
        "LFA1",          # standard table
        "KNA1",
        "T001",          # standard config table (not in T9* range)
        "T800",          # below the customer range
        "T9000",         # 5 chars — not the 4-char T9xx range
        "T9AB",          # T9 + non-digits
        "",
        None,
    ],
)
def test_is_custom_table_false(name):
    assert is_custom_table(name) is False


# ── Custom transaction detection ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "tcode",
    ["ZME21N", "YORDER", "/ACME/POST", "zfb01", "  ZXYZ  "],
)
def test_is_custom_transaction_true(tcode):
    assert is_custom_transaction(tcode) is True


@pytest.mark.parametrize(
    "tcode",
    ["ME21N", "VA01", "FK01", "MIRO", "", None],
)
def test_is_custom_transaction_false(tcode):
    assert is_custom_transaction(tcode) is False


# ── Catch-all object detection ───────────────────────────────────────────────


def test_is_custom_object_matches_table_or_field():
    assert is_custom_object("ZVENDOR_EXT") is True       # custom table
    assert is_custom_object("LFA1.ZZRISK") is True        # custom field tail
    assert is_custom_object("T900") is True               # customizing range
    assert is_custom_object("LFA1.NAME1") is False        # standard through-and-through
    assert is_custom_object("LFA1") is False


# ── Transaction partitioning ─────────────────────────────────────────────────


def test_partition_splits_known_custom_unknown():
    observed = ["ME21N", "ZME21N", "VA01", "ZCUSTOM", "FB99", "me21n"]
    known = ["ME21N", "VA01", "F110"]
    part = partition_transactions(observed, known)

    assert isinstance(part, TransactionPartition)
    assert part.known == ["ME21N", "VA01"]           # me21n de-duped into ME21N
    assert part.custom == ["ZCUSTOM", "ZME21N"]      # sorted, customer-namespace
    assert part.unknown_standard == ["FB99"]         # standard but unmodelled
    assert part.has_custom is True


def test_partition_known_wins_over_custom_namespace():
    # A Z t-code that IS in the known set is "known", not "custom" — a customer
    # transaction Meridian explicitly modelled should not be re-flagged.
    part = partition_transactions(["ZSPECIAL"], known=["ZSPECIAL"])
    assert part.known == ["ZSPECIAL"]
    assert part.custom == []
    assert part.has_custom is False


def test_partition_empty_and_blank_inputs():
    part = partition_transactions(["", None, "  "], known=[])
    assert part.known == []
    assert part.custom == []
    assert part.unknown_standard == []
    assert part.has_custom is False


def test_partition_dedupes_within_bucket():
    part = partition_transactions(["ZA", "ZA", "za", "ZB"], known=[])
    assert part.custom == ["ZA", "ZB"]


# ── Integration with the shipped process definitions ─────────────────────────


def test_partition_against_real_known_tcodes():
    from sap.process_definitions import get_all_tcodes

    known = get_all_tcodes()
    assert known, "process definitions must model at least one t-code"

    # A real modelled t-code lands in known; a Z variant lands in custom.
    sample = sorted(known)[0]
    part = partition_transactions([sample, "Z" + sample, "FZ99"], known)
    assert sample in part.known
    assert ("Z" + sample) in part.custom

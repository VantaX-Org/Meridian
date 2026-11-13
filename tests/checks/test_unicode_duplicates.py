"""Duplicate and near-duplicate keys across scripts (synthetic names only)."""
import pandas as pd

from checks.types.similarity_check import SimilarityCheck
from checks.types.uniqueness_check import UniquenessCheck
from checks.value_placement import name_key

UNIQ = {"id": "T", "field": "T.NAME", "fields": ["T.NAME"], "normalize": "name", "check_class": "uniqueness_check"}


def _dups(names):
    return UniquenessCheck(UNIQ).evaluate(pd.DataFrame({"T.NAME": names}))


def test_distinct_non_latin_names_are_not_duplicates():
    ev = _dups(["شركة النور", "شركة الأمل", "Иван Петров", "Пётр Иванов", "王小明", "李小红", "हिन्दी"])
    assert not ev.failing.any() and ev.population.all()


def test_true_non_latin_duplicates_are_found():
    ev = _dups(["Иван Петров", "ИВАН ПЕТРОВ.", "شركة النور", "شركة النور Ltd", "王小明", "王小明", "Other"])
    assert ev.failing.tolist() == [True] * 6 + [False]


def test_fullwidth_and_case_fold_to_one_key():
    assert name_key(pd.Series(["ＡＣＭＥ (Pty) Ltd.", "acme", "Straße", "STRASSE"])).tolist() == \
        ["acme", "acme", "strasse", "strasse"]


def test_names_that_normalise_to_nothing_are_not_compared():
    ev = _dups(["Ltd.", "---", "Pty Ltd"])
    assert not ev.failing.any() and not ev.population.any()


def test_alnum_key_keeps_non_latin_identifiers_apart():
    rule = {**UNIQ, "normalize": "alnum"}
    ev = UniquenessCheck(rule).evaluate(pd.DataFrame({"T.NAME": ["АБ-123", "ВГ-123", "ab 123", "AB123"]}))
    assert ev.failing.tolist() == [False, False, True, True]


def test_similarity_matches_accented_and_reports_short_names():
    rule = {"id": "S", "field": "T.NAME", "block_by": ["T.LAND"], "check_class": "similarity_check"}
    df = pd.DataFrame({"T.NAME": ["Müller Engineering", "Muller Engineering", "Петров Сервис", "Иванов Сервис",
                                  "王小明", "王小明"],
                       "T.LAND": ["DE", "DE", "RU", "RU", "CN", "CN"]})
    ev = SimilarityCheck(rule).evaluate(df)
    assert ev.failing.tolist() == [True, True, False, False, False, False]
    assert ev.details["records_too_short_to_compare"] == 2

"""Near-duplicate records: names that differ only by a typo, word order or
spacing inside the same block (country + postal code for partners, material
group + type for materials). Exact duplicates are uniqueness_check's job; this
finds the ones a key comparison misses ('ACME ENGINEERING' / 'ACME ENGINERING').

Deterministic: names are compared as legal-form-free, punctuation-free keys
with sorted words, by difflib ratio >= ``threshold`` (default 0.9). Two names
with different numbers are never near-duplicates (M10X20 vs M10X25, Branch 1 vs
Branch 2), and keys shorter than 5 characters are not compared. Identical names
are left to the exact rule only when one exists (``exact_rule: true``, the ND
rules); otherwise they are reported here too. Records in a block larger than
``max_block`` are not compared, so they leave the population (never counted as
passing) and are reported as skipped.

``blocks()`` and ``near_pairs()`` are shared with the match pipeline
(workers/tasks/run_match.py), so a candidate pair there is found exactly as here."""

from collections.abc import Hashable
from difflib import SequenceMatcher
from itertools import combinations

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


def _key(s: pd.Series) -> pd.Series:
    from checks.value_placement import _LEGAL_FORMS
    t = s.astype("string").str.upper().str.replace(r"[^0-9A-Z ]", " ", regex=True)
    t = t.str.replace(_LEGAL_FORMS, " ", regex=True)
    return t.map(lambda v: " ".join(sorted(v.split())) if isinstance(v, str) else "")


def blocks(df: pd.DataFrame, field: str, block_by: list[str],
           max_block: int) -> tuple[list[pd.Index], list[pd.Index]]:
    """Group comparable records by ``block_by``. Returns (kept, oversized) blocks.

    A record is comparable when ``field`` and every block field are populated and its
    compact name key has at least 5 characters. Blocks larger than ``max_block`` are
    returned separately: their records are not compared, so callers report them."""
    from checks.value_placement import name_key
    populated = ~is_blank(df[field])
    for c in block_by:
        populated &= ~is_blank(df[c])
    scope = populated & (name_key(df[field]).fillna("").str.len() >= 5)
    group = (df[block_by].astype("string").apply(lambda s: s.str.strip().str.upper()).agg("|".join, axis=1)
             if block_by else pd.Series("", index=df.index))
    kept: list[pd.Index] = []
    oversized: list[pd.Index] = []
    for _, idx in group[scope].groupby(group[scope]).groups.items():
        (oversized if len(idx) > max_block else kept).append(idx)
    return kept, oversized


def near_pairs(df: pd.DataFrame, field: str, groups: list[pd.Index], threshold: float,
               exact_elsewhere: bool = False) -> list[tuple[Hashable, Hashable, float]]:
    """Index pairs inside each group whose names score >= ``threshold``.

    Names with different numbers never pair. Identical compact keys score 1.0, or are
    skipped when ``exact_elsewhere`` (an exact-duplicate rule reports them)."""
    from checks.value_placement import name_key
    key = _key(df[field])
    compact = name_key(df[field]).fillna("")  # the exact-duplicate rule's own key
    digits = key.str.replace(r"[^0-9]", "", regex=True)
    out: list[tuple[Hashable, Hashable, float]] = []
    for idx in groups:
        for a, b in combinations(idx, 2):
            ka, kb = compact[a], compact[b]
            if digits[a] != digits[b] or (ka == kb and exact_elsewhere):
                continue  # other numbers, other things; identical names: the exact rule's
            score = 1.0 if ka == kb else SequenceMatcher(None, key[a], key[b]).ratio()
            if score >= threshold:
                out.append((a, b, score))
    return out


class SimilarityCheck(BaseCheck):
    check_class = "similarity_check"
    default_dimension = "uniqueness"

    def columns(self) -> list[str]:
        ev = self.rule.get("evidence_key")
        return [self.rule["field"]] + list(self.rule.get("block_by") or []) + ([ev] if ev else [])

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        threshold, max_block = float(r.get("threshold", 0.9)), int(r.get("max_block", 300))
        kept, oversized = blocks(df, r["field"], list(r.get("block_by") or []), max_block)
        # Records in an oversized block are not compared: unknown, not clean, so out of scope.
        scope = pd.Series(df.index.isin([i for g in kept for i in g]), index=df.index)
        failing = pd.Series(False, index=df.index)
        ev_col = r.get("evidence_key") or r["field"]  # evidence_key: show this column's values, not the compared (personal) field
        pairs: list[list[str]] = []
        for a, b, _ in near_pairs(df, r["field"], kept, threshold, bool(r.get("exact_rule"))):
            failing[a] = failing[b] = True
            if len(pairs) < 20:
                pairs.append([str(df.at[a, ev_col]), str(df.at[b, ev_col])])
        return Evaluation(scope, failing, {"near_duplicate_pairs": pairs,
                                           "blocks_skipped_too_large": len(oversized),
                                           "records_not_compared": sum(len(g) for g in oversized),
                                           "threshold": threshold})

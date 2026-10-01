"""Near-duplicate records: names that differ only by a typo, word order or
spacing inside the same block (country + postal code for partners, material
group + type for materials). Exact duplicates are uniqueness_check's job; this
finds the ones a key comparison misses ('ACME ENGINEERING' / 'ACME ENGINERING').

Deterministic: names are compared as legal-form-free, punctuation-free keys
with sorted words, by difflib ratio >= ``threshold`` (default 0.9). Two names
with different numbers are never near-duplicates (M10X20 vs M10X25, Branch 1 vs
Branch 2), and keys shorter than 5 characters are not compared. Blocks larger
than ``max_block`` are skipped and counted, never silently dropped."""

from difflib import SequenceMatcher
from itertools import combinations

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


def _key(s: pd.Series) -> pd.Series:
    from checks.value_placement import _LEGAL_FORMS
    t = s.astype("string").str.upper().str.replace(r"[^0-9A-Z ]", " ", regex=True)
    t = t.str.replace(_LEGAL_FORMS, " ", regex=True)
    return t.map(lambda v: " ".join(sorted(v.split())) if isinstance(v, str) else "")


class SimilarityCheck(BaseCheck):
    check_class = "similarity_check"
    default_dimension = "uniqueness"

    def columns(self) -> list[str]:
        return [self.rule["field"]] + list(self.rule.get("block_by") or [])

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        threshold, max_block = float(r.get("threshold", 0.9)), int(r.get("max_block", 300))
        blocks = list(r.get("block_by") or [])
        populated = ~is_blank(df[r["field"]])
        for c in blocks:
            populated &= ~is_blank(df[c])
        from checks.value_placement import name_key
        key = _key(df[r["field"]])
        compact = name_key(df[r["field"]]).fillna("")  # the exact-duplicate rule's own key
        digits = key.str.replace(r"[^0-9]", "", regex=True)
        group = (df[blocks].astype("string").apply(lambda s: s.str.strip().str.upper()).agg("|".join, axis=1)
                 if blocks else pd.Series("", index=df.index))
        failing = pd.Series(False, index=df.index)
        pairs, skipped = [], 0
        scope = populated & (compact.str.len() >= 5)
        for _, idx in group[scope].groupby(group[scope]).groups.items():
            if len(idx) > max_block:
                skipped += 1
                continue
            for a, b in combinations(idx, 2):
                ka, kb = compact[a], compact[b]
                if ka == kb or digits[a] != digits[b]:
                    continue  # exact duplicates are the uniqueness rule's; other numbers, other things
                if SequenceMatcher(None, key[a], key[b]).ratio() >= threshold:
                    failing[a] = failing[b] = True
                    if len(pairs) < 20:
                        pairs.append([str(df.at[a, r["field"]]), str(df.at[b, r["field"]])])
        return Evaluation(scope, failing, {"near_duplicate_pairs": pairs, "blocks_skipped_too_large": skipped,
                                           "threshold": threshold})

"""A field holding a set of one-character codes (KNB1.ZWELS payment methods) against a character set.

* ``allowed_chars``  every character must be one of these; the field fails on any other
* ``require_any``    at least one of these characters must be present

Blank values are out of scope (null_check owns required fields). Spaces inside the value are
ignored."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class CharSetCheck(BaseCheck):
    check_class = "char_set_check"
    default_dimension = "validity"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        if not r.get("allowed_chars") and not r.get("require_any"):
            raise ValueError("char_set_check needs allowed_chars, require_any or both")
        scope = ~is_blank(df[r["field"]])
        v = df[r["field"]].astype("string").str.replace(" ", "", regex=False).fillna("")
        failing = pd.Series(False, index=df.index)
        if r.get("allowed_chars"):
            ok = set("".join(map(str, r["allowed_chars"])))
            failing |= v.apply(lambda s: any(c not in ok for c in s)).astype(bool)
        if r.get("require_any"):
            need = set("".join(map(str, r["require_any"])))
            failing |= v.apply(lambda s: not (set(s) & need)).astype(bool)
        return Evaluation(scope, failing, invalid_values_field=r["field"])

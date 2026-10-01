"""A reference to another master record must point at one that exists — and,
with ``target_when``, is still active: a vendor's head office (LFB1.LNRZE →
LFA1.LIFNR, not flagged for deletion), a BOM component (STPO.IDNRK → MARA),
a fixed bin (MLGT → LAGP on warehouse, storage type and bin).

The runner resolves the target set from the extracted target table (read in
full; a partial read is never judged) and passes it as ``_target_values``.
Blank references are out of scope — null_check owns required fields."""

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


def key_of(df: pd.DataFrame, cols: list[str]) -> pd.Series:
    parts = [df[c].astype("string").str.strip().fillna("") for c in cols]
    out = parts[0]
    for p in parts[1:]:
        out = out + "|" + p
    return out


class ExistsCheck(BaseCheck):
    check_class = "exists_check"
    default_dimension = "consistency"

    def columns(self) -> list[str]:
        return list(self.rule.get("fields") or [self.rule["field"]])

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        cols = self.columns()
        populated = pd.Series(True, index=df.index)
        for c in cols:
            populated &= ~is_blank(df[c])
        missing = ~key_of(df, cols).isin(self.rule.get("_target_values") or set())
        return Evaluation(populated, populated & missing,
                          {"target": f"{self.rule['target_table']}.{'+'.join(self.rule['target_fields'])}",
                           "target_records": len(self.rule.get("_target_values") or ())})

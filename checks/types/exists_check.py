"""A reference to another master record must point at one that exists — and,
with ``target_when``, is still active: a vendor's head office (LFB1.LNRZE →
LFA1.LIFNR, not flagged for deletion), a BOM component (STPO.IDNRK → MARA),
a fixed bin (MLGT → LAGP on warehouse, storage type and bin).

The runner resolves the target set from the extracted target table (read in
full; a partial read is never judged) and passes it as ``_target_values``.
Blank references are out of scope — null_check owns required fields.

With ``negate: true`` the check is inverted: the key must *not* exist in the
target (a secondary cost element whose number is already a G/L account)."""

import pandas as pd
import pyarrow as pa
import pyarrow.compute as pc

from checks.base import BaseCheck, Evaluation, is_blank


def key_of(df: pd.DataFrame, cols: list[str]) -> pd.Series:
    parts = [df[c].astype("string").str.strip().fillna("") for c in cols]
    out = parts[0]
    for p in parts[1:]:
        out = out + "|" + p
    return out


def _arrow_keys(df: pd.DataFrame, cols: list[str]) -> pa.Array | pa.ChunkedArray:
    return pa.array(key_of(df, cols)).cast(pa.large_string())


def target_keys(df: pd.DataFrame, cols: list[str]) -> pa.Array:
    """The distinct keys of a target table as one Arrow array. A Python set (or
    ``Series.isin`` over one) costs a Python object per key: gigabytes on a
    multi-million-row target, where the Arrow hash lookup stays in native buffers."""
    return pc.unique(_arrow_keys(df, cols))


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
        target = self.rule.get("_target_values")
        if target is None:
            target = pa.array([], pa.large_string())
        found = pc.is_in(_arrow_keys(df, cols), value_set=target).to_numpy(zero_copy_only=False)
        missing = pd.Series(~found, index=df.index)
        if self.rule.get("negate"):
            missing = ~missing
        return Evaluation(populated, populated & missing,
                          {"target": f"{self.rule['target_table']}.{'+'.join(self.rule['target_fields'])}",
                           "target_records": len(target)})

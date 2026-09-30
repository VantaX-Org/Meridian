import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class UniquenessCheck(BaseCheck):
    """No two records may share the same value combination of ``fields``.

    Evaluated at the rule's grain (checks/frames.py), so a vendor repeated per
    company code in the extract is one record, not a duplicate. Rows where any
    of the fields is blank are out of scope (null_check owns blanks). Every
    member of a duplicate group fails (``keep=False``).
    """

    check_class = "uniqueness_check"
    default_dimension = "uniqueness"

    def columns(self) -> list[str]:
        return list(self.rule.get("fields") or [self.rule["field"]])

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        cols = self.columns()
        populated = pd.Series(True, index=df.index)
        for c in cols:
            populated &= ~is_blank(df[c])
        norm = df[cols].apply(lambda s: s.astype("string").str.strip().str.upper()
                              if self.rule.get("case_insensitive") else s.astype("string").str.strip())
        dup = norm[populated].duplicated(keep=False).reindex(df.index, fill_value=False)
        return Evaluation(populated, dup, {"fields_checked": cols})

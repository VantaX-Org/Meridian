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
        def _norm(s: pd.Series) -> pd.Series:
            s = s.astype("string").str.strip()
            if self.rule.get("normalize") == "name":  # 'Acme (Pty) Ltd.' == 'ACME PTY LTD'
                from checks.value_placement import name_key
                return name_key(s)
            if self.rule.get("normalize") == "alnum":  # identifiers: 'ZA 4012-345.678' == 'ZA4012345678'
                return s.str.replace(r"[^0-9A-Za-z]", "", regex=True).str.upper()
            return s.str.upper() if self.rule.get("case_insensitive") else s

        norm = df[cols].apply(_norm)
        dup = norm[populated].duplicated(keep=False).reindex(df.index, fill_value=False)
        return Evaluation(populated, dup, {"fields_checked": cols})

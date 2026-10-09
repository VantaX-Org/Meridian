import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class UniquenessCheck(BaseCheck):
    """No two records may share the same value combination of ``fields``.

    Evaluated at the rule's grain (checks/frames.py), so a vendor repeated per
    company code in the extract is one record, not a duplicate. Rows where any
    of the fields is blank are out of scope (null_check owns blanks). Every
    member of a duplicate group fails (``keep=False``).

    ``unique_across`` (optional): instead of flagging every repeat of
    ``fields``, flag only groups that span more than one distinct value of
    this field. Use this when the grain carries its own effective-dated
    history (e.g. PAYMENTINFO has one row per employee per effective date,
    not one row per employee) — an employee's own repeated rows for the same
    key share one ``unique_across`` value and are not a duplicate; a key
    reused by a second employee produces a second distinct value and fails.
    """

    check_class = "uniqueness_check"
    default_dimension = "uniqueness"

    def columns(self) -> list[str]:
        cols = list(self.rule.get("fields") or [self.rule["field"]])
        if self.rule.get("unique_across"):
            cols = cols + [self.rule["unique_across"]]
        return list(dict.fromkeys(cols))

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        cols = list(self.rule.get("fields") or [self.rule["field"]])
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
            if self.rule.get("normalize") == "space":  # 'PUMP 100' == 'PUMP100' but not 'PUMP-100'
                return s.str.replace(r"\s", "", regex=True).str.upper()
            return s.str.upper() if self.rule.get("case_insensitive") else s

        norm = df[cols].apply(_norm)
        across = self.rule.get("unique_across")
        if across:
            populated &= ~is_blank(df[across])
            key = norm.astype("string").agg("\x1f".join, axis=1)
            owner = df[across].astype("string").str.strip()
            nun = owner[populated].groupby(key[populated]).transform("nunique")
            dup = (nun > 1).reindex(df.index, fill_value=False)
        else:
            dup = norm[populated].duplicated(keep=False).reindex(df.index, fill_value=False)
        return Evaluation(populated, dup, {"fields_checked": cols})

import re

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank, sap_number

_BACKTICKED = re.compile(r"`([^`]+)`")
_NUMERIC = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP", "DF16_DEC",
            "DF34_DEC", "DECIMAL", "INTEGER"}
_DATES = {"DATS", "DATE", "DATETIME"}


def typed(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Copy of ``cols`` typed by the SAP dictionary for comparison.

    RFC and CSV deliver every value as text, so ``"9.000" > "10.000"`` would be
    True. Numeric DDIC types become numbers, dates become timestamps, and SAP
    blanks (empty, whitespace, 00000000) become missing — so conditions can use
    ``.isna()`` / ``.notna()`` and plain comparison operators.
    """
    from checks.types.domain_value_check import _parse_dates
    from sap.ddic import get_dictionary

    d = get_dictionary("s4hana")
    out = {}
    for c in cols:
        s = df[c]
        f = d.resolve(c)
        kind = (f.type or "").upper() if f else ""
        blank = is_blank(s)
        if kind in _NUMERIC:
            v = sap_number(s)
        elif kind in _DATES:
            v = _parse_dates(s)
        elif f is None and pd.api.types.is_numeric_dtype(s):
            v = s  # unknown (e.g. customer Z) field already numeric
        elif f is None:
            txt = s.astype("string[python]").str.strip()
            num = pd.to_numeric(txt, errors="coerce")
            # infer numbers only when every populated value parses as one
            v = num if num[~blank].notna().all() and (~blank).any() else txt
        else:
            # python-backed (not arrow) string dtype: arrow-backed comparisons return
            # bool[pyarrow] while .str.contains() returns numpy "boolean" — combining
            # the two with & raises "boolean value of NA is ambiguous" (pandas 3.x).
            v = s.astype("string[python]").str.strip()
        out[c] = v.mask(blank)
    return pd.DataFrame(out, index=df.index)


class CrossFieldCheck(BaseCheck):
    """Relationship between fields of the same record (at the rule's grain).

    Preferred form: ``fail_when`` — rows where the expression is True fail.
    Legacy form:   ``condition`` — rows where it is True pass.
    ``require_populated: true`` limits the population to rows where every
    referenced field has a value (blanks are null_check's job).
    Evaluated with ``DataFrame.eval(engine="python")`` on DDIC-typed values;
    ``@today`` is the current date (future hire dates, ages).
    """

    check_class = "cross_field_check"
    default_dimension = "consistency"

    def _expr(self) -> str:
        return self.rule.get("fail_when") or self.rule["condition"]

    def columns(self) -> list[str]:
        cols = super().columns()
        return cols + [c for c in _BACKTICKED.findall(self._expr()) if c not in cols]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        cols = self.columns()
        t = typed(df, cols)
        result = t.eval(self._expr(), engine="python",
                        local_dict={"today": pd.Series(pd.Timestamp.today().normalize(), index=t.index)})
        if not isinstance(result, pd.Series):
            result = pd.Series(result, index=df.index)
        result = result.astype("boolean")
        if self.rule.get("fail_when"):
            failing = result.fillna(False).astype(bool)
        else:
            failing = ~result.fillna(False).astype(bool)
        population = pd.Series(True, index=df.index)
        if self.rule.get("require_populated"):
            population = t.notna().all(axis=1)
        return Evaluation(population, failing, {"expression": self._expr(), "fields_checked": cols,
                                                "semantics": "fail_when" if self.rule.get("fail_when") else "pass_when"})

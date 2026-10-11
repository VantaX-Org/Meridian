import re

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank, reraise_soft_limit


class RegexCheck(BaseCheck):
    """Non-blank values must match ``pattern`` (anchored at the start, like re.match)."""

    check_class = "regex_check"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field, pattern = self.rule["field"], self.rule["pattern"]
        values = df[field].astype("string").str.strip()
        try:
            matched = values.str.match(pattern, na=False)
        except Exception as e:  # patterns pandas cannot vectorise (look-behinds, …)
            reraise_soft_limit(e)
            compiled = re.compile(pattern)
            matched = values.map(lambda v: bool(compiled.match(v)) if isinstance(v, str) else False)
        return Evaluation(~is_blank(df[field]), ~matched.astype(bool), {"pattern": pattern},
                          invalid_values_field=field)

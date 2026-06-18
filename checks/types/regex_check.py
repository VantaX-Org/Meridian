import re

import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class RegexCheck(BaseCheck):
    check_class = "regex_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            pattern = self.rule["pattern"]
            total = len(df)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            compiled = re.compile(pattern)
            # Null detection is the sole responsibility of null_check.
            # regex_check only evaluates non-null, non-empty values.
            non_null = df[field].notna() & (df[field].astype(str).str.strip() != "")
            values = df[field].astype(str).fillna("")
            try:
                # Vectorised str.match — much faster for large DataFrames
                match_mask = values.str.match(pattern, na=False)
            except Exception:
                # Fallback for complex regex patterns (lookaheads, etc.)
                match_mask = values.apply(lambda x: bool(compiled.match(x)))
            failing_mask = non_null & ~match_mask

            check_total = int(non_null.sum())
            affected = int(failing_mask.sum())
            pass_rate = ((check_total - affected) / check_total * 100) if check_total > 0 else 100.0

            id_field = find_id_field(df)
            # Scalar .at access — selecting [id_field, field] as a frame breaks
            # when id_field == field (e.g. a regex check on a key column).
            failing_indices = list(failing_mask[failing_mask].index[:10])

            details = safe_json({
                "field_checked": field,
                "pattern": pattern,
                "id_field_used": id_field,
                "failing_record_count": affected,
                "message": self.rule.get("message", ""),
                "sample_failing_records": [
                    {id_field: str(df.at[idx, id_field]), field: str(df.at[idx, field])}
                    for idx in failing_indices
                ],
            })

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "validity"),
                passed=(affected == 0),
                affected_count=affected,
                total_count=check_total,
                pass_rate=round(pass_rate, 2),
                message=self.rule.get("message", ""),
                details=details,
            )
        except Exception as e:
            return CheckResult(
                check_id=self.rule.get("id", "UNKNOWN"),
                module=self.rule.get("module", ""),
                field=self.rule.get("field", ""),
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "validity"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )

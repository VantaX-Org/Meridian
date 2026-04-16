import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class NullCheck(BaseCheck):
    check_class = "null_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            total = len(df)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            null_mask = df[field].isna() | (df[field].astype(str).str.strip() == "")
            affected = int(null_mask.sum())
            non_null = total - affected
            pass_rate = (non_null / total * 100) if total > 0 else 0.0

            id_field = find_id_field(df)
            # Only materialise the rows we actually need
            failing_indices = null_mask[null_mask].index[:10]
            sample_rows = df.loc[failing_indices, [id_field, field]]

            details = safe_json({
                "field_checked": field,
                "id_field_used": id_field,
                "failing_record_count": affected,
                "message": self.rule.get("message", ""),
                "sample_failing_records": sample_rows
                    .fillna("")
                    .astype(str)
                    .to_dict(orient="records"),
            })

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "completeness"),
                passed=(affected == 0),
                affected_count=affected,
                total_count=total,
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
                dimension=self.rule.get("dimension", "completeness"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )

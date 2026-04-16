import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class ReferentialCheck(BaseCheck):
    check_class = "referential_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            reference_field = self.rule.get("reference_field", field)
            reference_values = self.rule["reference_values"]
            total = len(df)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            ref_set = set(str(v) for v in reference_values)
            values = df[field].astype(str)
            failing_mask = ~values.isin(ref_set) | df[field].isna()

            affected = int(failing_mask.sum())
            pass_rate = ((total - affected) / total * 100) if total > 0 else 0.0

            id_field = find_id_field(df)
            # Only materialise the rows we actually need
            failing_indices = failing_mask[failing_mask].index[:10]
            sample_rows = df.loc[failing_indices, [id_field, field]]
            failing_field_values = df.loc[failing_mask, field]

            details = safe_json({
                "field_checked": field,
                "reference_field": reference_field,
                "id_field_used": id_field,
                "failing_record_count": affected,
                "message": self.rule.get("message", ""),
                "missing_values": failing_field_values
                    .dropna().astype(str).unique().tolist()[:20],
                "sample_failing_records": [
                    {id_field: str(row[id_field]), field: str(row[field])}
                    for _, row in sample_rows.iterrows()
                ],
            })

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "consistency"),
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
                dimension=self.rule.get("dimension", "consistency"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )

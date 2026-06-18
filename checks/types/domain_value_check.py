import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class DomainValueCheck(BaseCheck):
    check_class = "domain_value_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            allowed_values = self.rule.get("allowed_values")
            fmt = self.rule.get("format")
            total = len(df)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            # Null detection is the sole responsibility of null_check.
            # domain_value_check only evaluates non-null, non-empty values.
            non_null = df[field].notna() & (df[field].astype(str).str.strip() != "")
            values = df[field].astype(str)

            if allowed_values is not None:
                allowed_set = set(str(v) for v in allowed_values)
                failing_mask = non_null & ~values.isin(allowed_set)
            elif fmt == "email":
                failing_mask = non_null & ~values.str.match(
                    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$", na=False
                )
            elif fmt == "date":
                # Vectorised date parsing — NaT indicates parse failure.
                parsed = pd.to_datetime(df[field], errors="coerce")
                failing_mask = non_null & parsed.isna()
            else:
                # No validation criteria specified — nothing to check for non-nulls
                failing_mask = pd.Series(False, index=df.index)

            check_total = int(non_null.sum())
            affected = int(failing_mask.sum())
            pass_rate = ((check_total - affected) / check_total * 100) if check_total > 0 else 100.0

            id_field = find_id_field(df)
            # Scalar .at access — selecting [id_field, field] as a frame breaks
            # when id_field == field (e.g. a domain check on a key column).
            failing_indices = list(failing_mask[failing_mask].index[:10])
            failing_field_values = df.loc[failing_mask, field]

            details = safe_json({
                "field_checked": field,
                "allowed_values": allowed_values,
                "format": fmt,
                "id_field_used": id_field,
                "failing_record_count": affected,
                "message": self.rule.get("message", ""),
                "sample_failing_records": [
                    {id_field: str(df.at[idx, id_field]), field: str(df.at[idx, field]),
                     "invalid_value": str(df.at[idx, field])}
                    for idx in failing_indices
                ],
                "distinct_invalid_values": failing_field_values
                    .dropna().astype(str).value_counts().head(10).to_dict()
                    if affected > 0 else {},
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

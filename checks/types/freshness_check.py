from datetime import datetime, timezone

import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class FreshnessCheck(BaseCheck):
    check_class = "freshness_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            max_age_hours = self.rule["max_age_hours"]
            total = len(df)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            now = datetime.now(timezone.utc)

            try:
                parsed = pd.to_datetime(df[field], errors="coerce", utc=True)
            except Exception:
                return CheckResult(
                    check_id=self.rule["id"],
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "timeliness"),
                    passed=False,
                    affected_count=total,
                    total_count=total,
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={
                        "max_age_hours": max_age_hours,
                        "parse_error": "Could not parse column as datetime",
                    },
                    error="Could not parse column as datetime",
                )

            # NaT (unparseable) values count as failing
            nat_mask = parsed.isna()
            cutoff = now - pd.Timedelta(hours=max_age_hours)
            stale_mask = parsed < cutoff
            failing_mask = nat_mask | stale_mask

            affected = int(failing_mask.sum())
            pass_rate = ((total - affected) / total * 100) if total > 0 else 0.0

            valid_dates = parsed.dropna()
            oldest = str(valid_dates.min()) if len(valid_dates) > 0 else "N/A"
            newest = str(valid_dates.max()) if len(valid_dates) > 0 else "N/A"

            id_field = find_id_field(df)
            # Only materialise the rows we actually need. Use scalar .at access
            # and the already-parsed timestamps — selecting [id_field, field] as a
            # frame breaks when id_field == field (e.g. a pruned single-column
            # extract): duplicate columns make row[field] a Series, raising
            # "truth value of a Series is ambiguous" and silently zeroing the count.
            failing_indices = list(failing_mask[failing_mask].index[:10])
            sample_failing_records = []
            for idx in failing_indices:
                ts = parsed.at[idx]
                age_hours = (
                    str(round((now - ts).total_seconds() / 3600, 1))
                    if pd.notna(ts) else "N/A"
                )
                sample_failing_records.append({
                    id_field: str(df.at[idx, id_field]),
                    field: str(df.at[idx, field]),
                    "age_hours": age_hours,
                })

            details = safe_json({
                "field_checked": field,
                "max_age_hours": max_age_hours,
                "cutoff_datetime": cutoff.isoformat(),
                "oldest_failing_value": oldest,
                "newest_failing_value": newest,
                "id_field_used": id_field,
                "failing_record_count": affected,
                "message": self.rule.get("message", ""),
                "sample_failing_records": sample_failing_records,
            })

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "timeliness"),
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
                dimension=self.rule.get("dimension", "timeliness"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )

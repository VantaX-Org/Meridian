import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class CrossFieldCheck(BaseCheck):
    check_class = "cross_field_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule.get("field") or self.rule.get("fields", [""])[0]
            fields = self.rule.get("fields", [field])
            condition = self.rule["condition"]
            total = len(df)

            # Check all required fields exist — skip if any are missing (partial extract)
            missing = [f for f in fields if f not in df.columns]
            if missing:
                return None  # Skip — fields not in partial extract

            # Rows matching the condition are the PASSING rows.
            # df.query() cannot handle Series method calls like .duplicated()/.notna(),
            # so use df.eval() with python engine and fall back to a sandboxed eval()
            # for conditions that eval() can't parse (method chains, etc.).
            try:
                passing_mask = df.eval(condition, engine='python')
            except Exception:
                local_ns = {col: df[col] for col in df.columns}
                local_ns["pd"] = pd
                passing_mask = eval(condition, {"__builtins__": {}}, local_ns)

            if not isinstance(passing_mask, pd.Series):
                passing_mask = pd.Series(passing_mask, index=df.index)
            # Coerce NaN comparisons to False so NaN rows count as failing.
            passing_mask = passing_mask.fillna(False).astype(bool)

            passing_count = int(passing_mask.sum())
            affected = total - passing_count
            pass_rate = (passing_count / total * 100) if total > 0 else 0.0

            failing_mask = ~passing_mask
            id_field = find_id_field(df)

            # Include the id field plus all checked fields in the output
            output_cols = [id_field] + [f for f in fields if f in df.columns and f != id_field]

            # Only materialise the rows we actually need
            failing_indices = failing_mask[failing_mask].index[:10]
            sample_rows = df.loc[failing_indices, output_cols]

            details = safe_json({
                "fields_checked": fields,
                "condition": condition,
                "id_field_used": id_field,
                "failing_record_count": int(affected),
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

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank

_EMAIL = r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"


class DomainValueCheck(BaseCheck):
    """Non-blank values must be in the allowed set (or match a named format).

    Blanks are out of scope — null detection belongs to null_check.
    """

    check_class = "domain_value_check"

    def evaluate(self, df: pd.DataFrame) -> Evaluation | None:
        field = self.rule["field"]
        live = self.rule.get("_live_reference")
        allowed = sorted(live) if live is not None else self.rule.get("allowed_values")
        fmt = self.rule.get("format")
        from_ddic = allowed is None and not fmt and self.rule.get("_ddic_fixed") is not None
        if from_ddic:
            allowed = self.rule["_ddic_fixed"]
        populated = ~is_blank(df[field])
        values = df[field].astype("string").str.strip()

        if allowed is not None:
            failing = ~values.isin({str(v).strip() for v in allowed})
        elif fmt == "email":
            failing = ~values.str.match(_EMAIL, na=False)
        elif fmt == "date":
            failing = _parse_dates(df[field]).isna()
        else:
            return None  # no criterion configured — nothing to evaluate
        return Evaluation(populated, failing.fillna(True), {
            "allowed_values": allowed if live is None else f"{len(live)} values from live {self.rule.get('_reference_key')}",
            "format": fmt,
            "reference_source": "live_config" if live is not None else ("ddic_fixed_values" if from_ddic else "rule_baseline"),
            "reference_table": self.rule.get("_reference_key"),
        }, invalid_values_field=field)


def _parse_dates(s: pd.Series) -> pd.Series:
    """Parse SAP DATS (YYYYMMDD) and ISO dates; anything else → NaT."""
    txt = s.astype("string").str.strip()
    dats = pd.to_datetime(txt.where(txt.str.fullmatch(r"\d{8}", na=False)), format="%Y%m%d", errors="coerce")
    other = pd.to_datetime(txt.where(~txt.str.fullmatch(r"\d{8}", na=False)), errors="coerce", utc=True, format="mixed")
    return dats.fillna(other.dt.tz_localize(None) if hasattr(other, "dt") else other)

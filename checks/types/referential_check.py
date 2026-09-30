import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank


class ReferentialCheck(BaseCheck):
    """Non-blank values must exist in the reference (check/config) table.

    Reference values come from the live configuration snapshot of the source
    system when the runner supplies one (``rule["_live_reference"]``), else
    from the rule's SAP-standard ``reference_values``. ``multi_value: chars``
    validates every character separately (e.g. LFB1.ZWELS payment-method lists).
    """

    check_class = "referential_check"

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        field = self.rule["field"]
        live = self.rule.get("_live_reference")
        ref = {str(v).strip() for v in (live if live is not None else self.rule["reference_values"])}
        values = df[field].astype("string").str.strip()
        if self.rule.get("multi_value") == "chars":
            failing = values.map(lambda v: isinstance(v, str) and any(ch not in ref for ch in v))
        else:
            failing = ~values.isin(ref)
        return Evaluation(
            ~is_blank(df[field]), failing.fillna(True).astype(bool),
            {"reference_field": self.rule.get("reference_field", field),
             "reference_source": "live_config" if live is not None else "sap_standard",
             "reference_table": self.rule.get("reference_table"),
             "missing_values": values[failing.fillna(True).astype(bool) & ~is_blank(df[field])]
                 .dropna().unique().tolist()[:20]},
            invalid_values_field=field,
        )

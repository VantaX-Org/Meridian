import re

import pandas as pd

from checks.base import BaseCheck, Evaluation, is_blank, sap_number

_BACKTICKED = re.compile(r"`([^`]+)`")
_NUMERIC = {"DEC", "CURR", "QUAN", "INT1", "INT2", "INT4", "INT8", "FLTP", "DF16_DEC",
            "DF34_DEC", "DECIMAL", "INTEGER"}
_DATES = {"DATS", "DATE", "DATETIME"}

# ISO 3166-1 alpha-2 -> alpha-3. Two unrelated uses:
#  1. IBAN's first two characters are always the alpha-2 country code (part of the
#     IBAN spec itself) and need mapping to compare against a Country foundation
#     object field (e.g. PAYMENTINFO.BANK_COUNTRY) that carries alpha-3 codes.
#  2. A BIC/SWIFT code's characters 5-6 are likewise always the alpha-2 country of
#     the receiving bank, and are compared the same way against BANK_COUNTRY
#     (PAY127).
# Available in every cross_field_check's eval namespace as ``iso_alpha3``
# (``.str.slice(0, 2).map(iso_alpha3)`` for IBAN, ``.str.slice(4, 6).map(iso_alpha3)``
# for BIC). Covers every country in the IBAN registry plus every BANK_COUNTRY value
# this rule pack's fixtures/rules reference for non-IBAN (BIC/ABA) countries; extend
# it if a new BANK_COUNTRY value needs a BIC cross-check.
ISO_ALPHA2_TO_3 = {
    "AD": "AND", "AE": "ARE", "AL": "ALB", "AR": "ARG", "AT": "AUT", "AU": "AUS",
    "AZ": "AZE", "BA": "BIH", "BE": "BEL", "BG": "BGR", "BH": "BHR", "BR": "BRA",
    "BY": "BLR", "CA": "CAN", "CH": "CHE", "CL": "CHL", "CN": "CHN", "CO": "COL",
    "CR": "CRI", "CY": "CYP",
    "CZ": "CZE", "DE": "DEU", "DK": "DNK", "DO": "DOM", "EE": "EST", "EG": "EGY",
    "ES": "ESP", "FI": "FIN", "FO": "FRO", "FR": "FRA", "GB": "GBR", "GE": "GEO",
    "GH": "GHA", "GI": "GIB", "GL": "GRL", "GR": "GRC", "GT": "GTM", "HK": "HKG", "HR": "HRV",
    "HU": "HUN", "ID": "IDN", "IE": "IRL", "IL": "ISR", "IN": "IND", "IQ": "IRQ", "IS": "ISL",
    "IT": "ITA", "JO": "JOR", "JP": "JPN", "KE": "KEN", "KR": "KOR", "KW": "KWT", "KZ": "KAZ",
    "LB": "LBN", "LC": "LCA", "LI": "LIE", "LT": "LTU", "LU": "LUX", "LV": "LVA",
    "LY": "LBY", "MC": "MCO", "MD": "MDA", "ME": "MNE", "MK": "MKD", "MR": "MRT",
    "MT": "MLT", "MU": "MUS", "MX": "MEX", "MY": "MYS", "NG": "NGA", "NL": "NLD", "NO": "NOR",
    "NZ": "NZL", "PE": "PER", "PH": "PHL", "PK": "PAK", "PL": "POL", "PS": "PSE", "PT": "PRT", "QA": "QAT",
    "RO": "ROU", "RS": "SRB", "SA": "SAU", "SC": "SYC", "SD": "SDN", "SE": "SWE",
    "SG": "SGP", "SI": "SVN", "SK": "SVK", "SM": "SMR", "SO": "SOM", "ST": "STP",
    "SV": "SLV", "TH": "THA", "TL": "TLS", "TN": "TUN", "TR": "TUR", "UA": "UKR", "US": "USA",
    "VA": "VAT", "VG": "VGB", "VN": "VNM", "XK": "XKX", "ZA": "ZAF",
}


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
                        local_dict={"today": pd.Series(pd.Timestamp.today().normalize(), index=t.index),
                                    "iso_alpha3": ISO_ALPHA2_TO_3})
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

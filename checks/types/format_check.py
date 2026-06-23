"""Deterministic check-digit / format-mask validation.

These are mathematical standards (ISO 13616 IBAN mod-97, GS1 GTIN mod-10,
ISO/IEC 7812 Luhn), not invented heuristics — a value either satisfies the
algorithm or it does not. No SAP config, no LLM, no network. Each validator
takes a single string and returns True when valid.

Null handling follows the engine-wide rule: null detection is null_check's job
alone, so blanks are excluded from the denominator here.
"""

import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


def valid_iban(s: str) -> bool:
    """ISO 13616 IBAN: move the first 4 chars to the end, map letters to
    digits (A=10..Z=35), the whole number mod 97 must equal 1."""
    s = s.strip().replace(" ", "").upper()
    if len(s) < 5 or len(s) > 34 or not s[:2].isalpha() or not s[2:4].isdigit():
        return False
    rearranged = s[4:] + s[:4]
    digits = []
    for ch in rearranged:
        if ch.isdigit():
            digits.append(ch)
        elif "A" <= ch <= "Z":
            digits.append(str(ord(ch) - 55))
        else:
            return False  # space/punctuation inside the body — invalid
    return int("".join(digits)) % 97 == 1


def valid_gtin(s: str) -> bool:
    """GS1 GTIN-8/12/13/14 (also EAN/UPC): mod-10 with 3,1,3,1… weighting
    applied right-to-left over the body, check digit is the last position."""
    s = s.strip()
    if not s.isdigit() or len(s) not in (8, 12, 13, 14):
        return False
    *body, check = [int(c) for c in s]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - (total % 10)) % 10 == check


def valid_luhn(s: str) -> bool:
    """ISO/IEC 7812 Luhn (payment cards, some national IDs): double every
    second digit from the right, subtract 9 if >9, sum mod 10 must be 0."""
    s = s.strip().replace(" ", "")
    if not s.isdigit() or len(s) < 2:
        return False
    total = 0
    for i, ch in enumerate(reversed(s)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


VALIDATORS = {
    "iban": valid_iban,
    "gtin": valid_gtin,
    "ean": valid_gtin,   # EAN-13/8 are GTINs — same algorithm
    "upc": valid_gtin,   # UPC-A is GTIN-12
    "luhn": valid_luhn,
}


class FormatCheck(BaseCheck):
    check_class = "format_check"

    def run(self, df: pd.DataFrame) -> CheckResult | None:
        try:
            field = self.rule["field"]
            fmt = str(self.rule.get("format", "")).lower()
            validator = VALIDATORS.get(fmt)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            if validator is None:
                return CheckResult(
                    check_id=self.rule.get("id", "UNKNOWN"),
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "validity"),
                    passed=False,
                    affected_count=0,
                    total_count=len(df),
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={},
                    error=f"Unknown format '{fmt}' (known: {sorted(VALIDATORS)})",
                )

            # Null detection is the sole responsibility of null_check — format
            # only judges non-null values.
            non_null = df[field].notna() & (df[field].astype(str).str.strip() != "")
            values = df[field].astype(str)
            valid_mask = pd.Series(False, index=df.index)
            valid_mask.loc[non_null] = values[non_null].map(validator)
            failing_mask = non_null & ~valid_mask

            check_total = int(non_null.sum())
            affected = int(failing_mask.sum())
            pass_rate = ((check_total - affected) / check_total * 100) if check_total > 0 else 100.0

            id_field = find_id_field(df)
            failing_indices = list(failing_mask[failing_mask].index[:10])

            details = safe_json({
                "field_checked": field,
                "format": fmt,
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


if __name__ == "__main__":
    # Runnable check — real reference values from the published standards.
    assert valid_iban("GB82 WEST 1234 5698 7654 32")
    assert not valid_iban("GB82 WEST 1234 5698 7654 31")  # last digit wrong
    assert valid_gtin("4006381333931")    # EAN-13 textbook example
    assert not valid_gtin("4006381333932")
    assert valid_gtin("036000291452")     # UPC-A (GTIN-12)
    assert valid_luhn("4539148803436467")
    assert not valid_luhn("4539148803436468")
    # null/blank excluded, not failed
    df = pd.DataFrame({"IBAN": ["GB82 WEST 1234 5698 7654 32", None, "BAD"]})
    res = FormatCheck({"id": "F1", "field": "IBAN", "format": "iban"}).run(df)
    assert res.affected_count == 1 and res.total_count == 2 and res.pass_rate == 50.0
    print("format_check self-check OK")

"""Email, phone and postal code verification (api/services/contact_verify).

* ``kind: email``       RFC 5321/5322 syntax and length limits
* ``kind: disposable``  the domain is a throw-away mailbox service (list shipped in the repo)
* ``kind: phone``       E.164 plausibility for the record's country (``country_field``) or its calling
                        code (``dial_field``); without either, the generic 8-15 digit E.164 bound
* ``kind: postcode``    the country's postal code layout (``country_field``); unknown countries not judged
* ``kind: mx``          the domain has no mail server; asks the site's own resolver, one query per domain.
                        Added at run time beside each email rule only when the tenant turns it on
                        (tenant setting ``contact_verify.mx``, see ``mx_rules``)

Blank values are out of scope (null_check owns required fields). ``details.reasons`` counts each reason
and every sampled record carries its own ``reason`` and ``reason_text``, so a steward sees why that
one value fails even where the value itself is masked.
"""
from collections import Counter

import pandas as pd

from api.services import contact_verify as cv
from checks.base import SAMPLE_SIZE, BaseCheck, Evaluation, is_blank


class ContactCheck(BaseCheck):
    check_class = "contact_check"
    default_dimension = "validity"

    def columns(self) -> list[str]:
        r = self.rule
        return [c for c in (r["field"], r.get("country_field"), r.get("dial_field")) if c]

    def evaluate(self, df: pd.DataFrame) -> Evaluation:
        r = self.rule
        kind = r.get("kind")
        scope = ~is_blank(df[r["field"]])
        value = df[r["field"]].astype("string").fillna("")
        country = df[r["country_field"]].astype("string").fillna("") if r.get("country_field") else None
        dial = df[r["dial_field"]].astype("string").fillna("") if r.get("dial_field") else None
        if kind == "email":
            reasons = value.map(cv.email_reason)
        elif kind == "disposable":
            reasons = value.map(lambda v: None if cv.email_reason(v) else cv.disposable_reason(v))
        elif kind == "phone":
            reasons = pd.Series([cv.phone(value.at[i], country.at[i] if country is not None else None,
                                          dial.at[i] if dial is not None else None)[0] for i in df.index],
                                index=df.index, dtype=object)
        elif kind == "mx":
            domains = {d: cv.mx_reason(d) for d in {v.rpartition("@")[2].lower() for v in value[scope]
                                                     if not cv.email_reason(v)}}
            reasons = value.map(lambda v: None if cv.email_reason(v) else domains.get(v.rpartition("@")[2].lower()))
        elif kind == "postcode":
            if country is None:
                raise ValueError("contact_check kind postcode needs country_field")
            reasons = pd.Series([cv.postcode(value.at[i], country.at[i])[0] for i in df.index],
                                index=df.index, dtype=object)
        else:
            raise ValueError(f"contact_check kind must be email, disposable, mx, phone or postcode, not {kind!r}")
        failing = scope & reasons.notna()
        self._reasons = reasons
        counts = Counter(reasons[failing])
        return Evaluation(scope, failing, {"reasons": {k: {"count": n, "text": cv.REASONS[k]}
                                                       for k, n in counts.most_common()}},
                          invalid_values_field=r["field"])

    def _result(self, df, ev, key_cols, grain):
        res = super()._result(df, ev, key_cols, grain)
        idx = df[ev.failing].head(SAMPLE_SIZE).index
        for i, rec in zip(idx, res.details.get("sample_failing_records") or []):
            code = self._reasons.at[i]
            rec["reason"], rec["reason_text"] = code, cv.REASONS[code]
        return res


def mx_rules(static: list[dict]) -> list[dict]:
    """One MX rule beside each email rule of a module (the tenant turned the lookup on)."""
    return [{**r, "id": f"{r['id']}-MX", "kind": "mx", "severity": "medium", "auto_fix": None,
             "message": "Email domain has no mail server (no MX or address record)"}
            for r in static if r.get("check_class") == "contact_check" and r.get("kind") == "email"]

"""Statistical inference of SAP field-status from observed master data.

SAP decides whether a field is *required*, *optional*, *suppressed*, or
*display-only* at runtime via field-status groups linked to an object's account
group (e.g. vendor account group ``LFA1.KTOKK``). Meridian does not read those
customizing tables — their names are SAP-customer-specific and must not be
guessed (see :mod:`sap.field_status`). The shipped data-dictionary baseline is
therefore static: it cannot tell that *this* customer made ``TELF1`` mandatory
for account group ``0001`` but suppressed it for ``Z100``.

This module makes the answer **dynamic** without reading config: it infers
field status from how the customer's *own* extracted records are actually
filled, per account group. The reasoning is deliberately conservative:

  * **REQUIRED** — the field is filled in ≥ ``required_threshold`` of records
    (default 99 %). A field SAP forces to be populated shows up as ~always
    populated; near-universal fill is the observable shadow of a required group.
  * **SUPPRESSED** — the field is filled in *zero* records. A suppressed field
    cannot be entered, so it is never populated. (Optional-but-unused looks
    identical in data; we surface it as SUPPRESSED with its evidence and let a
    live-config read upgrade the certainty later.)
  * **OPTIONAL** — anything in between: sometimes filled, sometimes not.
  * **DISPLAY** is *never* inferred. Whether a populated field is editable or
    read-only is not observable from values alone.

Guards that keep inference honest:

  * **Minimum sample.** Below ``min_sample`` records (default 30) we emit no
    opinion at all — too little data to distinguish "required" from "lucky".
  * **Key fields are never overridden.** A primary-key column is structurally
    mandatory regardless of fill rate; inference defers to the dictionary there.
  * **Blanks are SAP-blank-aware but sentinel-naive.** ``NaN``/``None``/empty/
    whitespace count as absent; we do *not* treat ``"00000000"`` or all-zero
    numerics as empty, because those sentinels are field-specific and guessing
    them risks falsely declaring a populated field suppressed.

The output is a :class:`FieldStatusOverrides` mapping per account group, ready
to feed :func:`sap.field_status.resolve_field_status` with
``override_source=FieldStatusSource.INFERRED`` so every resolution carries its
provenance and the supporting evidence travels with it.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field as dataclass_field

import pandas as pd

from sap.data_dictionary import get_table_metadata
from sap.field_status import FieldStatus, FieldStatusOverrides

# Master tables whose field-status groups are driven by an account-group column.
# Every field below is present in ``sap/data_dictionary.py`` (KTOKK/KTOKD are
# documented there as the account-group keys) — these are grounded, not guessed.
ACCOUNT_GROUP_FIELDS: dict[str, str] = {
    "LFA1": "KTOKK",  # vendor account group
    "KNA1": "KTOKD",  # customer account group
}

DEFAULT_MIN_SAMPLE = 30
DEFAULT_REQUIRED_THRESHOLD = 0.99


def account_group_field_for(table: str) -> str | None:
    """Return the account-group column for *table*, or ``None`` if it has none."""
    return ACCOUNT_GROUP_FIELDS.get(table.strip().upper())


@dataclass(frozen=True)
class FieldEvidence:
    """Observed fill statistics behind one inferred field status."""

    field: str
    n_total: int
    n_filled: int
    status: FieldStatus
    account_group: str | None = None

    @property
    def fill_rate(self) -> float:
        return self.n_filled / self.n_total if self.n_total else 0.0


@dataclass(frozen=True)
class InferenceResult:
    """Inferred overrides for one account group plus the evidence behind them."""

    account_group: str | None
    n_total: int
    overrides: dict[str, FieldStatus] = dataclass_field(default_factory=dict)
    evidence: dict[str, FieldEvidence] = dataclass_field(default_factory=dict)

    @property
    def has_opinion(self) -> bool:
        """True when the sample was large enough to infer at least one field."""
        return bool(self.overrides)

    def as_overrides(self) -> FieldStatusOverrides:
        """Return the override mapping in the shape ``resolve_*`` expects."""
        return dict(self.overrides)


def _filled_mask(series: pd.Series) -> pd.Series:
    """Boolean mask: True where the value is present (SAP-blank-aware).

    ``NaN``/``None``/empty-string/whitespace-only are absent. Numeric ``0`` and
    string ``"0"`` are *present* — we do not guess field-specific empty
    sentinels (``"00000000"`` etc.), which would risk false suppression.
    """
    s = series.astype("string")  # nullable string: NaN/None -> <NA>
    stripped = s.str.strip()
    return stripped.notna() & (stripped != "")


def infer_field_status(
    df: pd.DataFrame,
    *,
    min_sample: int = DEFAULT_MIN_SAMPLE,
    required_threshold: float = DEFAULT_REQUIRED_THRESHOLD,
    account_group: str | None = None,
    fields: Iterable[str] | None = None,
    protect_fields: Iterable[str] | None = None,
) -> InferenceResult:
    """Infer field status for *df* from observed fill rates.

    Args:
        df: Extracted records for one account group (or the whole table when
            the table has no account-group column).
        min_sample: Below this row count, emit no opinion (returns an empty,
            ``has_opinion``-false result).
        required_threshold: Fill rate at/above which a field is ``REQUIRED``.
        account_group: The account-group value these rows belong to (recorded
            on every piece of evidence; ``None`` when ungrouped).
        fields: Restrict inference to these columns; default = all columns.
        protect_fields: Columns to leave to the dictionary (e.g. primary keys);
            no override is emitted for them.

    Returns:
        An :class:`InferenceResult`. When ``len(df) < min_sample`` the result is
        empty — callers must fall back to the dictionary baseline, never treat
        the silence as "optional".
    """
    n_total = int(len(df))
    result = InferenceResult(account_group=account_group, n_total=n_total)
    if n_total < min_sample:
        return result

    protect = {f.strip().upper() for f in (protect_fields or ())}
    cols = list(fields) if fields is not None else list(df.columns)

    for col in cols:
        if col not in df.columns:
            continue
        name = str(col).strip().upper()
        if name in protect:
            continue

        mask = _filled_mask(df[col])
        n_filled = int(mask.sum())
        rate = n_filled / n_total

        if rate >= required_threshold:
            status = FieldStatus.REQUIRED
        elif n_filled == 0:
            status = FieldStatus.SUPPRESSED
        else:
            status = FieldStatus.OPTIONAL

        result.overrides[name] = status
        result.evidence[name] = FieldEvidence(
            field=name,
            n_total=n_total,
            n_filled=n_filled,
            status=status,
            account_group=account_group,
        )

    return result


def build_inferred_overrides(
    df: pd.DataFrame,
    table: str,
    *,
    min_sample: int = DEFAULT_MIN_SAMPLE,
    required_threshold: float = DEFAULT_REQUIRED_THRESHOLD,
    account_group_field: str | None = None,
    protect_keys: bool = True,
) -> dict[str | None, InferenceResult]:
    """Infer field-status overrides for *table*, split by account group.

    When *table* has an account-group column (known via
    :data:`ACCOUNT_GROUP_FIELDS` or passed explicitly), the records are grouped
    by it and each group is inferred independently — this is what lets the same
    field be required for one account group and suppressed for another. When it
    has none, the whole frame is inferred under the ``None`` key.

    Primary-key columns (from the data dictionary) are protected: inference
    never downgrades a structural key, regardless of fill rate.

    Returns:
        ``{account_group_value | None: InferenceResult}``. Pass the result for a
        record's account group as the ``overrides`` argument to
        :func:`sap.field_status.resolve_field_status` with
        ``override_source=FieldStatusSource.INFERRED``.
    """
    tbl = table.strip().upper()

    protect: set[str] = set()
    if protect_keys:
        table_meta = get_table_metadata(tbl) or {}
        protect = {f.upper() for f, m in table_meta.items() if m.get("key")}

    ag_field = account_group_field or account_group_field_for(tbl)

    # Ungrouped: no account-group column → infer across the whole frame.
    if ag_field is None or ag_field not in df.columns:
        result = infer_field_status(
            df,
            min_sample=min_sample,
            required_threshold=required_threshold,
            account_group=None,
            protect_fields=protect,
        )
        return {None: result}

    # The account-group column is itself structurally present — never infer it.
    protect = protect | {ag_field.upper()}

    out: dict[str | None, InferenceResult] = {}
    for group_value, group_df in df.groupby(df[ag_field].astype("string"), dropna=True):
        ag = str(group_value).strip()
        if not ag:
            continue
        out[ag] = infer_field_status(
            group_df,
            min_sample=min_sample,
            required_threshold=required_threshold,
            account_group=ag,
            protect_fields=protect,
        )
    return out

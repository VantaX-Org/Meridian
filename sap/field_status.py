"""SAP field-status resolution.

In SAP, whether a master-data field is *required*, *optional*, *suppressed*, or
*display-only* is not a fixed property of the field — it is decided at runtime by
**field-status groups** linked to an object's account group / posting key
(e.g. vendor account group ``LFA1.KTOKK`` → field-status group; FI/GL via
``T004F``). Meridian does not yet register or read those field-status tables, so
this module deliberately does **not** invent their names.

What it does instead:

  1. Derives a *baseline* field status from facts already in the data dictionary
     (``sap/data_dictionary.py``): a key field or a ``mandatory: True`` field is
     ``REQUIRED``; anything else is ``OPTIONAL``. The dictionary cannot express
     ``SUPPRESSED`` or ``DISPLAY`` — only live field-status config can — so the
     dictionary source never returns those.

  2. Exposes a **live-SPRO override seam**: callers pass an ``overrides`` mapping
     of ``FIELD -> FieldStatus`` representing the field-status group already
     resolved for the record's account group. When Meridian later gains a
     field-status-group reader, it produces that mapping; until then callers pass
     ``None`` and the resolver falls back to the dictionary. Either way the
     resolution records its ``source`` so downstream consumers know whether
     "mandatory" is config-grounded or merely the shipped default.

This keeps "what SAP intends for this field" honest: a config-grounded fact when
live data is available, an explicitly-labelled baseline otherwise.
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass

from sap.custom_namespace import is_custom_field
from sap.data_dictionary import get_field_metadata, get_table_metadata


class FieldStatus(str, enum.Enum):
    """The four SAP field-status states for a master-data field."""

    REQUIRED = "required"
    OPTIONAL = "optional"
    SUPPRESSED = "suppressed"
    DISPLAY = "display"


class FieldStatusSource(str, enum.Enum):
    """Where a field-status resolution came from — its provenance.

    Ordered most-trusted first: a live customizing read beats data inference,
    which beats the shipped dictionary baseline, which beats a bare
    customer-namespace recognition (a ``Z``/``Y`` field we know only by its name).
    """

    LIVE_SPRO = "live_spro"  # resolved field-status group from a live SAP read
    INFERRED = "inferred"  # statistically inferred from the customer's own data
    DICTIONARY = "dictionary"  # derived from data_dictionary key/mandatory flags
    CUSTOM = "custom"  # customer-namespace (Z/Y) field, absent from the dictionary


# A field-status group already resolved for one account group:
# ``{"NAME1": FieldStatus.REQUIRED, "TELF1": FieldStatus.OPTIONAL, ...}``.
# This is the live-SPRO seam — Meridian populates it once a field-status-group
# reader ships; until then it is ``None`` and the dictionary baseline is used.
FieldStatusOverrides = Mapping[str, FieldStatus]


@dataclass(frozen=True)
class FieldStatusResolution:
    """The resolved status of one ``TABLE.FIELD`` plus its provenance."""

    table: str
    field: str
    status: FieldStatus
    source: FieldStatusSource
    reason: str
    account_group: str | None = None

    @property
    def is_required(self) -> bool:
        return self.status is FieldStatus.REQUIRED

    @property
    def is_config_grounded(self) -> bool:
        """True when the status came from live SAP config, not the baseline."""
        return self.source is FieldStatusSource.LIVE_SPRO

    @property
    def is_data_grounded(self) -> bool:
        """True when the status was inferred from the customer's own data."""
        return self.source is FieldStatusSource.INFERRED

    @property
    def is_grounded(self) -> bool:
        """True when the status rests on real evidence (live config or observed
        data) rather than the shipped dictionary default."""
        return self.source in (FieldStatusSource.LIVE_SPRO, FieldStatusSource.INFERRED)

    @property
    def is_custom(self) -> bool:
        """True when this is a customer-namespace (Z/Y) field the shipped
        dictionary does not describe — recognised by name only."""
        return self.source is FieldStatusSource.CUSTOM


def _normalise(name: str) -> str:
    return name.strip().upper()


def resolve_field_status(
    table: str,
    field: str,
    *,
    account_group: str | None = None,
    overrides: FieldStatusOverrides | None = None,
    override_source: FieldStatusSource = FieldStatusSource.LIVE_SPRO,
) -> FieldStatusResolution | None:
    """Resolve the field status for ``table.field``.

    Resolution order (real evidence wins over baseline, mirroring ``SPROReader``):

      1. ``overrides`` — a field-status mapping resolved for the record's account
         group. ``override_source`` says where it came from: ``LIVE_SPRO`` (a live
         customizing read) or ``INFERRED`` (statistically derived from the
         customer's own data — see :mod:`sap.field_status_inference`).
      2. data dictionary — ``key`` or ``mandatory`` → ``REQUIRED``, else
         ``OPTIONAL``. Source = ``DICTIONARY``.
      3. customer namespace — a ``Z``/``Y`` field the dictionary doesn't know is
         recognised as a custom extension and resolved ``OPTIONAL``. Source =
         ``CUSTOM``.

    Args:
        table: SAP table name (e.g. ``"LFA1"``). Case-insensitive.
        field: Field name (e.g. ``"NAME1"``). Case-insensitive.
        account_group: Optional account group the override mapping was resolved
            for — recorded on the result for traceability only.
        overrides: Optional field-status mapping (``FIELD -> FieldStatus``).
        override_source: Provenance to stamp on an override hit. Must be
            ``LIVE_SPRO`` or ``INFERRED``; the dictionary is never an override.

    Returns:
        A :class:`FieldStatusResolution`, or ``None`` when the field is unknown
        to the override mapping, the data dictionary, *and* the customer
        namespace (no opinion — the caller must not treat absence as "optional").
        A standard-namespace field absent from the dictionary returns ``None``; a
        ``Z``/``Y`` field absent from it returns a ``CUSTOM`` resolution.
    """
    tbl = _normalise(table)
    fld = _normalise(field)

    if override_source is FieldStatusSource.DICTIONARY:
        raise ValueError("override_source must be LIVE_SPRO or INFERRED, not DICTIONARY")

    if overrides:
        # Match case-insensitively without mutating the caller's mapping.
        for k, v in overrides.items():
            if _normalise(k) == fld:
                if override_source is FieldStatusSource.INFERRED:
                    reason = (
                        "inferred from observed data"
                        + (f" for account group {account_group}" if account_group else "")
                    )
                else:
                    reason = (
                        "live field-status group"
                        + (f" for account group {account_group}" if account_group else "")
                    )
                return FieldStatusResolution(
                    table=tbl,
                    field=fld,
                    status=v,
                    source=override_source,
                    reason=reason,
                    account_group=account_group,
                )

    meta = get_field_metadata(tbl, fld)
    if meta is None:
        # The dictionary has no opinion. Before giving up, recognise a
        # customer-namespace (Z/Y) field by its name: it is a real customer
        # extension, not noise. Custom append fields are optional at the DDIC
        # level (a customer cannot make a standard table's append mandatory
        # without a field-status group), so the honest baseline is OPTIONAL —
        # which live-SPRO or data inference can still upgrade. A non-custom field
        # the dictionary doesn't know stays "no opinion" (``None``).
        if is_custom_field(fld):
            return FieldStatusResolution(
                table=tbl,
                field=fld,
                status=FieldStatus.OPTIONAL,
                source=FieldStatusSource.CUSTOM,
                reason="customer-namespace (Z/Y) custom field, absent from the "
                "shipped dictionary — optional unless live config or inference "
                "says otherwise",
                account_group=account_group,
            )
        return None

    if meta.get("key"):
        return FieldStatusResolution(
            table=tbl,
            field=fld,
            status=FieldStatus.REQUIRED,
            source=FieldStatusSource.DICTIONARY,
            reason="key field (always mandatory)",
            account_group=account_group,
        )
    if meta.get("mandatory"):
        return FieldStatusResolution(
            table=tbl,
            field=fld,
            status=FieldStatus.REQUIRED,
            source=FieldStatusSource.DICTIONARY,
            reason="data dictionary marks field mandatory (baseline default)",
            account_group=account_group,
        )
    return FieldStatusResolution(
        table=tbl,
        field=fld,
        status=FieldStatus.OPTIONAL,
        source=FieldStatusSource.DICTIONARY,
        reason="not a key and not flagged mandatory in the data dictionary",
        account_group=account_group,
    )


def resolve_table_field_status(
    table: str,
    *,
    account_group: str | None = None,
    overrides: FieldStatusOverrides | None = None,
    override_source: FieldStatusSource = FieldStatusSource.LIVE_SPRO,
) -> dict[str, FieldStatusResolution]:
    """Resolve field status for every field of *table* in the data dictionary.

    Fields present in ``overrides`` but absent from the dictionary are still
    resolved (from the override) so live/inferred SUPPRESSED/DISPLAY states are
    not lost. ``override_source`` stamps the provenance of every override hit —
    ``LIVE_SPRO`` for a live customizing read, ``INFERRED`` for a status derived
    from observed data.
    """
    tbl = _normalise(table)
    table_meta = get_table_metadata(tbl) or {}

    fields: set[str] = {_normalise(f) for f in table_meta.keys()}
    if overrides:
        fields |= {_normalise(f) for f in overrides.keys()}

    resolved: dict[str, FieldStatusResolution] = {}
    for fld in sorted(fields):
        res = resolve_field_status(
            tbl,
            fld,
            account_group=account_group,
            overrides=overrides,
            override_source=override_source,
        )
        if res is not None:
            resolved[fld] = res
    return resolved


def required_fields(
    table: str,
    *,
    account_group: str | None = None,
    overrides: FieldStatusOverrides | None = None,
    override_source: FieldStatusSource = FieldStatusSource.LIVE_SPRO,
) -> list[str]:
    """Return the sorted list of fields resolved to ``REQUIRED`` for *table*."""
    return sorted(
        fld
        for fld, res in resolve_table_field_status(
            table,
            account_group=account_group,
            overrides=overrides,
            override_source=override_source,
        ).items()
        if res.status is FieldStatus.REQUIRED
    )


def resolve_field_status_smart(
    table: str,
    field: str,
    *,
    account_group: str | None = None,
    live_overrides: FieldStatusOverrides | None = None,
    inferred_overrides: FieldStatusOverrides | None = None,
) -> FieldStatusResolution | None:
    """Resolve field status using the full evidence cascade.

    Precedence — strongest evidence wins, mirroring
    :class:`FieldStatusSource`'s ordering:

      1. ``live_overrides`` — a field-status group read from live SAP customizing
         (``LIVE_SPRO``).
      2. ``inferred_overrides`` — status inferred from the customer's own data
         (``INFERRED``; see :mod:`sap.field_status_inference`).
      3. data dictionary baseline (``DICTIONARY``), or — for a ``Z``/``Y`` field
         the dictionary doesn't describe — a customer-namespace baseline
         (``CUSTOM``, ``OPTIONAL``).

    Each tier is consulted only for the *specific field*: if ``live_overrides``
    is supplied but does not mention ``field``, the cascade falls through to the
    inferred tier, then the dictionary/custom baseline — a present-but-silent
    mapping never blocks weaker evidence. Returns ``None`` only when no tier has
    an opinion (an unknown *standard*-namespace field/table).
    """
    if live_overrides:
        res = resolve_field_status(
            table,
            field,
            account_group=account_group,
            overrides=live_overrides,
            override_source=FieldStatusSource.LIVE_SPRO,
        )
        if res is not None and res.is_config_grounded:
            return res

    if inferred_overrides:
        res = resolve_field_status(
            table,
            field,
            account_group=account_group,
            overrides=inferred_overrides,
            override_source=FieldStatusSource.INFERRED,
        )
        if res is not None and res.is_data_grounded:
            return res

    return resolve_field_status(table, field, account_group=account_group)

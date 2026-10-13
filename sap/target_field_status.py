"""Target (S/4HANA) field-status resolution and the source → target delta.

A field's *required / optional / suppressed / display* state in the **target** can come from
four places — a live connection, a declared dictionary overlay, SAP documentation, or a
Signavio model — and is compared with the **source**'s state to surface the migration-relevant
deltas a plain DQ score cannot see:

  * a field required in S/4 but optional/suppressed in ECC will arrive **blank** (a migration
    blocker), and
  * a field required in ECC but suppressed in S/4 is maintained for nothing (wasted effort).

The source side of the delta is the existing :mod:`sap.field_status` resolver; this module
supplies the target side and the comparison.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

from sap.field_status import FieldStatus, FieldStatusResolution, FieldStatusSource, resolve_field_status


class TargetFieldStatusSource(str, enum.Enum):
    """Where the target's field status came from."""

    LIVE = "live"  # field-status groups read from a connected target (T130F/TMODU/TMODP …)
    DICTIONARY = "dictionary"  # a declared {"TABLE.FIELD": status} overlay stated by the customer
    DOCUMENTATION = "documentation"  # SAP field-status / Simplification List notes (not yet parsed)
    SIGNAVIO = "signavio"  # field requirements mined from an imported Signavio BPMN (not yet parsed)


def resolve_target_field_status(
    table: str,
    field: str,
    *,
    account_group: str | None = None,
    source: TargetFieldStatusSource = TargetFieldStatusSource.DICTIONARY,
    payload: dict | None = None,
) -> FieldStatusResolution | None:
    """Resolve one target field's status from ``source``.

    ``payload`` shapes:
      - ``dictionary``: ``{"TABLE.FIELD": "required"|"optional"|"suppressed"|"display"}`` — the
        customer's explicit target requirements. A field absent from the overlay falls back to
        the S/4 dictionary baseline (key/mandatory → required, else optional).
      - ``live``: ``{"groups": {account_group: {"FIELD": FieldStatus}}}` — the target's resolved
        field-status groups, from :mod:`sap.field_status_config` run against a connected target.

    ``documentation`` and ``signavio`` are recognised but not parsed yet: they fall back to the
    S/4 dictionary baseline, which is honest (no invented status) and swap-in later.
    """
    tbl = table.strip().upper()
    fld = field.strip().upper()

    if source is TargetFieldStatusSource.LIVE:
        groups = (payload or {}).get("groups", {})
        overrides = groups.get(account_group) if account_group else None
        return resolve_field_status(tbl, fld, account_group=account_group, overrides=overrides)

    if source is TargetFieldStatusSource.DICTIONARY:
        declared = (payload or {}).get(f"{tbl}.{fld}")
        if declared is not None:
            try:
                status = declared if isinstance(declared, FieldStatus) else FieldStatus(declared)
            except ValueError:
                status = FieldStatus(str(declared).lower())
            return FieldStatusResolution(
                table=tbl,
                field=fld,
                status=status,
                source=FieldStatusSource.LIVE_SPRO,
                reason="declared target field status",
                account_group=account_group,
            )

    # documentation / signavio / an undeclared dictionary field: the S/4 dictionary baseline.
    return resolve_field_status(tbl, fld, account_group=account_group)


@dataclass(frozen=True)
class FieldStatusDelta:
    """The migration-relevant gap between one source and one target field status."""

    table: str
    field: str
    account_group: str | None
    source_status: FieldStatus
    target_status: FieldStatus
    kind: str  # "blank_in_target" | "obsolete_in_target" | "none"

    @property
    def is_migration_risk(self) -> bool:
        return self.kind != "none"


def field_status_delta(
    source: FieldStatusResolution | None,
    target: FieldStatusResolution | None,
) -> FieldStatusDelta | None:
    """Classify the source→target field-status delta.

    Returns ``None`` when either side has no opinion (the field is unknown to the dictionary
    *and* to the customer namespace — absence must not be treated as a gap).

    Kinds:
      * ``blank_in_target`` — required in S/4, optional/suppressed/display in ECC → the field
        will arrive blank in the target.
      * ``obsolete_in_target`` — required in ECC, suppressed in S/4 → maintained for nothing.
      * ``none`` — no migration-relevant gap (the source is at least as strict as the target,
        or the two agree).
    """
    if source is None or target is None:
        return None
    s, t = source.status, target.status
    if t is FieldStatus.REQUIRED and s in (FieldStatus.OPTIONAL, FieldStatus.SUPPRESSED, FieldStatus.DISPLAY):
        kind = "blank_in_target"
    elif t is FieldStatus.SUPPRESSED and s is FieldStatus.REQUIRED:
        kind = "obsolete_in_target"
    else:
        kind = "none"
    return FieldStatusDelta(
        table=source.table,
        field=source.field,
        account_group=source.account_group,
        source_status=s,
        target_status=t,
        kind=kind,
    )

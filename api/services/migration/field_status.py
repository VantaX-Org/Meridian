"""Source → target field-status delta over a module's records.

Resolves, per record's account group, whether a field's *source* status (from the source's
field-selection customizing) and its *target* status (from the target resolver) differ in a
migration-relevant way, and reports the records that will arrive blank in S/4 or that are
maintained for nothing.

This is the config-grounded complement to the static ``s4hana_mandatory.yaml`` list the
migration engine already checks: it reads the customer's own field-selection customizing on
both sides instead of assuming the SAP-standard mandatory set.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from sap.field_status import FieldStatus, FieldStatusResolution, FieldStatusSource
from sap.target_field_status import field_status_delta


@dataclass(frozen=True)
class FieldStatusGap:
    """One migration-relevant field-status delta for a group of records."""

    table: str
    field: str
    group: str
    kind: str  # "blank_in_target" | "obsolete_in_target"
    record_keys: tuple[str, ...]


def _res(table: str, field: str, status: FieldStatus) -> FieldStatusResolution:
    return FieldStatusResolution(table=table, field=field, status=status,
                                 source=FieldStatusSource.LIVE_SPRO, reason="field-status delta")


def field_status_gaps(
    frame: pd.DataFrame,
    table: str,
    group_fields: str | list[str],
    source_groups: dict[str, dict[str, FieldStatus]],
    target_groups: dict[str, dict[str, FieldStatus]],
) -> list[FieldStatusGap]:
    """Report the records whose source→target field-status delta is a migration risk.

    ``source_groups`` / ``target_groups`` are ``{account_group: {FIELD: FieldStatus}}`` — the
    already-resolved field status per group (``sap.field_status_config.resolve`` for the source;
    ``sap.target_field_status.resolve_target_field_status`` for the target). ``group_fields`` is
    the frame column(s) carrying each record's account group — a single column
    (``"LFA1.KTOKK"``) or a composite key (``["MARA.MTART", "MARA.MBRSH"]`` → ``"MTART|MBRSH"``).

    Only fields with an opinion on *both* sides are judged — a missing status on either side
    is not a gap (the caller must not treat absence as optional).
    """
    cols = [group_fields] if isinstance(group_fields, str) else list(group_fields)
    if frame is None or frame.empty or any(c not in frame.columns for c in cols):
        return []

    fields: set[str] = set()
    for groups in (source_groups, target_groups):
        for statuses in groups.values():
            fields.update(statuses)

    if len(cols) == 1:
        grouped = frame.groupby(cols[0], dropna=True).groups
    else:
        # composite group key (e.g. material type | industry sector)
        key = frame[cols].astype("string").fillna("").agg("|".join, axis=1)
        grouped = frame.groupby(key, dropna=False).groups

    gaps: list[FieldStatusGap] = []
    for field in sorted(fields):
        for group, idx in grouped.items():
            g = str(group).strip()
            s = (source_groups.get(g) or {}).get(field)
            t = (target_groups.get(g) or {}).get(field)
            if s is None or t is None:
                continue
            delta = field_status_delta(_res(table, field, s), _res(table, field, t))
            if delta is not None and delta.kind != "none":
                gaps.append(FieldStatusGap(table, field, g, delta.kind, tuple(idx)))
    return gaps


def resolve_source_groups(
    session, system_id: str | None,
) -> dict[str, tuple[str | list[str], dict[str, dict[str, FieldStatus]]]]:
    """Resolve the source system's field status per record table.

    Returns ``{record_table: (group_field, {account_group: {TABLE.FIELD: FieldStatus}})}`` where
    ``group_field`` is a single frame column (``"LFA1.KTOKK"``) or a composite pair
    (``["MARA.MTART", "MARA.MBRSH"]``) for the material master. ``resolve_all`` covers the
    vendor/customer single-group segments; ``resolve_material`` covers the material composite.
    """
    from checks.field_status_rules import load_config
    from sap.field_status_config import resolve_all, resolve_material

    config = load_config(session, system_id)
    if not config:
        return {}
    from sap.ddic import dictionary_for_system
    dictionary = dictionary_for_system("ecc")

    out: dict[str, tuple[str | list[str], dict[str, dict[str, FieldStatus]]]] = {}
    for res in resolve_all(config):
        seg = res.segment
        entry = out.get(seg.record_table)
        if entry is None:
            entry = (seg.group_source, {})
            out[seg.record_table] = entry
        for group, statuses in res.groups.items():
            bucket = entry[1].setdefault(group, {})
            for col, st in statuses.items():
                bucket[col] = FieldStatus(st)

    # Material master: resolve_material returns {TABLE.FIELD: {"MTART|MBRSH": status}} — invert to
    # {group: {FIELD: status}} per material table, keyed by the MTART|MBRSH composite. Only MARA is
    # returned: its frame carries MTART and MBRSH directly; MAKT needs a MATNR→MARA join for its group.
    mat = resolve_material(config, dictionary)
    if mat:
        by_table: dict[str, dict[str, dict[str, FieldStatus]]] = {}
        for col, groups in mat.items():
            table = col.split(".", 1)[0]
            if table != "MARA":
                continue
            bucket = by_table.setdefault(table, {})
            for group, st in groups.items():
                bucket.setdefault(group, {})[col] = FieldStatus(st)
        for table, groups in by_table.items():
            out[table] = (["MARA.MTART", "MARA.MBRSH"], groups)
    return out

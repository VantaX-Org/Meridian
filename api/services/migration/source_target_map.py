"""Source-field → destination-SAP-field map.

Loaded from ``transfer_field_mappings`` by the route/worker and handed into the
engine as a plain object — the engine never touches Postgres.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class TargetFieldRef:
    """A resolved destination target for one source field."""

    dest_table: Optional[str]
    dest_field: Optional[str]
    transform_note: Optional[str] = None
    is_confirmed: bool = False

    @property
    def is_mapped(self) -> bool:
        return bool(self.dest_table and self.dest_field)

    @property
    def qualified(self) -> Optional[str]:
        return f"{self.dest_table}.{self.dest_field}" if self.is_mapped else None


class SourceTargetMap:
    """Per-module source→target lookup built from transfer_field_mappings rows.

    Each row is a dict with at least ``module``, ``source_field``, ``dest_table``,
    ``dest_field`` (the column names from ``transfer_field_mappings``).
    """

    def __init__(self, rows: list[dict]) -> None:
        # (module, source_field_upper) -> TargetFieldRef
        self._by_field: dict[tuple[str, str], TargetFieldRef] = {}
        self._by_module: dict[str, list[TargetFieldRef]] = {}
        for r in rows:
            module = r["module"]
            sf = str(r["source_field"]).strip().upper()
            ref = TargetFieldRef(
                dest_table=(r.get("dest_table") or None),
                dest_field=(r.get("dest_field") or None),
                transform_note=r.get("transform_note"),
                is_confirmed=bool(r.get("is_confirmed")),
            )
            self._by_field[(module, sf)] = ref
            self._by_module.setdefault(module, []).append(ref)

    def resolve(self, module: str, source_field: str) -> Optional[TargetFieldRef]:
        return self._by_field.get((module, str(source_field).strip().upper()))

    def all_target_fields(self, module: str) -> list[TargetFieldRef]:
        return [r for r in self._by_module.get(module, []) if r.is_mapped]

    def primary_table(self, module: str) -> Optional[str]:
        """Most-referenced destination table for the module (best-effort)."""
        tables = [r.dest_table for r in self.all_target_fields(module) if r.dest_table]
        if not tables:
            return None
        return Counter(t.upper() for t in tables).most_common(1)[0][0]

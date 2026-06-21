"""Source→destination field map, loaded from transfer_field_mappings.

The route loads rows from Postgres and hands a SourceTargetMap to the engine;
the engine never touches the database. dest_field NULL ⇒ steward explicitly
left the field unmapped (skip), distinct from "no row exists yet".
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TargetFieldRef:
    dest_table: str | None
    dest_field: str | None
    transform_note: str | None = None

    @property
    def is_mapped(self) -> bool:
        return bool(self.dest_table and self.dest_field)


class SourceTargetMap:
    """Resolve source field → destination field for one (module, dest_system_type)."""

    def __init__(self, rows: list[dict]):
        # rows: dicts with module, source_field, dest_table, dest_field, transform_note
        self._by_module: dict[str, dict[str, TargetFieldRef]] = {}
        for r in rows:
            module = r["module"]
            self._by_module.setdefault(module, {})[r["source_field"].upper()] = TargetFieldRef(
                dest_table=(r.get("dest_table") or None),
                dest_field=(r.get("dest_field") or None),
                transform_note=r.get("transform_note"),
            )

    def resolve(self, module: str, source_field: str) -> TargetFieldRef | None:
        return self._by_module.get(module, {}).get(source_field.upper())

    def primary_table(self, module: str) -> str | None:
        """Most-mapped destination table for the module — its master table."""
        counts: dict[str, int] = {}
        for ref in self._by_module.get(module, {}).values():
            if ref.dest_table:
                counts[ref.dest_table] = counts.get(ref.dest_table, 0) + 1
        if not counts:
            return None
        return max(counts, key=counts.get)

    def all_target_fields(self, module: str) -> list[TargetFieldRef]:
        return [r for r in self._by_module.get(module, {}).values() if r.is_mapped]

    def mapped_field_count(self, module: str) -> int:
        return len(self.all_target_fields(module))

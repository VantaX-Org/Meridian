"""ODP provider -> SAP table mapping (sap/odp_mappings.yaml).

An ODP provider carries extractor or CDS fields; Meridian's rules read SAP table fields. This module loads the
mapping, picks the provider that covers most of what a table's plan needs, and turns an ODP read into the table
reader's frame (SAP field names as columns, in the plan's order).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
import yaml

from .odp import CONTEXTS

_FILE = Path(__file__).resolve().parent / "odp_mappings.yaml"


@dataclass(frozen=True)
class ODPMapping:
    odp: str
    context: str
    table: str
    systems: tuple[str, ...]
    fields: dict[str, str]          # TABLE_FIELD -> PROVIDER_FIELD
    view: Optional[str] = None      # the CDS view name (ABAP_CDS), for people reading the log
    confirm: bool = False           # provider name or release to be confirmed on the system

    def covers(self, needed: list[str]) -> list[str]:
        """The ``needed`` table fields this provider does not map."""
        return [f for f in needed if f not in self.fields]


@lru_cache(maxsize=1)
def mappings() -> tuple[ODPMapping, ...]:
    doc = yaml.safe_load(_FILE.read_text()) or {}
    out = []
    for p in doc.get("providers") or []:
        if p["context"] not in CONTEXTS:
            raise ValueError(f"odp_mappings.yaml: {p['odp']} has unknown context {p['context']}")
        out.append(ODPMapping(odp=str(p["odp"]), context=p["context"], table=p["table"],
                              systems=tuple(p.get("systems") or ()),
                              fields={str(k): str(v) for k, v in (p.get("fields") or {}).items()},
                              view=p.get("view"), confirm=bool(p.get("confirm"))))
    return tuple(out)


def mappings_for(table: str, system_type: str) -> list[ODPMapping]:
    return [m for m in mappings() if m.table == table and system_type in m.systems]


def mapping(odp: str, context: str) -> ODPMapping:
    found = next((m for m in mappings() if m.odp == odp and m.context == context), None)
    if found is None:
        raise KeyError(f"no ODP mapping for {odp} ({context})")
    return found


def best_mapping(table: str, system_type: str, needed: list[str]) -> Optional[ODPMapping]:
    """The provider that leaves the fewest ``needed`` fields unmapped (file order breaks ties); None = no provider."""
    candidates = mappings_for(table, system_type)
    if not candidates:
        return None
    return min(candidates, key=lambda m: (len(m.covers(needed)), candidates.index(m)))


def to_table_frame(provider_rows: pd.DataFrame, m: ODPMapping, cols: list[str]) -> tuple[pd.DataFrame, list[str]]:
    """The provider rows as the table reader's frame: ``cols`` that the provider delivered, renamed to the SAP
    field names, in ``cols`` order. Returns (frame, cols the provider did not deliver)."""
    by_upper = {c.upper(): c for c in provider_rows.columns}
    data: dict[str, pd.Series] = {}
    missing: list[str] = []
    for c in cols:
        src = m.fields.get(c)
        col = by_upper.get(src.upper()) if src else None
        if col is None:
            missing.append(c)
            continue
        data[c] = provider_rows[col].astype(str).str.strip()
    frame = pd.DataFrame(data, index=provider_rows.index) if data else pd.DataFrame(index=provider_rows.index)
    return frame.reset_index(drop=True), missing

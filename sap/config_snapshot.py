"""System-neutral configuration snapshot: one shape for every connector.

A snapshot is a set of config items keyed by ``object`` + ``key`` (``TVAK`` / ``AUART=ZOR`` on an ABAP
system, ``FOPayGroup`` / ``externalCode=EU1`` on SuccessFactors), plus one state per object saying whether it was
read. ``role`` (source | target) and ``origin`` (connection | best_practice | upload) say what the snapshot is, so two
snapshots of different systems can be compared key by key. Config rows only, never transactional or master data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Literal, Optional

import pandas as pd

Role = Literal["source", "target"]
Origin = Literal["connection", "best_practice", "upload"]
ROLES = ("source", "target")
ORIGINS = ("connection", "best_practice", "upload")

# object states: loaded (rows), empty (read fine, no rows), failed (read error), not_available (system has no API)
LOADED, EMPTY, FAILED, NOT_AVAILABLE = "loaded", "empty", "failed", "not_available"


@dataclass
class ObjectState:
    object: str
    state: str
    rows: int = 0
    detail: str = ""
    truncated: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {"object": self.object, "state": self.state, "rows": self.rows, "detail": self.detail,
                "truncated": self.truncated}


@dataclass
class ConfigItem:
    object: str
    key: str  # canonical "FIELD=value,FIELD2=value2" in key-field order
    values: dict[str, Any]


def item_key(row: dict[str, Any], key_fields: Iterable[str]) -> str:
    return ",".join(f"{k}={str(row.get(k, '')).strip()}" for k in key_fields)


@dataclass
class ConfigSnapshot:
    system_type: str
    system_id: Optional[str] = None
    role: Role = "source"
    origin: Origin = "connection"
    objects: dict[str, ObjectState] = field(default_factory=dict)
    items: list[ConfigItem] = field(default_factory=list)

    def add_frame(self, obj: str, df: pd.DataFrame, key_fields: Iterable[str], truncated: bool = False) -> None:
        """Record one config object from a frame (plain column names)."""
        if df is None or df.empty:
            self.objects[obj] = ObjectState(obj, EMPTY)
            return
        keys = [k for k in key_fields if k in df.columns] or [df.columns[0]]
        clean = df.astype(object).where(df.notna(), None)
        for row in clean.to_dict("records"):
            self.items.append(ConfigItem(obj, item_key(row, keys), row))
        self.objects[obj] = ObjectState(obj, LOADED, len(df), truncated=truncated)

    def mark(self, obj: str, state: str, detail: str = "") -> None:
        self.objects[obj] = ObjectState(obj, state, detail=detail[:200])

    def frames(self) -> dict[str, pd.DataFrame]:
        """Loaded objects back as plain-column frames (what flow derivation reads)."""
        by: dict[str, list[dict]] = {}
        for it in self.items:
            by.setdefault(it.object, []).append(it.values)
        return {o: pd.DataFrame(rows) for o, rows in by.items()}

    def summary(self) -> dict[str, int]:
        out = {LOADED: 0, EMPTY: 0, FAILED: 0, NOT_AVAILABLE: 0}
        for s in self.objects.values():
            out[s.state] = out.get(s.state, 0) + 1
        return out

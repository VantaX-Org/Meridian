"""S/4HANA load dry run. Pure, deterministic simulation over source TableFrames.
Emits engine.Gap rows (gap_type 's4_load') whose detail starts with the S4L rule id."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml

_FILE = Path(__file__).resolve().parents[3] / "sap" / "dictionaries" / "migration" / "s4_load_rules.yaml"


@dataclass(frozen=True)
class S4LRule:
    id: str
    area: str
    severity: str
    reason: str
    target: str
    related: tuple[str, ...]


@lru_cache(maxsize=1)
def rules() -> dict[str, S4LRule]:
    doc = yaml.safe_load(_FILE.read_text())
    return {r["id"]: S4LRule(r["id"], r["area"], r["severity"], r["reason"], r["target"],
                             tuple(r.get("related") or ())) for r in doc["rules"]}

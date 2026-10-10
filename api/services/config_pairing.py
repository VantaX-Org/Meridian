"""Config intelligence: source/target pairing, deterministic config comparison and realignment.

Matching is deterministic (no LLM). Every proposal goes to the steward queue and is used only once confirmed.
Read only towards SAP: this module reads stored config_items and writes Meridian tables only.
"""

from __future__ import annotations

import difflib
from dataclasses import asdict, dataclass
from typing import Optional

import pandas as pd

from sap.config_snapshot import NOT_AVAILABLE, ConfigItem, ConfigSnapshot

DESC_FIELDS = ("TXT30", "TEXT1", "TXTMD", "BUTXT", "NAME1", "MTBEZ", "TEXT", "LTEXT", "MSEHT", "MSEHL",
               "LGOBE", "DESCRIPTION")
BASELINE_DETAIL = "SAP standard baseline; no configuration API"
BASELINE_LABEL = "baseline target"
BASELINE_TYPE = "s4hana_cloud"
DESC_MATCH_MAX = 2000
DESC_CUTOFF = 0.85
STALE_MINUTES = 30
ITEM_CAP = 20000
STATUSES = ("exists", "key_match", "desc_match", "missing")


def normalise(v: str) -> str:
    """Strip, upper-case and drop leading zeros ('0001' -> '1', '000' -> '0')."""
    s = v.strip().upper()
    return s.lstrip("0") or ("0" if s else "")


def parse_key(key: str) -> dict[str, str]:
    # ponytail: splits on ',' and '='; a key value containing a comma parses wrongly. Store keys as JSON if one does.
    return dict(p.partition("=")[::2] for p in key.split(",") if p)


def normalise_key(key: str) -> str:
    return ",".join(f"{f}={normalise(v)}" for f, v in parse_key(key).items())


def _desc(values: dict[str, object]) -> Optional[str]:
    for f in DESC_FIELDS:
        v = values.get(f)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _diff_field(a: str, b: str) -> Optional[tuple[str, str, str]]:
    """(field, a value, b value) when the two keys differ in exactly one field."""
    pa, pb = parse_key(a), parse_key(b)
    if pa.keys() != pb.keys():
        return None
    diffs = [f for f in pa if pa[f] != pb[f]]
    return (diffs[0], pa[diffs[0]], pb[diffs[0]]) if len(diffs) == 1 else None


@dataclass
class MatchRow:
    object: str
    source_key: str
    status: str  # exists | key_match | desc_match | missing
    target_key: Optional[str] = None
    score: Optional[float] = None
    field: Optional[str] = None
    source_value: Optional[str] = None
    target_value: Optional[str] = None
    description: Optional[str] = None

    @property
    def proposable(self) -> bool:
        return self.status in ("key_match", "desc_match") and self.field is not None

    def as_dict(self) -> dict[str, object]:
        return {**asdict(self), "proposable": self.proposable}


def compare_object(obj: str, source: list[ConfigItem], target: list[ConfigItem]) -> list[MatchRow]:
    """Classify each source key: exists, key_match (normalised key), desc_match (difflib), missing."""
    exact = {t.key for t in target}
    by_norm = {normalise_key(t.key): t.key for t in target}
    by_desc: dict[str, str] = {}
    # ponytail: description matching is O(n·m); skipped above DESC_MATCH_MAX target items. Index by token if needed.
    if len(target) <= DESC_MATCH_MAX:
        for t in target:
            d = _desc(t.values)
            if d:
                by_desc.setdefault(d.upper(), t.key)
    rows: list[MatchRow] = []
    for it in source:
        desc = _desc(it.values)
        if it.key in exact:
            rows.append(MatchRow(obj, it.key, "exists", it.key, 1.0, description=desc))
            continue
        tk, status, score = by_norm.get(normalise_key(it.key)), "key_match", 1.0
        if tk is None and by_desc and desc:
            hit = difflib.get_close_matches(desc.upper(), list(by_desc), n=1, cutoff=DESC_CUTOFF)
            if hit:
                tk, status = by_desc[hit[0]], "desc_match"
                score = round(difflib.SequenceMatcher(None, desc.upper(), hit[0]).ratio(), 3)
        if tk is None:
            rows.append(MatchRow(obj, it.key, "missing", description=desc))
            continue
        field, sv, tv = _diff_field(it.key, tk) or (None, None, None)
        rows.append(MatchRow(obj, it.key, status, tk, score, field, sv, tv, desc))
    return rows


def baseline_snapshot(system_type: str) -> ConfigSnapshot:
    """The SAP standard baseline of ``system_type`` as a best-practice snapshot."""
    from api.services.connectivity_manager import baseline_key
    from sap.baseline_config import BASELINE_CONFIG
    from sap.ddic import dictionary_for_system

    snap = ConfigSnapshot(system_type, origin="best_practice")
    ddic = dictionary_for_system(system_type)
    for tables in BASELINE_CONFIG.get(baseline_key(system_type), {}).values():
        for table, rows in tables.items():
            if table in snap.objects:
                continue
            snap.add_frame(table, pd.DataFrame(rows), ddic.keys(table))
    for st in snap.objects.values():
        st.detail = BASELINE_DETAIL
    return snap


def with_baseline(snap: ConfigSnapshot, system_type: str) -> tuple[ConfigSnapshot, str]:
    """Swap a no-API snapshot (no items, every object NOT_AVAILABLE) for the type's baseline."""
    if snap.items or not snap.objects or any(st.state != NOT_AVAILABLE for st in snap.objects.values()):
        return snap, snap.origin
    base = baseline_snapshot(system_type)
    if not base.items:
        return snap, snap.origin
    base.system_id, base.role = snap.system_id, snap.role
    return base, "best_practice"


def pair_error(source_role: str, target_role: str, same: bool) -> Optional[str]:
    if same:
        return "A system cannot be its own target."
    if source_role == "target":
        return "A target system cannot have a target of its own."
    if target_role != "target":
        return "The assigned system must have the target role."
    return None

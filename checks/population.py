"""Active population: SAP-standard flags that take a record out of a rule's
judgement (deleted, one-time account, retired, rejected) — see
sap/dictionaries/populations.yaml. Every exclusion is counted, never silent."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd
import yaml

_PATH = Path(__file__).resolve().parent.parent / "sap" / "dictionaries" / "populations.yaml"


@lru_cache(maxsize=1)
def policy() -> dict[str, list[dict]]:
    return yaml.safe_load(_PATH.read_text())["tables"]


def fields_for(table: str) -> set[str]:
    """Flag fields on ``table`` itself that the extraction must read."""
    return {x["field"].split(".", 1)[1] for xs in policy().values() for x in xs
            if x["field"].split(".", 1)[0] == table}


def exclusions(rule: dict, tables: list[str], columns: list[str]) -> list[dict]:
    """The exclusions that apply to a rule evaluated at ``tables`` (its grain)."""
    if rule.get("population") == "all":
        return []
    own = set(columns)
    out = []
    for t in tables:
        for x in policy().get(t, []):
            if x["field"] in own:
                continue  # never filter a rule by the flag it validates
            only = x.get("only_fields")
            if only and not any(c in only or (c.split(".", 1)[0] == t and c.split(".", 1)[1] in only) for c in own):
                continue  # names are fields of this table; TABLE.FIELD entries reach attribute tables (ADR6)
            out.append(x)
    return out


def _status_values(x: dict, frames) -> set[str]:
    """Objects carrying a status in a status table (JEST: OBJNR with STAT I0076, INACT blank)."""
    spec = x["in_table"]
    t = getattr(frames, "frames", {}).get(spec["table"]) if frames is not None else None
    if t is None:
        return set()
    mask = pd.Series(True, index=t.index)
    for f, allowed in spec.get("where", {}).items():
        col = f"{spec['table']}.{f}"
        if col not in t.columns:
            return set()
        mask &= t[col].astype("string").str.strip().fillna("").isin([str(a) for a in allowed])
    return set(t.loc[mask, f"{spec['table']}.{spec['column']}"].astype("string").str.strip())


def exclude(frame: pd.DataFrame, rules: list[dict], frames=None) -> tuple[pd.DataFrame, dict[str, int]]:
    """Drop excluded records; count each once, under its first reason."""
    if not rules:
        return frame, {}
    out = pd.Series(False, index=frame.index)
    counts: dict[str, int] = {}
    for x in rules:
        cols = x.get("fields") or [x["field"]]
        if any(c not in frame.columns for c in cols):
            continue
        parts = [frame[c].astype("string").str.strip().fillna("") for c in cols]
        v = parts[0]
        for p in parts[1:]:  # composite key, e.g. material type | industry sector
            v = v + "|" + p
        if x.get("in_table"):
            hit = v.isin(_status_values(x, frames))
        else:
            hit = v.isin([str(a) for a in x["values"]]) if x.get("values") else v.ne("") & v.ne("00000000")
        hit &= ~out
        if hit.any():
            counts[x["id"]] = counts.get(x["id"], 0) + int(hit.sum())
            out |= hit
    return frame[~out], counts

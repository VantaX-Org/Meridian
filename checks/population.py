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
            if only and not any(c.split(".", 1)[1] in only for c in own if c.split(".", 1)[0] == t):
                continue
            out.append(x)
    return out


def exclude(frame: pd.DataFrame, rules: list[dict]) -> tuple[pd.DataFrame, dict[str, int]]:
    """Drop excluded records; count each once, under its first reason."""
    if not rules:
        return frame, {}
    out = pd.Series(False, index=frame.index)
    counts: dict[str, int] = {}
    for x in rules:
        if x["field"] not in frame.columns:
            continue
        v = frame[x["field"]].astype("string").str.strip().fillna("")
        hit = v.isin([str(a) for a in x["values"]]) if x.get("values") else v.ne("") & v.ne("00000000")
        hit &= ~out
        if hit.any():
            counts[x["id"]] = counts.get(x["id"], 0) + int(hit.sum())
            out |= hit
    return frame[~out], counts

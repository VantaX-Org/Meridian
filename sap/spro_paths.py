"""IMG (SPRO) menu path + tcode per config table (ECC / S/4HANA on-premise), from ``spro_paths.yaml``."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ABAP_ONPREM = ("ecc", "s4hana_onprem")


@lru_cache(maxsize=1)
def spro_paths() -> dict[str, dict[str, str]]:
    return yaml.safe_load((Path(__file__).with_name("spro_paths.yaml")).read_text()) or {}


def enrich_evidence(node: Any, system_type: str) -> Any:
    """Add ``spro_path``/``tcode`` to every evidence dict ({table, keys, value}) in a derived model document.
    No-op for systems without an IMG."""
    if system_type not in ABAP_ONPREM:
        return node
    paths = spro_paths()
    if isinstance(node, dict):
        if {"table", "keys", "value"} <= node.keys() and node["table"] in paths:
            node["spro_path"] = paths[node["table"]]["path"]
            node["tcode"] = paths[node["table"]]["tcode"]
        for v in node.values():
            enrich_evidence(v, system_type)
    elif isinstance(node, list):
        for v in node:
            enrich_evidence(v, system_type)
    return node

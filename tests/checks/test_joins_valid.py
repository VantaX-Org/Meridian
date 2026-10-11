"""Every field an edge names exists in the shipped dictionaries (joins.yaml header promise)."""

from pathlib import Path

import pytest
import yaml

from sap.ddic import get_dictionary

_DICT = Path(__file__).resolve().parents[2] / "sap" / "dictionaries"
_ECC, _S4 = get_dictionary("ecc6"), get_dictionary("s4hana")


def _edges(name: str) -> list[dict]:
    return yaml.safe_load((_DICT / name).read_text())["edges"]


def _missing(edges: list[dict]) -> list[str]:
    out = []
    for e in edges:
        child = list(e["join"]) + list(e.get("filter") or {}) + list(e.get("prefer") or {})
        for table, fields in ((e["child"], child), (e["parent"], list(e["join"].values()))):
            out += [f"{e['parent']}->{e['child']}: {table}.{f}" for f in fields
                    if _ECC.field(table, f) is None and _S4.field(table, f) is None]
    return out


@pytest.mark.parametrize("name", ["joins.yaml", "process_event_joins.yaml"])
def test_every_edge_field_exists(name: str) -> None:
    assert _missing(_edges(name)) == []


def test_process_event_edges_do_not_repeat_joins_yaml() -> None:
    grain = {(e["parent"], e["child"]) for e in _edges("joins.yaml")}
    assert [(e["parent"], e["child"]) for e in _edges("process_event_joins.yaml")
            if (e["parent"], e["child"]) in grain] == []

"""The handover purge must empty children before parents.

Most foreign keys onto ``analysis_versions`` are RESTRICT, not CASCADE, so deleting a
version before its findings fails the whole statement. The delete order is computed from
the live foreign keys rather than hand-written, and this pins the two properties that
matter: children go first, and a dependency cycle cannot hang the purge.
"""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _purge():
    spec = importlib.util.spec_from_file_location("purge_tenant_data",
                                                  ROOT / "scripts" / "purge_tenant_data.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_a_child_is_deleted_before_its_parent():
    mod = _purge()
    # findings -> analysis_versions -> tenants, the real shape that bit us
    order = mod._order(["findings", "analysis_versions"], [("findings", "analysis_versions")])
    assert order.index("findings") < order.index("analysis_versions"), order


def test_a_diamond_puts_the_leaf_first():
    mod = _purge()
    order = mod._order(["leaf", "mid1", "mid2"],
                       [("leaf", "mid1"), ("leaf", "mid2")])
    assert order[0] == "leaf", order


def test_a_cycle_does_not_hang_and_keeps_every_table():
    mod = _purge()
    order = mod._order(["a", "b"], [("a", "b"), ("b", "a")])
    assert sorted(order) == ["a", "b"], order


def test_kept_tables_are_not_purged():
    mod = _purge()
    # the handover keeps the connections and the people; everything else is data
    for required in ("sap_systems", "system_credentials", "system_module_map", "tenants", "users"):
        assert required in mod.KEEP, required
    for data in ("analysis_versions", "findings", "finding_records", "record_issues", "jobs"):
        assert data not in mod.KEEP, f"{data} is analysis data and must be purged"

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


def _preflight():
    spec = importlib.util.spec_from_file_location("handover_preflight",
                                                  ROOT / "scripts" / "handover_preflight.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_preflight_does_not_depend_on_a_reachable_server_to_import():
    """It runs against a client host; importing it must never touch docker."""
    mod = _preflight()
    assert mod.MIN_CHECK_LIMIT_H >= 12, "the ceiling must clear a large run's lifecycle"
    assert mod.MIN_FREE_GB > 0
    # a failed check is reported, not raised: each checker appends to results
    out: list[dict] = []
    mod.check_disk(out)
    assert out and out[0]["status"] in {"PASS", "WARN", "FAIL"}
    assert {"name", "status", "detail"} <= set(out[0])


def test_kept_tables_are_not_purged():
    mod = _purge()
    # the handover keeps the connections and the people; everything else is data
    for required in ("sap_systems", "system_credentials", "system_module_map", "tenants", "users"):
        assert required in mod.KEEP, required
    for data in ("analysis_versions", "findings", "finding_records", "record_issues", "jobs"):
        assert data not in mod.KEEP, f"{data} is analysis data and must be purged"


def _parity():
    spec = importlib.util.spec_from_file_location("sf_parity",
                                                  ROOT / "scripts" / "successfactors_parity.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_METADATA = """<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
 <edmx:DataServices>
  <Schema xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
   <EntityType Name="Position">
    <Property Name="code" Type="Edm.String"/>
    <NavigationProperty Name="companyNav"/>
   </EntityType>
   <EntityContainer Name="c">
    <EntitySet Name="Position" EntityType="Model.Position"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>
"""


def test_metadata_parsing_resolves_through_the_entity_type():
    """An EntitySet names a type; the properties live on the type.

    Keying properties on the set name resolves nothing for most entities, which is how
    a resolver reports false gaps.
    """
    exposed = _parity().parse_metadata(_METADATA)
    assert exposed["Position"] == {"code", "companyNav"}, exposed


def test_navigation_properties_count_as_resolvable():
    exposed = _parity().parse_metadata(_METADATA)
    assert _parity().resolve(exposed, "POSITION", "COMPANY", "Position", "companyNav") is None
    assert _parity().resolve(exposed, "POSITION", "COMPANY", "Position", "company") is not None


def test_report_counts_and_strict_gate():
    mod = _parity()
    exposed = mod.parse_metadata(_METADATA)
    tables = {"POSITION": {"fields": {
        "CODE": {"source": "Position.code"},          # resolves
        "CRITICALITY": {"source": "Position.criticality"},  # does not
        "ELSEWHERE": {"source": "Nope.thing"},         # entity absent
    }}}
    rows, summary = mod.report(exposed, tables)
    assert summary["declared"] == 3 and summary["resolved"] == 1 and summary["unresolved"] == 2
    assert {r["field"] for r in rows} == {"CRITICALITY", "ELSEWHERE"}
    assert summary["per_table"] == {"POSITION": 2}

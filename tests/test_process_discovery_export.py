"""Signavio export of a discovered model (spec §5.2): as-is flows, gateways, discovery metadata, per-node file."""

from __future__ import annotations

import dataclasses
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from typing import Union

import pytest

from api.models.process_model import L1, L2, L3, L4, L5, DiscoveryStats, ProcessModelDocument
from api.services.bpmn_export import (MER, SIG, ExportMeta, duration, export_node, export_zip, import_zip,
                                      landscape_edges)
from api.services.bpmn_validate import BPMN, validate_package
from api.services.process_discovery.generate import generate
from api.services.process_discovery.mining import Edge, MiningResult
from sap.process_definitions import reference_document
from tests.process_discovery.test_generate import HAPPY, MAP, ODD, REWORK, _result
from tests.test_bpmn_export import _files, _manifest, _xsd_validate

META: ExportMeta = {"model_id": None, "name": "PTP as-is", "version_no": 1, "exported_at": "2026-10-11T00:00:00Z",
        "app_version": "1.0.0",
        "discovery": {"run_id": "r1", "window": {"from": "2025-01-01", "to": "2025-12-31"}, "edge_threshold": 0.01}}


Files = dict[str, bytes]
# Resource-like values that must never reach an export: an email, a user id, a case id.
LEAKY = ("owner@example.com", "U_JSMITH", "CASE-4500012345")


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


@pytest.fixture(scope="module")
def doc() -> ProcessModelDocument:
    po = _result("po_item", [(HAPPY, 6), (REWORK, 3), (ODD, 1)],
                 [Edge("CREATE_PO_ITEM", "CHANGE_PO_QTY", 3, 3, 3600.0, 7200.0)])
    # The mined variants carry event-level values (case ids, a user, an email) as the SQL would sample them.
    po.variants = [dataclasses.replace(v, sample_case_ids=LEAKY) for v in po.variants]
    mined = MiningResult("PTP", "po_item", {"po_item": po, "vendor": _result("vendor", [(("CREATE_VENDOR",), 2)])})
    return generate(reference_document(), mined, MAP, system_type="ecc").document


@pytest.fixture(scope="module")
def files(doc: ProcessModelDocument) -> Files:
    return _files(export_zip(doc, None, META))


def _proc(files: Files, name: str) -> ET.Element:
    return ET.fromstring(files[name]).find(_q(BPMN, "process"))


def _flows(proc: ET.Element) -> dict[tuple[str, str], str | None]:
    return {(f.get("sourceRef"), f.get("targetRef")): f.get("name") for f in proc.iter(_q(BPMN, "sequenceFlow"))}


def test_package_validates(files: Files) -> None:
    bpmn = {k: v for k, v in files.items() if k.endswith(".bpmn")}
    assert validate_package(bpmn, _manifest(files)) == []
    _xsd_validate(files)


def test_structure_called_elements_gateways_and_ids(files: Files) -> None:
    pids = {_proc(files, n).get("id") for n in files if n.endswith(".bpmn")}
    for name in (n for n in files if n.endswith(".bpmn")):
        proc = _proc(files, name)
        ids = [e.get("id") for e in proc.iter() if e.get("id") and e.tag.startswith(f"{{{BPMN}}}")]
        assert len(ids) == len(set(ids)), name
        for ca in proc.iter(_q(BPMN, "callActivity")):
            assert ca.get("calledElement") in pids
        for gw in proc.iter(_q(BPMN, "exclusiveGateway")):
            assert len(gw.findall(_q(BPMN, "incoming"))) > 1 or len(gw.findall(_q(BPMN, "outgoing"))) > 1, name


def test_l1_landscape_is_the_as_is_flow(files: Files) -> None:
    proc = _proc(files, "L1_PTP.bpmn")
    flows = _flows(proc)
    assert flows[("E_START", "GW_START_OUT")] is None
    assert flows[("GW_START_OUT", "CA_PTP-PO")] == "10 cases" and flows[("GW_START_OUT", "CA_PTP-VM")] == "2 cases"
    assert flows[("CA_PTP-PO", "GW_PTP-PO_OUT")] is None
    assert flows[("GW_PTP-PO_OUT", "CA_PTP-GR")] == "9 cases" and flows[("GW_PTP-PO_OUT", "CA_PTP-DSC")] == "1 cases"
    assert flows[("CA_PTP-GR", "GW_PTP-IV_IN")] == "9 cases" and flows[("GW_PTP-IV_IN", "CA_PTP-IV")] is None
    assert flows[("CA_PTP-PAY", "E_END")] == "9 cases"
    assert all("CA_PTP-PR" not in k for k in flows)  # never observed: drawn unconnected
    gw = {g.get("id"): g.get("gatewayDirection") for g in proc.iter(_q(BPMN, "exclusiveGateway"))}
    assert gw["GW_PTP-PO_OUT"] == "Diverging" and gw["GW_PTP-IV_IN"] == "Converging"
    edge = next(f for f in proc.iter(_q(BPMN, "sequenceFlow")) if f.get("name") == "9 cases")
    assert edge.find(f"{_q(BPMN, 'extensionElements')}/{_q(SIG, 'signavioMetaData')}").get("metaValue") == "9"


def test_task_carries_discovery_metadata(files: Files) -> None:
    proc = _proc(files, "L4_PTP-PO-ME21N.bpmn")
    task = next(t for t in proc.iter(_q(BPMN, "task")) if t.get("id") == "A_PTP-PO-ME21N-02")
    sig = {m.get("metaKey"): m.get("metaValue") for m in task.iter(_q(SIG, "signavioMetaData"))}
    assert (sig["meridian_case_count"], sig["meridian_share"], sig["meridian_median"], sig["meridian_source"]) == (
        "10", "100.0", "1m", "template")
    md = task.find(f"{_q(BPMN, 'extensionElements')}/{_q(MER, 'discovery')}")
    assert md.get("caseCount") == "10" and md.get("observed") == "true"
    assert "Cases: 10 (100.0%)" in task.findtext(_q(BPMN, "documentation"))
    extra = next(t for t in proc.iter(_q(BPMN, "task")) if t.get("id") == "A_PTP-PO-ME21N-X_CHANGE_QTY")
    assert "Source: discovered, not in reference" in extra.findtext(_q(BPMN, "documentation"))
    three = next(f for f in proc.iter(_q(BPMN, "sequenceFlow")) if f.get("name") == "3 cases")
    assert three.find(f".//{_q(SIG, 'signavioMetaData')}").get("metaValue") == "3"


def test_manifest_and_readme(files: Files) -> None:
    assert _manifest(files)["discovery"] == META["discovery"]
    readme = files["README.txt"].decode()
    assert "directly-follows" in readme and "2025-01-01" in readme and "po_item" in readme


def test_round_trip(doc: ProcessModelDocument) -> None:
    data = export_zip(doc, None, META)
    back = import_zip(data)
    assert [x.id for x in back.all_l4()] == [x.id for x in doc.all_l4()]


def test_reference_model_keeps_the_linear_landscape() -> None:
    ref = reference_document()
    assert landscape_edges(ref.l1[0], ref.l1[0].l2) is None


def test_export_node_matches_the_zip(doc: ProcessModelDocument, files: Files) -> None:
    for node_id, name in (("PTP", "L1_PTP.bpmn"), ("PTP-PO-ME21N", "L4_PTP-PO-ME21N.bpmn")):
        assert export_node(doc, node_id, None, META) == (name, files[name])
    with pytest.raises(KeyError):
        export_node(doc, "NOPE", None, META)


@pytest.mark.parametrize("seconds, text", [(40, "40s"), (420, "7m"), (5 * 3600 + 720, "5h 12m"),
                                           (3 * 86400 + 4 * 3600, "3d 4h")])
def test_duration(seconds: int, text: str) -> None:
    assert duration(seconds) == text


def _walk(doc: ProcessModelDocument) -> Iterator[Union[L1, L2, L3, L4, L5]]:
    for l1 in doc.l1:
        yield l1
        for l2 in l1.l2:
            yield l2
            for l3 in l2.l3:
                yield l3
                yield from l3.l4
                for l4 in l3.l4:
                    yield from l4.activities


def test_bytes_are_stable_across_exports_and_edge_order(doc: ProcessModelDocument) -> None:
    data = export_zip(doc, None, META)
    assert data == export_zip(doc, None, META)
    shuffled = doc.model_copy(deep=True)
    for n in _walk(shuffled):
        if n.discovery is not None:
            n.discovery.edges.reverse()
    assert export_zip(shuffled, None, META) == data


def test_no_event_resources_in_export(files: Files) -> None:
    text = b"".join(files.values()).decode()
    for needle in (*LEAKY, "@", "case_id", "user_id"):
        assert needle not in text, needle


def test_export_never_sums_event_counts_across_l1s(doc: ProcessModelDocument) -> None:
    two = doc.model_copy(deep=True)
    counts = (1111, 2222)
    for l1, n in zip(two.l1[:2], counts):
        l1.discovery = DiscoveryStats(case_count=5, share=1.0, event_count=n, observed=True)
    blob = b"".join(_files(export_zip(two, None, META)).values()).decode()
    assert str(sum(counts)) not in blob
    assert "event_count" not in blob and "eventCount" not in blob


def test_manifest_discovery_is_independent_of_key_order(doc: ProcessModelDocument) -> None:
    disc = META["discovery"]
    reordered: ExportMeta = {**META, "discovery": {"edge_threshold": disc["edge_threshold"],
                                                    "window": {"to": "2025-12-31", "from": "2025-01-01"},
                                                    "run_id": disc["run_id"]}}
    assert export_zip(doc, None, reordered) == export_zip(doc, None, META)

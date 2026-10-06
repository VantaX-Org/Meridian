"""Structural validation of the exported BPMN 2.0 files (no dependency beyond the stdlib).

Checks well-formedness and the BPMN-2.0-shaped rules Signavio's importer relies on. The full XSD
check lives in the tests (lxml + vendored OMG schemas).
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from collections import Counter

BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
BPMNDI = "http://www.omg.org/spec/BPMN/20100524/DI"
DC = "http://www.omg.org/spec/DD/20100524/DC"
DI = "http://www.omg.org/spec/DD/20100524/DI"

NODE_TAGS = ("startEvent", "endEvent", "task", "callActivity", "exclusiveGateway", "parallelGateway")
_NCNAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_.\-]*$")


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def validate_package(files: dict[str, bytes], manifest: dict) -> list[str]:
    """``files`` maps file name to bytes. Returns a list of error strings (empty = valid)."""
    errors: list[str] = []
    process_ids = {f"L{lv['level']}_{lv['id']}" for lv in manifest.get("levels", [])}
    for lv in manifest.get("levels", []):
        if lv["file"] not in files:
            errors.append(f"manifest lists {lv['file']} but it is not in the package")
    for name, data in sorted(files.items()):
        if name.endswith(".bpmn"):
            errors += [f"{name}: {e}" for e in _validate_file(data, process_ids)]
    return errors


def _validate_file(data: bytes, process_ids: set[str]) -> list[str]:
    errors: list[str] = []
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        return [f"not well-formed XML ({e})"]
    if root.tag != _q(BPMN, "definitions"):
        return [f"root is {root.tag}, expected bpmn:definitions"]

    # only BPMN/BPMNDI elements carry xsd:ID ids; extension elements (meridian:rule id=...) may repeat them
    ids = [e.get("id") for e in root.iter()
           if e.get("id") is not None and e.tag.startswith(("{" + BPMN, "{" + BPMNDI))]
    for i, c in Counter(ids).items():
        if c > 1:
            errors.append(f"id {i} is used {c} times")
    for i in ids:
        if not _NCNAME.match(i):
            errors.append(f"id {i!r} is not a valid xsd:ID")
    idset = set(ids)

    processes = root.findall(_q(BPMN, "process"))
    if not processes:
        errors.append("no bpmn:process")
    nodes: dict[str, ET.Element] = {}
    flows: dict[str, ET.Element] = {}
    for p in processes:
        tags = Counter(c.tag for c in p)
        for ev in ("startEvent", "endEvent"):
            if not tags[_q(BPMN, ev)]:
                errors.append(f"process {p.get('id')} has no {ev}")
        for c in p:
            if c.tag == _q(BPMN, "sequenceFlow"):
                flows[c.get("id")] = c
            elif c.tag in {_q(BPMN, t) for t in NODE_TAGS}:
                nodes[c.get("id")] = c

    for fid, f in flows.items():
        for ref in ("sourceRef", "targetRef"):
            if f.get(ref) not in nodes:
                errors.append(f"flow {fid} {ref} {f.get(ref)} is not a flow node of the process")
    for nid, n in nodes.items():
        called = n.get("calledElement")
        if n.tag == _q(BPMN, "callActivity") and called not in process_ids:
            errors.append(f"callActivity {nid} calls {called}, which is not in the manifest")
        for kind, end in (("incoming", "targetRef"), ("outgoing", "sourceRef")):
            listed = [e.text for e in n.findall(_q(BPMN, kind))]
            for ref in listed:
                if ref not in flows or flows[ref].get(end) != nid:
                    errors.append(f"{nid} lists {kind} {ref}, which does not match a flow")
            expected = {fid for fid, f in flows.items() if f.get(end) == nid}
            if set(listed) != expected or len(listed) != len(set(listed)):
                errors.append(f"{nid} {kind} does not match its sequenceFlows")

    planes = list(root.iter(_q(BPMNDI, "BPMNPlane")))
    if not planes:
        errors.append("no BPMNDI plane")
    for pl in planes:
        if pl.get("bpmnElement") not in {p.get("id") for p in processes}:
            errors.append(f"plane references {pl.get('bpmnElement')}, which is not a process")
    shapes = Counter(s.get("bpmnElement") for s in root.iter(_q(BPMNDI, "BPMNShape")))
    for ref in shapes:
        if ref not in nodes:
            errors.append(f"BPMNShape references {ref}, which is not a flow node")
    for nid in nodes:
        if shapes[nid] != 1:
            errors.append(f"flow node {nid} has {shapes[nid]} BPMNShape, expected 1")
    edges = Counter()
    for e in root.iter(_q(BPMNDI, "BPMNEdge")):
        edges[e.get("bpmnElement")] += 1
        if e.get("bpmnElement") not in flows:
            errors.append(f"BPMNEdge references {e.get('bpmnElement')}, which is not a sequenceFlow")
        if len(e.findall(_q(DI, "waypoint"))) < 2:
            errors.append(f"BPMNEdge {e.get('id')} has fewer than 2 waypoints")
    for fid in flows:
        if edges[fid] != 1:
            errors.append(f"sequenceFlow {fid} has {edges[fid]} BPMNEdge, expected 1")
    if not idset:
        errors.append("file has no ids")
    return errors

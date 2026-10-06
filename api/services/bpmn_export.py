"""BPMN 2.0 export of the L1-L5 process model as a Signavio-importable zip, plus the importer used for the round trip.

One .bpmn per L1..L4 (L1-L3 are call-activity landscapes, L4 is the real diagram), a manifest and a README.
Pure: no database, no network. Overlay numbers are aggregates only (counts, pass rates).
"""

from __future__ import annotations

import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Optional

from api.models.process_model import (L1, L2, L3, L4, L5, Diagram, FieldRef, Flow, Node, ProcessModelDocument,
                                      VariantRef)
from api.services.bpmn_layout import Layout, layout_diagram
from api.services.bpmn_validate import BPMN, BPMNDI, DC, DI, validate_package

MER = "urn:meridian:bpmn:1"
SIG = "http://www.signavio.com"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
for _p, _u in (("bpmn", BPMN), ("bpmndi", BPMNDI), ("dc", DC), ("di", DI), ("meridian", MER), ("signavio", SIG),
               ("xsi", XSI)):
    ET.register_namespace(_p, _u)

_STATUS_WORD = {"red": "blocked", "amber": "at risk", "green": "ready"}
_ZIP_TIME = (2020, 1, 1, 0, 0, 0)  # fixed, so two exports differ only in manifest exported_at
_NODE_TAG = {"startEvent": "startEvent", "endEvent": "endEvent", "task": "task",
             "exclusiveGateway": "exclusiveGateway", "parallelGateway": "parallelGateway"}
_PREFIX = {"startEvent": "E_", "endEvent": "E_", "exclusiveGateway": "G_", "parallelGateway": "G_"}
_KIND = {"task": "task", "callActivity": "task", "exclusiveGateway": "gateway", "parallelGateway": "gateway",
         "startEvent": "event", "endEvent": "event"}


class BpmnExportError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors[:5]))
        self.errors = errors


def _q(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "model"


def _sub(parent: ET.Element, ns: str, tag: str, attrs: Optional[dict[str, Any]] = None, text: Optional[str] = None):
    el = ET.SubElement(parent, _q(ns, tag), {k: str(v) for k, v in (attrs or {}).items() if v is not None})
    if text is not None:
        el.text = text
    return el


def _extras(obj: Any, prefix: str = "") -> dict[str, str]:
    """Optional ``source`` / ``evidence`` fields (added by the config-derived flows batch), exported when present."""
    out: dict[str, str] = {}
    for f in ("source", "evidence"):
        v = getattr(obj, f, None)
        if v is None or v == "":
            continue
        key = prefix + (f if not prefix else f.capitalize())
        if isinstance(v, str):
            out[key] = v
        else:
            out[key] = json.dumps(v.model_dump(mode="json") if hasattr(v, "model_dump") else v, sort_keys=True)
            out[key + "Json"] = "true"
    return out


def _read_extras(cls: Any, attrs: dict[str, str], prefix: str = "") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in ("source", "evidence"):
        key = prefix + (f if not prefix else f.capitalize())
        if f in cls.model_fields and key in attrs:
            out[f] = json.loads(attrs[key]) if attrs.get(key + "Json") == "true" else attrs[key]
    return out


# ----------------------------------------------------------------------------- building


def _definitions(meta: dict[str, Any]) -> ET.Element:
    return ET.Element(_q(BPMN, "definitions"), {
        "id": "D_MERIDIAN", "targetNamespace": MER, "exporter": "Meridian",
        "exporterVersion": str(meta.get("app_version", "")),
    })


def _doc(parent: ET.Element, lines: list[str]) -> None:
    text = "\n".join(l for l in lines if l)
    if text:
        _sub(parent, BPMN, "documentation", text=text)


def _diagram(defs: ET.Element, pid: str, elems: list[tuple[str, str, ET.Element]], lay: Layout,
             flow_ids: list[str], flow_el: dict[str, str], labelled: set[str], gateways: dict[str, str]) -> None:
    """``elems`` = [(node key, element id, element)]; shape/edge ids derive from the element ids."""
    d = _sub(defs, BPMNDI, "BPMNDiagram", {"id": f"DIAG_{pid}"})
    plane = _sub(d, BPMNDI, "BPMNPlane", {"id": f"P_{pid}", "bpmnElement": pid})
    for key, eid, _ in elems:
        b = lay.shapes[key]
        attrs: dict[str, Any] = {"id": f"S_{eid}", "bpmnElement": eid}
        if gateways.get(key) == "exclusiveGateway":
            attrs["isMarkerVisible"] = "true"
        shape = _sub(plane, BPMNDI, "BPMNShape", attrs)
        _sub(shape, DC, "Bounds", {"x": b.x, "y": b.y, "width": b.w, "height": b.h})
        lb = lay.node_labels.get(key)
        if lb and key in labelled:
            _sub(_sub(shape, BPMNDI, "BPMNLabel"), DC, "Bounds", {"x": lb.x, "y": lb.y, "width": lb.w, "height": lb.h})
    for fid in flow_ids:
        edge = _sub(plane, BPMNDI, "BPMNEdge", {"id": f"D_{flow_el[fid]}", "bpmnElement": flow_el[fid]})
        for x, y in lay.edges[fid]:
            _sub(edge, DI, "waypoint", {"x": x, "y": y})
        lb = lay.edge_labels.get(fid)
        if lb:
            _sub(_sub(edge, BPMNDI, "BPMNLabel"), DC, "Bounds", {"x": lb.x, "y": lb.y, "width": lb.w, "height": lb.h})


def _wire(process: ET.Element, flows: list[tuple[str, str, str]], eid_of: dict[str, str]) -> None:
    """Add incoming/outgoing children (after documentation/extensionElements) to every flow node."""
    incoming: dict[str, list[str]] = {}
    outgoing: dict[str, list[str]] = {}
    for fid, s, t in flows:
        outgoing.setdefault(s, []).append(fid)
        incoming.setdefault(t, []).append(fid)
    for el in process:
        for key, eid in eid_of.items():
            if el.get("id") == eid:
                for fid in incoming.get(key, []):
                    _sub(el, BPMN, "incoming", text=f"F_{fid}")
                for fid in outgoing.get(key, []):
                    _sub(el, BPMN, "outgoing", text=f"F_{fid}")


def _landscape(level: int, node: Any, children: list[Any], meta: dict[str, Any]) -> bytes:
    pid = f"L{level}_{node.id}"
    defs = _definitions(meta)
    proc = _sub(defs, BPMN, "process", {"id": pid, "name": node.name, "isExecutable": "false"})
    _doc(proc, [node.description])
    ext = _sub(proc, BPMN, "extensionElements")
    lv = _sub(ext, MER, "level", {"id": node.id, "level": level, "order": node.order, "pos": meta["_pos"],
                                  "description": node.description or None, **_extras(node)})
    for m in getattr(node, "modules", []):
        _sub(lv, MER, "module", {"name": m})
    kids = sorted(enumerate(children), key=lambda p: (p[1].order, p[0]))
    keys = ["START", *[c.id for _, c in kids], "END"]
    elems: list[tuple[str, str, ET.Element]] = []
    eid_of: dict[str, str] = {}
    start = _sub(proc, BPMN, "startEvent", {"id": "E_START", "name": "Start"})
    elems.append(("START", "E_START", start))
    for pos, c in kids:
        el = _sub(proc, BPMN, "callActivity", {"id": f"CA_{c.id}", "name": c.name,
                                               "calledElement": f"L{level + 1}_{c.id}"})
        elems.append((c.id, f"CA_{c.id}", el))
    end = _sub(proc, BPMN, "endEvent", {"id": "E_END", "name": "End"})
    elems.append(("END", "E_END", end))
    flows = [(str(i + 1), keys[i], keys[i + 1]) for i in range(len(keys) - 1)]
    flow_el = {}
    for fid, s, t in flows:
        flow_el[fid] = f"F_{fid}"
        _sub(proc, BPMN, "sequenceFlow", {"id": f"F_{fid}", "sourceRef": dict((k, e) for k, e, _ in elems)[s],
                                          "targetRef": dict((k, e) for k, e, _ in elems)[t]})
    eid_of = {k: e for k, e, _ in elems}
    _wire(proc, flows, eid_of)
    lay = layout_diagram([(k, _KIND["startEvent"] if k in ("START", "END") else "task") for k in keys], flows,
                         starts=["START"])
    _diagram(defs, pid, elems, lay, [f for f, _, _ in flows], flow_el, {"START", "END"}, {})
    return _xml(defs)


def _field_line(f: FieldRef) -> str:
    notes = [n for n in (f.check_id, "mandatory" if f.mandatory else None,
                         f"config {f.config_source}" if f.config_source and not f.config_source.startswith("N/A")
                         else None) if n]
    return f"{f.field} ({', '.join(notes)})" if notes else f.field


def _dq_line(dq: dict[str, Any]) -> str:
    word = _STATUS_WORD.get(dq["dq_status"], dq["dq_status"])
    n = int(dq.get("affected_count") or 0)
    checks = ", ".join(dq.get("check_ids") or [])
    detail = ", ".join(x for x in (checks, f"{n:,} records" if n else "") if x)
    return f"Data quality: {word} ({detail})" if detail else f"Data quality: {word}"


def _task(proc: ET.Element, node: Node, act: L5, pos: int, overlay: Optional[dict[str, Any]]) -> ET.Element:
    el = _sub(proc, BPMN, "task", {"id": f"A_{act.id}", "name": act.name})
    lines = [act.description]
    if act.tcode:
        lines.append(f"T-code: {act.tcode}")
    if act.fields:
        lines.append("SAP fields: " + ", ".join(_field_line(f) for f in act.fields))
    if act.check_ids:
        lines.append("Meridian rules: " + ", ".join(act.check_ids))
    dq = (overlay or {}).get("activities", {}).get(act.id)
    if dq and dq.get("dq_status"):
        lines.append(_dq_line(dq))
    _doc(el, lines)
    ext = _sub(el, BPMN, "extensionElements")
    ma = _sub(ext, MER, "activity", {
        "id": act.id, "nodeId": node.id, "pos": pos, "order": act.order, "tcode": act.tcode,
        "sapTables": ";".join(act.sap_tables) if act.sap_tables else None,
        "ruleModules": ";".join(act.rule_modules) if act.rule_modules else None,
        "description": act.description or None, **_extras(act), **_extras(node, "node")})
    for f in act.fields:
        _sub(ma, MER, "field", {"name": f.field, "checkId": f.check_id, "mandatory": str(f.mandatory).lower(),
                                "configSource": f.config_source, "description": f.description or None})
    for cid in act.check_ids:
        _sub(ma, MER, "rule", {"id": cid})
    if dq and dq.get("dq_status"):
        _sub(ext, MER, "dq", {"status": dq["dq_status"],
                              "passRate": f"{dq['pass_rate']:.1f}" if dq.get("pass_rate") is not None else None,
                              "affected": int(dq.get("affected_count") or 0), "versionId": overlay.get("version_id")})
    meta = [("meridian_tcode", act.tcode), ("meridian_rules", ";".join(act.check_ids) or None),
            ("meridian_dq_status", dq["dq_status"] if dq and dq.get("dq_status") else None)]
    for k, v in meta:
        if v:
            _sub(ext, SIG, "signavioMetaData", {"metaKey": k, "metaValue": v})
    return el


def _l4_file(l4: L4, meta: dict[str, Any], overlay: Optional[dict[str, Any]]) -> bytes:
    pid = f"L4_{l4.id}"
    defs = _definitions(meta)
    proc = _sub(defs, BPMN, "process", {"id": pid, "name": l4.name, "isExecutable": "false"})
    _doc(proc, [l4.description, f"T-code: {l4.tcode}" if l4.tcode else "",
                f"Config dependency: {l4.config_dependency}" if l4.config_dependency else ""])
    ext = _sub(proc, BPMN, "extensionElements")
    lv = _sub(ext, MER, "level", {"id": l4.id, "level": 4, "order": l4.order, "pos": meta["_pos"], "tcode": l4.tcode,
                                  "configDependency": l4.config_dependency, "description": l4.description or None,
                                  **_extras(l4)})
    for v in l4.variants:
        _sub(lv, MER, "variant", {"table": v.sap_table, "field": v.sap_field, "value": v.value,
                                  "classification": v.classification})
    if l4.tcode:
        _sub(ext, SIG, "signavioMetaData", {"metaKey": "meridian_tcode", "metaValue": l4.tcode})

    acts = {a.id: (i, a) for i, a in enumerate(l4.activities)}
    elems: list[tuple[str, str, ET.Element]] = []
    kinds: list[tuple[str, str]] = []
    gateways: dict[str, str] = {}
    for n in l4.diagram.nodes:
        if n.type == "task":
            pos, act = acts[n.activity_id]
            el = _task(proc, n, act, pos, overlay)
        else:
            eid = _PREFIX[n.type] + n.id
            el = _sub(proc, BPMN, _NODE_TAG[n.type], {"id": eid, "name": n.label})
            extra = _extras(n)
            if extra:
                _sub(_sub(el, BPMN, "extensionElements"), MER, "node", extra)
            if n.type.endswith("Gateway"):
                gateways[n.id] = n.type
        elems.append((n.id, el.get("id"), el))
        kinds.append((n.id, _KIND[n.type]))
    flow_el: dict[str, str] = {}
    eid_of = {k: e for k, e, _ in elems}
    for f in l4.diagram.flows:
        flow_el[f.id] = f"F_{f.id}"
        fe = _sub(proc, BPMN, "sequenceFlow", {"id": f"F_{f.id}", "sourceRef": eid_of[f.source],
                                               "targetRef": eid_of[f.target], "name": f.label})
        if f.condition:
            _sub(fe, BPMN, "conditionExpression", {_q(XSI, "type"): "bpmn:tFormalExpression"}, f.condition)
    flows = [(f.id, f.source, f.target) for f in l4.diagram.flows]
    _wire(proc, flows, eid_of)
    pos = {n.id: (n.x, n.y) for n in l4.diagram.nodes if n.x is not None and n.y is not None}
    lay = layout_diagram(kinds, flows, {f.id: f.label for f in l4.diagram.flows if f.label}, pos,
                         starts=[n.id for n in l4.diagram.nodes if n.type == "startEvent"])
    labelled = {n.id for n in l4.diagram.nodes if n.type != "task"}
    _diagram(defs, pid, elems, lay, [f for f, _, _ in flows], flow_el, labelled, gateways)
    return _xml(defs)


def _xml(defs: ET.Element) -> bytes:
    ET.indent(defs, space="  ")
    return ET.tostring(defs, encoding="utf-8", xml_declaration=True)


def export_zip(document: ProcessModelDocument, overlay: Optional[dict[str, Any]], meta: dict[str, Any]) -> bytes:
    """``overlay`` = {"version_id": str, "activities": {l5_id: {dq_status, pass_rate, affected_count, check_ids?}}} or None.

    ``meta`` = {model_id, name, version_no, exported_at, app_version}. Raises BpmnExportError when the generated
    files fail ``bpmn_validate`` (never returns a half-zip).
    """
    root = f"{slug(meta['name'])}-v{meta['version_no']}"
    files: dict[str, bytes] = {}
    levels: list[dict[str, Any]] = []
    activities: list[dict[str, Any]] = []

    def add(level: int, node: Any, parent: Optional[str], pos: int, data_fn) -> None:
        name = f"L{level}_{node.id}.bpmn"
        files[name] = data_fn({**meta, "_pos": pos})
        levels.append({"level": level, "id": node.id, "name": node.name, "file": name,
                       "parent": parent, "order": node.order})

    for i1, l1 in enumerate(document.l1):
        add(1, l1, None, i1, lambda m, n=l1: _landscape(1, n, n.l2, m))
        for i2, l2 in enumerate(l1.l2):
            add(2, l2, l1.id, i2, lambda m, n=l2: _landscape(2, n, n.l3, m))
            for i3, l3 in enumerate(l2.l3):
                add(3, l3, l2.id, i3, lambda m, n=l3: _landscape(3, n, n.l4, m))
                for i4, l4 in enumerate(l3.l4):
                    add(4, l4, l3.id, i4, lambda m, n=l4: _l4_file(n, m, overlay))
                    for a in l4.activities:
                        dq = (overlay or {}).get("activities", {}).get(a.id) or {}
                        activities.append({
                            "id": a.id, "l4_id": l4.id, "name": a.name, "tcode": a.tcode,
                            "fields": [{"field": f.field, "check_id": f.check_id, "mandatory": f.mandatory}
                                       for f in a.fields],
                            "check_ids": a.check_ids, "dq_status": dq.get("dq_status")})
    manifest = {
        "schema_version": 1,
        "model": {"id": meta.get("model_id"), "name": meta["name"], "version_no": meta["version_no"],
                  "exported_at": meta["exported_at"]},
        "overlay_version_id": (overlay or {}).get("version_id"),
        "levels": levels, "activities": activities,
    }
    errors = validate_package(files, manifest)
    if errors:
        raise BpmnExportError(errors)

    readme = (
        f"Meridian process model '{meta['name']}', version {meta['version_no']}, as BPMN 2.0.\n\n"
        "manifest.json   model, hierarchy (level, parent, file) and every activity with its SAP fields and rules\n"
        "L1_*.bpmn       one per end-to-end process: its L2 processes as call activities\n"
        "L2_*.bpmn       one per L2 process: its L3 processes as call activities\n"
        "L3_*.bpmn       one per L3 process: its L4 sub-processes as call activities\n"
        "L4_*.bpmn       one per L4 sub-process: the real diagram (events, tasks, gateways, flows)\n\n"
        "Import the .bpmn files with Signavio's BPMN 2.0 import. The hierarchy is carried by the\n"
        "calledElement links between files and by manifest.json, not by folders.\n")
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        def put(name: str, data: bytes) -> None:
            zi = zipfile.ZipInfo(f"{root}/{name}", _ZIP_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)

        put("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8"))
        put("README.txt", readme.encode("utf-8"))
        for name in sorted(files):
            put(name, files[name])
    return out.getvalue()


# ----------------------------------------------------------------------------- import (round-trip)


def _ext(proc: ET.Element, tag: str, ns: str = MER) -> Optional[ET.Element]:
    return proc.find(f"{_q(BPMN, 'extensionElements')}/{_q(ns, tag)}")


def import_zip(data: bytes) -> ProcessModelDocument:
    """Rebuild the document from a zip made by ``export_zip``. Node x,y come from the exported layout."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = {n.split("/", 1)[1]: n for n in z.namelist() if "/" in n}
        manifest = json.loads(z.read(names["manifest.json"]))
        trees = {lv["file"]: ET.fromstring(z.read(names[lv["file"]])) for lv in manifest["levels"]}
    by_key = {(lv["level"], lv["id"]): lv for lv in manifest["levels"]}

    def proc_of(level: int, id_: str) -> ET.Element:
        return trees[by_key[(level, id_)]["file"]].find(_q(BPMN, "process"))

    def ordered_children(level: int, proc: ET.Element) -> list[tuple[int, str]]:
        kids = [c.get("calledElement").split("_", 1)[1] for c in proc.findall(_q(BPMN, "callActivity"))]
        return sorted(((int(_ext(proc_of(level + 1, k), "level").get("pos")), k) for k in kids))

    def head(level: int, id_: str, cls: Any) -> dict[str, Any]:
        proc = proc_of(level, id_)
        lv = _ext(proc, "level")
        return {"proc": proc, "lv": lv, "kw": {"id": id_, "name": proc.get("name") or "",
                                               "description": lv.get("description", ""), "order": int(lv.get("order")),
                                               **_read_extras(cls, lv.attrib)}}

    def l4(id_: str) -> L4:
        h = head(4, id_, L4)
        proc, lv = h["proc"], h["lv"]
        shapes = {}
        for s in trees[by_key[(4, id_)]["file"]].iter(_q(BPMNDI, "BPMNShape")):
            b = s.find(_q(DC, "Bounds"))
            shapes[s.get("bpmnElement")] = (round(float(b.get("x"))), round(float(b.get("y"))))
        acts: list[tuple[int, L5]] = []
        nodes: list[Node] = []
        node_of: dict[str, str] = {}
        for el in proc:
            tag = el.tag.split("}")[1]
            if tag not in _NODE_TAG:
                continue
            eid = el.get("id")
            xy = dict(zip(("x", "y"), shapes[eid]))
            if tag == "task":
                ma = _ext(el, "activity")
                fields = [FieldRef(field=f.get("name"), check_id=f.get("checkId"), description=f.get("description", ""),
                                   mandatory=f.get("mandatory") == "true", config_source=f.get("configSource"))
                          for f in ma.findall(_q(MER, "field"))]
                a = L5(id=ma.get("id"), name=el.get("name") or "", description=ma.get("description", ""),
                       order=int(ma.get("order")), tcode=ma.get("tcode"), fields=fields,
                       check_ids=[r.get("id") for r in ma.findall(_q(MER, "rule"))],
                       sap_tables=[t for t in (ma.get("sapTables") or "").split(";") if t],
                       rule_modules=[m for m in (ma.get("ruleModules") or "").split(";") if m],
                       **_read_extras(L5, ma.attrib))
                acts.append((int(ma.get("pos")), a))
                nid = ma.get("nodeId")
                nodes.append(Node(id=nid, type="task", activity_id=a.id, **xy, **_read_extras(Node, ma.attrib, "node")))
            else:
                nid = eid[2:]
                node_ext = _ext(el, "node")
                nodes.append(Node(id=nid, type=tag, label=el.get("name"), **xy,
                                  **(_read_extras(Node, node_ext.attrib) if node_ext is not None else {})))
            node_of[eid] = nid
        flows = []
        for f in proc.findall(_q(BPMN, "sequenceFlow")):
            ce = f.find(_q(BPMN, "conditionExpression"))
            flows.append(Flow(id=f.get("id")[2:], source=node_of[f.get("sourceRef")], target=node_of[f.get("targetRef")],
                              label=f.get("name"), condition=ce.text if ce is not None else None))
        return L4(**h["kw"], tcode=lv.get("tcode"), config_dependency=lv.get("configDependency"),
                  activities=[a for _, a in sorted(acts, key=lambda p: p[0])],
                  diagram=Diagram(nodes=nodes, flows=flows),
                  variants=[VariantRef(sap_table=v.get("table"), sap_field=v.get("field"), value=v.get("value"),
                                       classification=v.get("classification"))
                            for v in lv.findall(_q(MER, "variant"))])

    def l3(id_: str) -> L3:
        h = head(3, id_, L3)
        return L3(**h["kw"], l4=[l4(k) for _, k in ordered_children(3, h["proc"])])

    def l2(id_: str) -> L2:
        h = head(2, id_, L2)
        return L2(**h["kw"], l3=[l3(k) for _, k in ordered_children(2, h["proc"])])

    def l1(id_: str) -> L1:
        h = head(1, id_, L1)
        return L1(**h["kw"], modules=[m.get("name") for m in h["lv"].findall(_q(MER, "module"))],
                  l2=[l2(k) for _, k in ordered_children(1, h["proc"])])

    tops = sorted((int(_ext(proc_of(1, lv["id"]), "level").get("pos")), lv["id"])
                  for lv in manifest["levels"] if lv["level"] == 1)
    return ProcessModelDocument(l1=[l1(k) for _, k in tops])

"""BPMN 2.0 / Signavio export: structure, XSD (when lxml is installed), round trip, overlay, route."""

from __future__ import annotations

import io
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from api.models.process_model import (L1, L2, L3, L4, L5, Diagram, FieldRef, Flow, Node, ProcessModelDocument,
                                      VariantRef)
from api.services import bpmn_export
from api.services.bpmn_export import BpmnExportError, export_zip, import_zip, slug
from api.services.bpmn_validate import BPMN, BPMNDI, DC, DI, validate_package
from sap.process_definitions import reference_document

XSD = Path(__file__).parent / "fixtures" / "bpmn20-xsd" / "BPMN20.xsd"
META = {"model_id": None, "name": "Reference", "version_no": 0, "exported_at": "2026-01-01T00:00:00Z",
        "app_version": "1.0.0"}


def _files(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n.split("/", 1)[1]: z.read(n) for n in z.namelist()}


def _manifest(files: dict[str, bytes]) -> dict:
    import json
    return json.loads(files["manifest.json"])


@pytest.fixture(scope="module")
def ref_zip() -> bytes:
    return export_zip(reference_document(), None, META)


def synthetic() -> ProcessModelDocument:
    """One L1 with designer positions, a parallel gateway, a loop-back, a variant and a multi-line description."""
    fields = [FieldRef(field="MARA.MATNR", check_id="MM001", description="Material", mandatory=True),
              FieldRef(field="MARA.MTART", check_id="MM002", config_source="T134")]
    acts = [L5(id="X-A-ONE", name="Create & check <material>", description="Line one\nline two", order=1,
               tcode="MM01", fields=fields).with_derived(),
            L5(id="X-A-TWO", name="Release", order=2, tcode=None).with_derived(),
            L5(id="X-A-THREE", name="Notify", order=3).with_derived()]
    nodes = [Node(id="X-S", type="startEvent", label="Start", x=400, y=200),
             Node(id="X-T1", type="task", activity_id="X-A-ONE", x=500, y=180),
             Node(id="X-P1", type="parallelGateway", label="Split", x=700, y=195),
             Node(id="X-T2", type="task", activity_id="X-A-TWO", x=800, y=100),
             Node(id="X-T3", type="task", activity_id="X-A-THREE", x=800, y=300),
             Node(id="X-P2", type="parallelGateway", label="Join", x=1000, y=195),
             Node(id="X-X1", type="exclusiveGateway", label="OK?", x=1100, y=195),
             Node(id="X-E", type="endEvent", label="Done", x=1300, y=200)]
    flows = [Flow(id="X-F1", source="X-S", target="X-T1"), Flow(id="X-F2", source="X-T1", target="X-P1"),
             Flow(id="X-F3", source="X-P1", target="X-T2"), Flow(id="X-F4", source="X-P1", target="X-T3"),
             Flow(id="X-F5", source="X-T2", target="X-P2"), Flow(id="X-F6", source="X-T3", target="X-P2"),
             Flow(id="X-F7", source="X-P2", target="X-X1"),
             Flow(id="X-F8", source="X-X1", target="X-E", label="yes", condition="ok == true"),
             Flow(id="X-F9", source="X-X1", target="X-T1", label="no", condition="ok == false")]
    l4 = L4(id="X-L4", name="Material", order=1, tcode="MM01", config_dependency="T134", activities=acts,
            diagram=Diagram(nodes=nodes, flows=flows),
            variants=[VariantRef(sap_table="MARA", sap_field="MTART", value="ROH", classification="implemented")])
    l4b = L4(id="X-L4B", name="Second", order=2, activities=[L5(id="X-B-ONE", name="Only").with_derived()],
             diagram=Diagram(nodes=[Node(id="X-BS", type="startEvent"),
                                    Node(id="X-BT", type="task", activity_id="X-B-ONE"),
                                    Node(id="X-BE", type="endEvent")],
                             flows=[Flow(id="X-BF1", source="X-BS", target="X-BT"),
                                    Flow(id="X-BF2", source="X-BT", target="X-BE")]))
    return ProcessModelDocument(l1=[L1(id="X", name="Synthetic", description="Top", order=1, modules=["MM", "FI"],
                                       l2=[L2(id="X-L2", name="Sub", order=1,
                                              l3=[L3(id="X-L3", name="Proc", order=1, l4=[l4, l4b])])])])


def _xsd_validate(files: dict[str, bytes]) -> None:
    lxml = pytest.importorskip("lxml.etree")
    schema = lxml.XMLSchema(lxml.parse(str(XSD)))
    for name, data in files.items():
        if name.endswith(".bpmn"):
            doc = lxml.fromstring(data)
            assert schema.validate(doc), f"{name}: {schema.error_log.filter_from_errors()[:3]}"


def _norm(doc: ProcessModelDocument, back: ProcessModelDocument) -> None:
    """Positions are layout output, not model data: copy the imported ones onto the original."""
    for a, b in zip(doc.all_l4(), back.all_l4()):
        for na, nb in zip(a.diagram.nodes, b.diagram.nodes):
            na.x, na.y = nb.x, nb.y


def test_reference_package_layout_and_validation(ref_zip):
    files = _files(ref_zip)
    names = sorted(files)
    assert "manifest.json" in names and "README.txt" in names
    for prefix, n in (("L1_", 13), ("L2_", 38), ("L3_", 38), ("L4_", 59)):
        assert len([f for f in names if f.startswith(prefix) and f.endswith(".bpmn")]) == n
    assert validate_package(files, _manifest(files)) == []
    with zipfile.ZipFile(io.BytesIO(ref_zip)) as z:
        assert {n.split("/")[0] for n in z.namelist()} == {"reference-v0"}


def test_reference_validates_against_omg_xsd(ref_zip):
    _xsd_validate(_files(ref_zip))


@pytest.mark.parametrize("l1_id", [l1.id for l1 in reference_document().l1])
def test_every_l1_exports_valid_and_round_trips(l1_id):
    full = reference_document()
    doc = ProcessModelDocument(l1=[l for l in full.l1 if l.id == l1_id])
    data = export_zip(doc, None, {**META, "name": l1_id})
    files = _files(data)
    assert validate_package(files, _manifest(files)) == []
    assert any(f == f"L1_{l1_id}.bpmn" for f in files)
    _xsd_validate(files)
    back = import_zip(data)
    _norm(doc, back)
    assert back == doc


def test_miro_gateway_condition_and_back_edge_waypoints(ref_zip):
    root = ET.fromstring(_files(ref_zip)["L4_PTP-IV-MIRO.bpmn"])
    proc = root.find(f"{{{BPMN}}}process")
    assert len(proc.findall(f"{{{BPMN}}}exclusiveGateway")) == 1
    ends = {e.get("id"): e.get("name") for e in proc.findall(f"{{{BPMN}}}endEvent")}
    no = [f for f in proc.findall(f"{{{BPMN}}}sequenceFlow") if ends.get(f.get("targetRef")) == "Parked"]
    assert len(no) == 1 and no[0].find(f"{{{BPMN}}}conditionExpression").text == "no"
    edge = next(e for e in root.iter(f"{{{BPMNDI}}}BPMNEdge") if e.get("bpmnElement") == no[0].get("id"))
    assert len(edge.findall(f"{{{DI}}}waypoint")) == 4


def test_synthetic_model_with_variants_round_trips_and_has_back_edge():
    doc = synthetic()
    data = export_zip(doc, None, {**META, "name": "Synth"})
    files = _files(data)
    assert validate_package(files, _manifest(files)) == []
    _xsd_validate(files)
    root = ET.fromstring(files["L4_X-L4.bpmn"])
    edge = next(e for e in root.iter(f"{{{BPMNDI}}}BPMNEdge") if e.get("bpmnElement") == "F_X-F9")
    assert len(edge.findall(f"{{{DI}}}waypoint")) == 4  # the "no" loop back to the first task
    back = import_zip(data)
    # designer positions: exported 1:1, shifted so the minimum is the grid origin
    xs = [n.x for n in back.all_l4()[0].diagram.nodes]
    assert min(xs) == 60 and back.all_l4()[0].diagram.nodes[1].x - back.all_l4()[0].diagram.nodes[0].x == 100
    assert [n.type for n in back.all_l4()[0].diagram.nodes].count("parallelGateway") == 2
    _norm(doc, back)
    assert back == doc
    assert back.all_l4()[0].variants[0].value == "ROH"
    assert back.all_l4()[0].activities[0].description == "Line one\nline two"


def test_overlay_adds_dq_documentation_and_no_long_numbers():
    doc = reference_document()
    act = doc.all_l4()[0].activities[0]
    overlay = {"version_id": "11111111-2222-3333-4444-555555555555", "activities": {
        a.id: {"dq_status": "green", "pass_rate": 99.0, "affected_count": 0, "check_ids": []}
        for l4 in doc.all_l4() for a in l4.activities}}
    overlay["activities"][act.id] = {"dq_status": "red", "pass_rate": 71.25, "affected_count": 1204,
                                     "check_ids": [act.check_ids[0]]}
    data = export_zip(doc, overlay, META)
    files = _files(data)
    text = files[f"L4_{doc.all_l4()[0].id}.bpmn"].decode()
    assert f"Data quality: blocked ({act.check_ids[0]}, 1,204 records)" in text
    assert text.count("<meridian:dq ") == len(doc.all_l4()[0].activities)
    assert 'status="red"' in text and 'affected="1204"' in text and 'metaKey="meridian_dq_status"' in text
    assert _manifest(files)["overlay_version_id"] == overlay["version_id"]
    for name, blob in files.items():
        assert not re.search(r"\b\d{13,}\b", blob.decode()), name
    assert import_zip(data).all_l4()[0].activities[0].name == act.name


def test_no_overlay_means_no_dq_markup(ref_zip):
    for name, blob in _files(ref_zip).items():
        s = blob.decode()
        assert "meridian:dq" not in s and "meridian_dq_status" not in s and "Data quality" not in s, name
    assert all(a["dq_status"] is None for a in _manifest(_files(ref_zip))["activities"])


def test_deterministic_except_exported_at():
    doc = reference_document()
    a = _files(export_zip(doc, None, META))
    b = _files(export_zip(doc, None, {**META, "exported_at": "2027-02-02T00:00:00Z"}))
    assert {k for k in a if a[k] != b[k]} == {"manifest.json"}
    assert export_zip(doc, None, META) == export_zip(doc, None, META)


def test_manifest_carries_hierarchy_and_activities(ref_zip):
    m = _manifest(_files(ref_zip))
    assert [lv["level"] for lv in m["levels"]].count(4) == 59
    miro = next(a for a in m["activities"] if a["id"] == "PTP-IV-MIRO-01")
    assert miro["l4_id"] == "PTP-IV-MIRO" and miro["tcode"] == "MIRO" and miro["fields"][0]["field"] == "RBKP.LIFNR"


def test_slug():
    assert slug("My Model: v2!") == "my-model-v2" and slug("***") == "model"


def test_extras_exported_when_present_and_read_back():
    node = SimpleNamespace(source="config", evidence={"table": "T161", "n": 3})
    attrs = bpmn_export._extras(node, "node")
    assert attrs["nodeSource"] == "config" and attrs["nodeEvidenceJson"] == "true"
    assert bpmn_export._extras(SimpleNamespace()) == {}

    class WithExtras(Node):
        source: str | None = None
        evidence: dict | None = None

    read = bpmn_export._read_extras(WithExtras, attrs, "node")
    assert read == {"source": "config", "evidence": {"table": "T161", "n": 3}}
    assert bpmn_export._read_extras(Node, attrs, "node") == {}  # model without the fields: skipped


def test_broken_package_fails_validation_never_half_zip():
    doc = synthetic()
    d = doc.all_l4()[0].diagram
    d.nodes.pop(0)  # no start event
    d.flows.pop(0)
    with pytest.raises(BpmnExportError) as e:
        export_zip(doc, None, META)
    assert any("startEvent" in x for x in e.value.errors)


def test_validator_catches_structural_errors():
    good = _files(export_zip(synthetic(), None, META))
    m = _manifest(good)
    bad = dict(good)
    bad["L4_X-L4B.bpmn"] = good["L4_X-L4B.bpmn"].replace(b'targetRef="A_X-B-ONE"', b'targetRef="NOPE"')
    assert any("NOPE" in e for e in validate_package(bad, m))
    bad["L4_X-L4B.bpmn"] = b"<not-xml"
    assert any("not well-formed" in e for e in validate_package(bad, m))
    bad["L3_X-L3.bpmn"] = good["L3_X-L3.bpmn"].replace(b'calledElement="L4_X-L4B"', b'calledElement="L4_GONE"')
    assert any("L4_GONE" in e for e in validate_package(bad, m))
    dup = good["L4_X-L4B.bpmn"].replace(b'id="F_X-BF2"', b'id="F_X-BF1"', 1)
    assert any("used" in e for e in validate_package({**good, "L4_X-L4B.bpmn": dup}, m))


# ------------------------------------------------------------------ route (no database: model lookups are faked)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import process_export as pe

    mine, other = uuid.uuid4(), uuid.uuid4()
    docs = {1: synthetic(), 2: synthetic()}
    audits: list[dict] = []
    owner = uuid.uuid4()
    state = {"tenant": owner}

    async def _model(db, tenant, model_id, lock=False):
        if model_id != mine or tenant.id != owner:
            raise HTTPException(status_code=404, detail="Model not found")
        return {"id": str(mine), "name": "My Model", "current_version": 2}

    async def _document(db, tenant, model_id, vno):
        if vno not in docs:
            raise HTTPException(status_code=404, detail="Version not found")
        return docs[vno]

    async def _rls(db, tenant):
        return None

    monkeypatch.setattr(pe, "_model", _model)
    monkeypatch.setattr(pe, "_document", _document)
    monkeypatch.setattr(pe, "_rls", _rls)
    monkeypatch.setattr(pe, "_insert_audit_row", audits.append)
    app = FastAPI()
    app.include_router(pe.router)

    async def _db():
        yield None

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(state["tenant"], "T", [])
    c = TestClient(app, headers={"X-User-Role": "analyst"})
    return SimpleNamespace(c=c, mine=mine, other=other, docs=docs, audits=audits, state=state)


def test_route_reference_download(client):
    r = client.c.get("/api/v1/process-designer/reference/export/signavio")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"] == 'attachment; filename="reference-v0-bpmn.zip"'
    files = _files(r.content)
    assert len([f for f in files if f.endswith(".bpmn")]) == 148
    assert client.audits[-1]["action"] == "export" and client.audits[-1]["entity_id"] is None


def test_route_model_version_and_audit(client):
    base = f"/api/v1/process-designer/models/{client.mine}/export/signavio"
    r = client.c.get(base)
    assert r.status_code == 200
    assert r.headers["content-disposition"] == 'attachment; filename="my-model-v2-bpmn.zip"'
    assert client.audits[-1]["entity_id"] == str(client.mine) and client.audits[-1]["tenant_id"] == client.state["tenant"]
    r = client.c.get(base, params={"version": 1})
    assert 'my-model-v1-bpmn.zip' in r.headers["content-disposition"]
    assert len(client.audits) == 2


def test_route_404s_and_tenant_isolation(client):
    base = "/api/v1/process-designer/models/{}/export/signavio"
    assert client.c.get(base.format(uuid.uuid4())).status_code == 404
    assert client.c.get(base.format(client.mine), params={"version": 9}).status_code == 404
    client.state["tenant"] = uuid.uuid4()  # a different tenant asks for my model
    assert client.c.get(base.format(client.mine)).status_code == 404
    assert client.audits == []


def test_route_422_when_stored_document_is_invalid(client):
    client.docs[2].all_l4()[0].activities[0].fields[0].field = "MARA.NOPE"
    r = client.c.get(f"/api/v1/process-designer/models/{client.mine}/export/signavio")
    assert r.status_code == 422 and r.json()["errors"][0]["path"].endswith("fields[0].field")
    assert client.audits == []

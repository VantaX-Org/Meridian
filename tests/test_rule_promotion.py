"""Aletheia rule promotion: buckets, Z-code tolerance, drift, apply/revert, override precedence."""

import asyncio
import json

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api.services import rule_promotion as rp
from checks import overrides
from checks.frames import TableFrames
from checks.runner import generated_rule_ids
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
TH = dict(rp.DEFAULTS)


def rule(rid, field, cls="referential_check"):
    return {"id": rid, "field": field, "check_class": cls, "severity": "high", "dimension": "consistency",
            "message": f"{field} must exist", "enabled": False}


def frames(**cols):
    n = 200
    df = pd.DataFrame({"MARA.MATNR": [str(i) for i in range(n)], **{k.replace("_", ".", 1): v for k, v in cols.items()}})
    return TableFrames({"MARA": df}, D)


def by_id(rows):
    return {r["id"]: r for r in rows}


def test_each_bucket():
    f = frames(MARA_MTART=["FERT"] * 190 + ["BAD"] * 10,    # review: 5% fail
               MARA_MATKL=["A"] * 200,                       # promote
               MARA_MEINS=[""] * 200,                        # skip: empty
               MARA_SPART=["01"] * 200)                      # needs value set (no TSPA.SPART)
    refs = {"T134.MTART": {"FERT"}, "T023.MATKL": {"A"}, "T006.MSEHI": {"ST"}}
    rows = by_id(rp.classify([rule("R1", "MARA.MTART"), rule("R2", "MARA.MATKL"), rule("R3", "MARA.MEINS"),
                              rule("R4", "MARA.SPART"), rule("R5", "MARA.NOPE9", "null_check")], f, D, refs, TH))
    assert rows["R1"]["bucket"] == "review" and rows["R1"]["failing"] == 10 and rows["R1"]["total"] == 200
    assert len(rows["R1"]["sample_keys"]) == 5 and rows["R1"]["rate"] == 0.05
    assert rows["R2"]["bucket"] == "promote" and rows["R2"]["populated_pct"] == 100.0
    assert (rows["R3"]["bucket"], rows["R3"]["reason"]) == ("skip_unused", "empty")
    assert rows["R4"]["bucket"] == "needs_value_set"
    assert (rows["R5"]["bucket"], rows["R5"]["reason"]) == ("skip_unused", "not_extracted")
    assert rp.counts(list(rows.values()))["promote"] == 1


def test_z_code_tolerated_only_through_tenant_value_set():
    f = frames(MARA_MTART=["FERT"] * 100 + ["ZABC"] * 100)
    r = rule("R1", "MARA.MTART")
    assert rp.classify([r], f, D, {"T134.MTART": {"FERT", "ZABC"}}, TH)[0]["bucket"] == "promote"
    assert rp.classify([r], f, D, {"T134.MTART": {"FERT"}}, TH)[0]["bucket"] == "review"
    assert rp.classify([r], f, D, {}, TH)[0]["bucket"] == "needs_value_set"  # never judged against SAP standard


def test_few_records_and_no_extraction():
    f = frames(MARA_MTART=["FERT"] * 200)
    low = {**TH, "min_records": 1000}
    assert rp.classify([rule("R1", "MARA.MTART")], f, D, {"T134.MTART": {"FERT"}}, low)[0]["reason"] == "few_records"
    assert rp.classify([rule("R1", "MARA.MTART")], None, D, {"T134.MTART": {"FERT"}}, TH)[0]["reason"] == "not_extracted"


def test_drift_flag():
    promoted = {"R1": {"rate": 0.01, "version_id": "v1"}, "R2": {"rate": 0.01, "version_id": "v1"}}
    now = [{"id": "R1", "rate": 0.20, "failing": 40, "total": 200, "sample_keys": ["k"]},
           {"id": "R2", "rate": 0.02, "failing": 4, "total": 200, "sample_keys": []}]
    flags = rp.drift(promoted, now, TH, "v2")
    assert [x["id"] for x in flags] == ["R1"] and flags[0]["delta"] == 0.19
    assert rp.drift(promoted, now, TH, "v1") == []  # same run that promoted it


# ---- override precedence (sqlite stands in for the tenant database)

GEN = sorted(generated_rule_ids())[0]


@pytest.fixture
def session():
    eng = create_engine("sqlite://")
    with Session(eng) as s:
        s.execute(text("CREATE TABLE rules_hq_cache (id TEXT, enabled BOOLEAN, severity TEXT)"))
        s.execute(text("CREATE TABLE rules (name TEXT, enabled BOOLEAN, source TEXT)"))
        yield s


def add(s, rid, enabled=True, source="promotion"):
    s.execute(text("INSERT INTO rules VALUES (:n, :e, :s)"), {"n": f"{rid}: msg", "e": enabled, "s": source})


def kept(rules, ov):
    return [r["id"] for r in overrides.apply(rules, ov)]


def test_promotion_enables_generated_rule_and_revert_restores_default(session):
    rules = [{"id": GEN, "enabled": False}]
    add(session, GEN)
    assert kept(rules, overrides.load_overrides(session)) == [GEN]
    session.execute(text("DELETE FROM rules"))  # revert
    assert kept(rules, overrides.load_overrides(session)) == []


def test_promotion_ignored_for_non_generated_id(session):
    add(session, "BP999")
    assert "BP999" not in overrides.load_overrides(session)
    assert kept([{"id": "BP999", "enabled": False}], overrides.load_overrides(session)) == []


def test_hq_disable_beats_promotion(session):
    session.execute(text("INSERT INTO rules_hq_cache VALUES (:i, 0, NULL)"), {"i": GEN})
    add(session, GEN)
    assert kept([{"id": GEN, "enabled": False}], overrides.load_overrides(session)) == []


def test_tenant_disable_and_non_promotion_source_still_work(session):
    add(session, GEN, enabled=False)
    assert overrides.load_overrides(session)[GEN]["enabled"] is False
    session.execute(text("DELETE FROM rules"))
    add(session, GEN, enabled=True, source="yaml")
    assert GEN not in overrides.load_overrides(session)


# ---- apply + revert + audit (fake async db)

class FakeResult:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class FakeDB:
    def __init__(self, existing):
        self.sql, self.audit, self.existing = [], [], existing

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q.split()[0], params))
        return FakeResult((1,) if q.startswith("UPDATE rules SET enabled = true") and self.existing else None)


def test_apply_and_revert_audit(monkeypatch):
    audits = []

    async def fake_audit(db, tid, request, action, et, eid, before, after):
        audits.append((action, eid, before, after))

    monkeypatch.setattr("api.services.rbac.write_audit", fake_audit)
    row = {"rate": 0.01, "populated_pct": 90.0, "failing": 2, "total": 200, "sample_keys": ["MATNR=1"], "bucket": "promote"}
    ev = rp.evidence_of(row, TH, "v1", "auto", None)
    st: dict = {}
    db = FakeDB(existing=True)
    asyncio.run(rp.enable(db, "t", None, "material_master", {"id": GEN, "message": "m"}, ev, st))
    assert st["promoted"][GEN]["created"] is False and audits[0][0] == "rule_promotion.enable"
    assert audits[0][3]["evidence"]["sample_keys"] == ["MATNR=1"]
    assert asyncio.run(rp.revert(db, "t", None, "material_master", [GEN, "nope"], st)) == [GEN]
    assert st["promoted"] == {} and audits[1][0] == "rule_promotion.revert"
    # a row this promotion created is deleted on revert
    st2: dict = {}
    db2 = FakeDB(existing=False)
    asyncio.run(rp.enable(db2, "t", None, "m", {"id": GEN}, ev, st2))
    assert st2["promoted"][GEN]["created"] is True
    asyncio.run(rp.revert(db2, "t", None, "m", [GEN], st2))
    assert db2.sql[-1][0] == "DELETE"
    json.dumps(st2)

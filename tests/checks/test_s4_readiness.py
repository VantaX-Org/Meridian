"""S/4HANA readiness pack: overlay module, target tagging and the readiness roll-up."""
import glob

import pandas as pd
import yaml

from api.services.s4_readiness import membership, rollup
from checks.frames import TableFrames
from checks.runner import is_overlay, run_checks
from sap.ddic import get_dictionary


def _by_id(results):
    return {r.check_id: r for r in results}


def test_overlay_flag():
    assert is_overlay("s4_readiness")
    assert not is_overlay("accounts_payable")
    assert not is_overlay("no_such_module")


def test_contact_without_last_name_is_tagged_for_s4():
    df = pd.DataFrame({"KNVK.PARNR": ["1", "2", "3"], "KNVK.NAME1": ["Smith", None, None],
                       "KNVK.LOEVM": ["", "", "X"]})  # the flagged contact is out of scope
    r = _by_id(run_checks("s4_readiness", df, "t"))["S4R-BP-KNVK-NAME"]
    assert (r.affected_count, r.total_count) == (1, 2)
    assert r.details["baseline"] == "s4_target" and r.details["target"] == "s4hana"
    assert r.details["s4_area"] == "business_partner" and r.details["s4_impact"] == "blocking"
    assert r.rule_context["target"] == "s4hana" and r.rule_context["s4_impact"] == "blocking"


def test_vendor_number_overlap_and_shared_tax_number():
    d = get_dictionary("s4hana")
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["100", "200", "300"], "LFA1.KUNNR": ["", "", "300"],
                         "LFA1.LAND1": ["ZA", "ZA", "ZA"], "LFA1.STCD1": ["T1", "T9", "T3"]})
    kna1 = pd.DataFrame({"KNA1.KUNNR": ["100", "300", "400"], "KNA1.LIFNR": ["", "300", "999"],
                         "KNA1.LAND1": ["ZA", "ZA", "ZA"], "KNA1.STCD1": ["T0", "T3", "T9"]})
    r = _by_id(run_checks("s4_readiness", TableFrames({"LFA1": lfa1, "KNA1": kna1}, d), "t"))
    # 100 clashes with unlinked customer 100; 300 is linked, so one Business Partner
    assert r["S4R-BP-NUM-OVERLAP"].affected_count == 1
    # vendor 200 shares ZA/T9 with customer 400, but 400 is linked to a vendor already
    assert r["S4R-BP-DUP-TAX"].affected_count == 0
    # customer 400 points at vendor 999, which does not exist
    assert r["S4R-BP-KNA1-LIFNR"].affected_count == 1
    assert r["S4R-BP-KNA1-LIFNR"].details["target"] == "s4hana"


def test_every_counted_rule_exists():
    ids = {r["id"] for p in glob.glob("checks/rules/*/*.yaml") for r in (yaml.safe_load(open(p)) or {}).get("rules") or []}
    generated = ("CF-", "CR-")  # country format / postal-code rules generated per extract
    assert [c for c in membership() if c not in ids and not c.startswith(generated)] == []


def _f(check_id, affected, pass_rate, severity="medium", **details):
    return {"check_id": check_id, "module": "m", "severity": severity, "affected_count": affected,
            "pass_rate": pass_rate, "details": details}


def test_rollup_statuses_and_counts():
    out = rollup([
        _f("S4R-BP-KNVK-NAME", 5, 99.0, "high"),     # blocking failure: red
        _f("S4R-BP-KNA1-ADRNR", 0, 100.0),            # passing: green
        _f("S4R-FI-CSKS-PRCTR", 10, 90.0, "low"),     # warning at 90%: amber
        _f("AR058", 0, 100.0, "high"),                # related rule passing: green
        _f("S4R-AA-KTOGR", 3, 0.0, "high", error="not evaluated: T095 was not read in full"),
        _f("UNRELATED", 99, 1.0, "critical"),
    ])
    areas = {a["area"]: a for a in out["areas"]}
    bp, fi, aa = areas["business_partner"], areas["finance"], areas["asset_accounting"]
    assert (bp["status"], bp["evaluated"], bp["failing"], bp["failing_records"], bp["blocking_failing"]) == \
        ("red", 2, 1, 5, 1)
    assert (fi["status"], fi["warning_failing"], fi["failing_records"]) == ("amber", 1, 10)
    assert aa["status"] == "not_evaluated" and aa["evaluated"] == 0
    assert out["status"] == "red" and out["ready"] is False
    assert out["failing_records"] == 15 and out["blocking_failing"] == 1


def test_rollup_ready_when_no_blocking_failure():
    out = rollup([_f("S4R-FI-CSKS-PRCTR", 1, 99.0, "low"), _f("S4-CVI-LFA1", 0, 100.0, "high")])
    assert out["ready"] is True and out["status"] == "green"


def test_readiness_route_scopes_to_tenant_and_version():
    import uuid

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.findings import router

    tid, vid = uuid.uuid4(), uuid.uuid4()
    seen: list[str] = []

    class _Res:
        def scalar(self):
            return vid

        def mappings(self):
            return self

        def all(self):
            return [_f("S4R-BP-KNVK-NAME", 2, 50.0, "high")]

    class _DB:
        async def execute(self, stmt, params=None):
            seen.append(str(stmt.compile(compile_kwargs={"literal_binds": True})) if hasattr(stmt, "whereclause")
                        else str(stmt))
            return _Res()

    async def _db():
        yield _DB()

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(id=tid, name="t", licensed_modules=[])
    body = TestClient(app).get("/api/v1/findings/s4-readiness").json()
    assert body["version_id"] == str(vid) and body["status"] == "red" and body["blocking_failing"] == 1
    assert str(tid) in seen[0] and str(tid).replace("-", "") in seen[-1].replace("-", "")
    assert TestClient(app).get("/api/v1/findings/s4-readiness?version_id=bad").status_code == 422

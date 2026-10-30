"""extraction_path and read_function (migration 118): stored per system, returned by the systems API, validated,
and handed to the extraction as connection parameters. Against a real Postgres as a non-superuser (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
import uuid

import pytest
from fastapi import HTTPException

from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    import api.services.credential_store as store
    from api.routes import systems

    monkeypatch.setattr(store, "encrypt_password", lambda tid, value: f"enc:{value}")
    monkeypatch.setattr(store, "decrypt_password", lambda tid, value: value.removeprefix("enc:"))

    async def no_config(*a, **k):
        return None
    monkeypatch.setattr(systems, "enqueue_config_load", no_config)
    monkeypatch.setattr(systems, "enqueue_discovery", lambda *a, **k: None)


def test_extraction_path_round_trip(app_engine):  # noqa: F811
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant
    from api.routes.systems import RegisterSystemRequest, UpdateSystemRequest, list_systems, register_system, update_system

    owner, app = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'ODP')"), {"t": tid})
    tenant = Tenant(uuid.UUID(tid), "ODP", [])
    aeng = create_async_engine(app.url.set(drivername="postgresql+asyncpg"))
    Session = async_sessionmaker(aeng, expire_on_commit=False)

    async def run():
        async with Session() as db:
            s4 = await register_system(RegisterSystemRequest(
                name="S4 QAS", system_type="s4hana_onprem", host="s4", client="200", sysnr="00",
                credentials={"password": "pw"}, extraction_path="odata", base_url="https://s4gw:44300",
                read_function="/BODS/RFC_READ_TABLE2"), db=db, tenant=tenant, role="admin")
            assert (s4.extraction_path, s4.read_function) == ("odata", "/BODS/RFC_READ_TABLE2")
            ecc = await register_system(RegisterSystemRequest(
                name="ECC PRD", system_type="ecc", host="ecc", client="100", sysnr="00",
                credentials={"password": "pw"}), db=db, tenant=tenant, role="admin")
            assert (ecc.extraction_path, ecc.read_function) == ("table_reader", None)

            # validation: OData is S/4 on premise only, and needs the Gateway URL
            with pytest.raises(HTTPException) as e:
                await register_system(RegisterSystemRequest(
                    name="ECC2", system_type="ecc", host="e", client="100", sysnr="00",
                    credentials={"password": "pw"}, extraction_path="odata"), db=db, tenant=tenant, role="admin")
            assert e.value.status_code == 400 and "S/4HANA on premise" in e.value.detail
            with pytest.raises(HTTPException) as e:
                await register_system(RegisterSystemRequest(
                    name="S4 no gw", system_type="s4hana_onprem", host="e", client="100", sysnr="00",
                    credentials={"password": "pw"}, extraction_path="odata"), db=db, tenant=tenant, role="admin")
            assert "base URL" in e.value.detail
            with pytest.raises(HTTPException):
                await register_system(RegisterSystemRequest(
                    name="SF", system_type="successfactors", base_url="https://sf", extraction_path="odp"),
                    db=db, tenant=tenant, role="admin")

            upd = await update_system(ecc.id, UpdateSystemRequest(extraction_path="auto", read_function="auto"),
                                      request=None, db=db, tenant=tenant, role="admin")
            assert (upd.extraction_path, upd.read_function) == ("auto", "auto")
            upd = await update_system(ecc.id, UpdateSystemRequest(read_function=""), request=None, db=db,
                                      tenant=tenant, role="admin")
            assert (upd.extraction_path, upd.read_function) == ("auto", None)  # "" clears the reader only
            with pytest.raises(HTTPException):
                await update_system(ecc.id, UpdateSystemRequest(extraction_path="odata"), request=None, db=db,
                                    tenant=tenant, role="admin")

            listed = {s.name: s for s in await list_systems(db=db, tenant=tenant, role="admin")}
            assert listed["S4 QAS"].extraction_path == "odata" and listed["ECC PRD"].extraction_path == "auto"
            return s4.id, ecc.id

    s4_id, ecc_id = asyncio.run(run())
    asyncio.run(aeng.dispose())

    # the database refuses a value the API would never write
    with owner.begin() as c, pytest.raises(Exception, match="ck_sap_systems_extraction_path"):
        c.execute(text("UPDATE sap_systems SET extraction_path = 'rfc' WHERE id = :s"), {"s": ecc_id})

    # the extraction receives the setting with the connection parameters
    from sqlalchemy.orm import Session as SyncSession

    from api.services.connectivity_manager import ConnectivityManager

    with SyncSession(app) as session:
        m = ConnectivityManager(session, tid)
        params = m._build_connection_params(m._load_system(s4_id))
        assert params["extraction_path"] == "odata" and params["read_function"] == "/BODS/RFC_READ_TABLE2"
        assert params["base_url"] == "https://s4gw:44300" and params["odata_auth"] == "basic"
        assert params["client"] == "200" and params["password"] == "pw"
        params = m._build_connection_params(m._load_system(ecc_id))
        assert params["extraction_path"] == "auto" and params["read_function"] == ""
        assert "base_url" not in params
    with owner.begin() as c:
        c.execute(text("DELETE FROM sap_systems WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})

"""SCIM 2.0 provisioning against a real Postgres (MERIDIAN_TEST_DB_URL): the token, discovery, users and groups in
the Entra ID and Okta payload shapes, the group-to-role map, SCIM errors, audit rows and tenant isolation.

Each test seeds its own tenant (tests/landscape_seed.py: Ann, the tenant's only admin, plus two systems).
"""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

ERROR = "urn:ietf:params:scim:api:messages:2.0:Error"
PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
USER = "urn:ietf:params:scim:schemas:core:2.0:User"
GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group"
ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


async def tenant_with_token(owner, monkeypatch):
    from tests.landscape_seed import seed

    s = seed(owner, with_run=False)
    async with await start(monkeypatch, s["tid"], s["user"]) as client:
        r = await client.post("/api/v1/admin/scim/token", headers=headers(), json={})
    assert r.status_code == 200, r.text
    s["token"] = r.json()["token"]
    s["client"] = await start(monkeypatch, s["tid"], s["user"])
    return s


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/scim+json"}


def okta_user(email: str, ext: str = "00u1abcdEFGH2345x697") -> dict:
    return {"schemas": [USER], "userName": email, "name": {"givenName": "Olive", "familyName": "Okta"},
            "emails": [{"primary": True, "value": email, "type": "work"}], "displayName": "Olive Okta",
            "locale": "en-US", "externalId": ext, "groups": [], "password": "ignored-by-meridian", "active": True}


def entra_user(upn: str, ext: str) -> dict:
    return {"schemas": [USER, ENTERPRISE], "externalId": ext, "userName": upn, "active": True,
            "displayName": "Adele Vance",
            "emails": [{"primary": True, "type": "work", "value": upn}],
            "name": {"formatted": "Adele Vance", "familyName": "Vance", "givenName": "Adele"},
            "title": "Finance lead", ENTERPRISE: {"department": "Finance", "employeeNumber": "42"}}


def user_row(owner, uid: str):
    with owner.connect() as c:
        return c.execute(text("SELECT u.email, u.name, u.role, u.is_active, u.token_version, su.external_id, "
                              "su.managed_roles FROM users u LEFT JOIN scim_users su ON su.user_id = u.id "
                              "WHERE u.id = :u"), {"u": uid}).one()


def grants(owner, uid: str) -> set[str]:
    with owner.connect() as c:
        return {r[0] for r in c.execute(text("SELECT role_key FROM user_role_scopes WHERE user_id = :u "
                                             "AND system_id IS NULL AND module IS NULL"), {"u": uid})}


def scim_error(r, status: int, scim_type: str | None = None) -> dict:
    assert r.status_code == status, r.text
    assert r.headers["content-type"].startswith("application/scim+json")
    body = r.json()
    assert body["schemas"] == [ERROR] and body["status"] == str(status) and body["detail"]
    if scim_type:
        assert body["scimType"] == scim_type
    return body


@pytest.mark.anyio
async def test_token_issue_rotate_revoke_and_admin_only(owner, monkeypatch):
    s = await tenant_with_token(owner, monkeypatch)
    client, token = s["client"], s["token"]
    async with client:
        assert token.startswith("mscim_") and "." in token
        status = (await client.get("/api/v1/admin/scim/token", headers=headers())).json()
        assert status["configured"] is True and status["base_url"].endswith("/scim/v2")
        assert token not in str(status) and status["token_prefix"].startswith("mscim_")
        with owner.connect() as c:
            stored = c.execute(text("SELECT token_hash FROM scim_tokens WHERE tenant_id = :t"), {"t": s["tid"]}).scalar()
        assert stored and token.split(".")[1] not in stored  # only the digest is kept

        assert (await client.get("/scim/v2/Users", headers=bearer(token))).status_code == 200
        r = await client.post("/api/v1/admin/scim/token", headers=headers(), json={"action": "rotate"})
        new = r.json()["token"]
        assert r.headers["cache-control"] == "no-store" and new != token
        scim_error(await client.get("/scim/v2/Users", headers=bearer(token)), 401)
        assert (await client.get("/scim/v2/Users", headers=bearer(new))).status_code == 200

        r = await client.post("/api/v1/admin/scim/token", headers=headers(), json={"action": "revoke"})
        assert r.status_code == 200 and r.json()["configured"] is False
        scim_error(await client.get("/scim/v2/Users", headers=bearer(new)), 401)
        assert (await client.post("/api/v1/admin/scim/token", headers=headers(), json={"action": "revoke"})).status_code == 404

        # admin only, and no token or a malformed one is a SCIM 401
        assert (await client.post("/api/v1/admin/scim/token", headers=headers("data_steward"), json={})).status_code == 403
        assert (await client.get("/api/v1/admin/scim/group-roles", headers=headers("viewer"))).status_code == 403
        scim_error(await client.get("/scim/v2/Users"), 401)
        scim_error(await client.get("/scim/v2/Users", headers=bearer("mscim_nope.nope")), 401)
        with owner.connect() as c:
            actions = [r[0] for r in c.execute(text("SELECT action FROM audit_log WHERE tenant_id = :t AND action LIKE "
                                                    "'scim.token.%' ORDER BY created_at"), {"t": s["tid"]})]
            assert actions == ["scim.token.create", "scim.token.rotate", "scim.token.revoke"]
            logged = " ".join(str(r[0]) + str(r[1]) for r in c.execute(text(
                "SELECT before_json, after_json FROM audit_log WHERE tenant_id = :t"), {"t": s["tid"]}))
            assert token.split(".")[1] not in logged and new.split(".")[1] not in logged


@pytest.mark.anyio
async def test_discovery(owner, monkeypatch):
    s = await tenant_with_token(owner, monkeypatch)
    async with s["client"] as client:
        spc = (await client.get("/scim/v2/ServiceProviderConfig", headers=bearer(s["token"]))).json()
        assert spc["patch"]["supported"] is True and spc["bulk"]["supported"] is False
        assert spc["filter"] == {"supported": True, "maxResults": 200}
        rt = (await client.get("/scim/v2/ResourceTypes", headers=bearer(s["token"]))).json()
        assert {r["id"] for r in rt["Resources"]} == {"User", "Group"} and rt["totalResults"] == 2
        sc = (await client.get("/scim/v2/Schemas", headers=bearer(s["token"]))).json()
        assert {r["id"] for r in sc["Resources"]} == {USER, GROUP}
        r = await client.get(f"/scim/v2/Schemas/{USER}", headers=bearer(s["token"]))
        assert "userName" in {a["name"] for a in r.json()["attributes"]}


@pytest.mark.anyio
async def test_okta_lifecycle(owner, monkeypatch):
    s = await tenant_with_token(owner, monkeypatch)
    t = bearer(s["token"])
    email = f"olive-{s['tid'][:8]}@example.com"
    async with s["client"] as client:
        r = await client.get("/scim/v2/Users", params={"filter": f'userName eq "{email}"', "startIndex": 1,
                                                        "count": 100}, headers=t)
        assert r.json() == {"schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], "totalResults": 0,
                            "startIndex": 1, "itemsPerPage": 0, "Resources": []}
        r = await client.post("/scim/v2/Users", json=okta_user(email), headers=t)
        assert r.status_code == 201, r.text
        user = r.json()
        uid = user["id"]
        assert r.headers["location"].endswith(f"/scim/v2/Users/{uid}")
        assert user["userName"] == email and user["externalId"] == "00u1abcdEFGH2345x697" and user["active"] is True
        assert user["name"]["givenName"] == "Olive" and user["emails"][0]["value"] == email
        email_, name, role, active, _tv, ext, _m = user_row(owner, uid)
        assert (email_, name, role, active, ext) == (email, "Olive Okta", "viewer", True, "00u1abcdEFGH2345x697")

        r = await client.get("/scim/v2/Users", params={"filter": f'userName eq "{email.upper()}"'}, headers=t)
        assert r.json()["totalResults"] == 1 and r.json()["Resources"][0]["id"] == uid

        # Okta deactivates with a path-less replace
        tv = user_row(owner, uid)[4]
        r = await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={
            "schemas": [PATCH], "Operations": [{"op": "replace", "value": {"active": False}}]})
        assert r.status_code == 200 and r.json()["active"] is False
        assert user_row(owner, uid)[3] is False and user_row(owner, uid)[4] == tv + 1  # every session ended
        # ... and PUTs the full profile back to reactivate and rename
        body = {**okta_user(email), "name": {"givenName": "Olivia", "familyName": "Okta"}, "active": True}
        r = await client.put(f"/scim/v2/Users/{uid}", json=body, headers=t)
        assert r.status_code == 200 and r.json()["active"] is True and r.json()["name"]["givenName"] == "Olivia"
        assert user_row(owner, uid)[1] == "Olivia Okta"

        # DELETE deactivates; the user is still there
        assert (await client.delete(f"/scim/v2/Users/{uid}", headers=t)).status_code == 204
        r = await client.get(f"/scim/v2/Users/{uid}", headers=t)
        assert r.status_code == 200 and r.json()["active"] is False
        with owner.connect() as c:
            actions = [r[0] for r in c.execute(text(
                "SELECT action FROM audit_log WHERE tenant_id = :t AND actor_email LIKE 'scim:%' ORDER BY created_at"),
                {"t": s["tid"]})]
        assert actions == ["scim.user.create", "scim.user.patch", "scim.user.replace", "scim.user.deactivate"]


@pytest.mark.anyio
async def test_entra_shapes(owner, monkeypatch):
    s = await tenant_with_token(owner, monkeypatch)
    t = bearer(s["token"])
    ext = str(uuid.uuid4())  # Entra ID sends the object id (a GUID) as externalId
    upn = f"adele-{s['tid'][:8]}@contoso.example"
    async with s["client"] as client:
        r = await client.post("/scim/v2/Users", json=entra_user(upn, ext), headers=t)
        assert r.status_code == 201, r.text
        uid = r.json()["id"]
        assert r.json()["name"] == {"formatted": "Adele Vance", "givenName": "Adele", "familyName": "Vance"}
        r = await client.get("/scim/v2/Users", params={"filter": f'externalId eq "{ext}"'}, headers=t)
        assert [u["id"] for u in r.json()["Resources"]] == [uid]

        # Entra's PATCH: capitalised ops, a string boolean, a filtered emails path, an extension attribute
        r = await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={"schemas": [PATCH], "Operations": [
            {"op": "Replace", "path": "active", "value": "False"},
            {"op": "Add", "path": 'emails[type eq "work"].value', "value": f"vance-{s['tid'][:8]}@contoso.example"},
            {"op": "Replace", "path": "name.givenName", "value": "Adela"},
            {"op": "Add", "path": f"{ENTERPRISE}:department", "value": "Treasury"},
            {"op": "Replace", "path": "title", "value": "Treasurer"}]})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["active"] is False and out["emails"][0]["value"] == f"vance-{s['tid'][:8]}@contoso.example"
        assert out["name"]["givenName"] == "Adela"
        assert user_row(owner, uid)[0] == f"vance-{s['tid'][:8]}@contoso.example"
        r = await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={"schemas": [PATCH], "Operations": [
            {"op": "Replace", "path": "active", "value": "True"}, {"op": "Remove", "path": "externalId"}]})
        assert r.json()["active"] is True and "externalId" not in r.json()
        # an existing user (made in Meridian) is found by userName, so the IdP links instead of duplicating
        r = await client.get("/scim/v2/Users", params={"filter": f'userName eq "ann-{s["tid"][:8]}@example.com"'},
                             headers=t)
        assert r.json()["totalResults"] == 1 and r.json()["Resources"][0]["id"] == s["user"]


@pytest.mark.anyio
async def test_groups_drive_roles(owner, monkeypatch):
    s = await tenant_with_token(owner, monkeypatch)
    t = bearer(s["token"])
    async with s["client"] as client:
        r = await client.put("/api/v1/admin/scim/group-roles", headers=headers(), json={"mappings": [
            {"group": "Meridian Stewards", "role": "data_steward"}, {"group": "Meridian Leads", "role": "programme_lead"}]})
        assert r.status_code == 200, r.text
        assert {(m["group"], m["role"], m["group_exists"]) for m in r.json()["mappings"]} == {
            ("Meridian Stewards", "data_steward", False), ("Meridian Leads", "programme_lead", False)}
        uid = (await client.post("/scim/v2/Users", json=okta_user(f"g-{s['tid'][:8]}@example.com"), headers=t)).json()["id"]
        other = (await client.post("/scim/v2/Users", json=entra_user(f"o-{s['tid'][:8]}@example.com",
                                                                      str(uuid.uuid4())), headers=t)).json()["id"]
        # a hand-made grant SCIM did not make is never SCIM's to take away
        with owner.begin() as c:
            c.execute(text("INSERT INTO user_role_scopes (tenant_id, user_id, role_key) VALUES (:t, :u, 'analyst')"),
                      {"t": s["tid"], "u": uid})

        r = await client.post("/scim/v2/Groups", headers=t, json={
            "schemas": [GROUP], "displayName": "meridian stewards", "externalId": "okta-grp-1",
            "members": [{"value": uid}]})
        assert r.status_code == 201, r.text
        gid = r.json()["id"]
        assert [m["value"] for m in r.json()["members"]] == [uid]
        assert grants(owner, uid) == {"analyst", "data_steward"} and user_row(owner, uid)[2] == "data_steward"
        assert user_row(owner, uid)[6] == ["data_steward"]
        r = await client.get(f"/scim/v2/Users/{uid}", headers=t)
        assert r.json()["groups"][0]["value"] == gid and r.json()["roles"] == [{"value": "data_steward", "primary": True}]

        # Okta adds a member with a members path; Entra removes one with a value filter
        r = await client.patch(f"/scim/v2/Groups/{gid}", headers=t, json={"schemas": [PATCH], "Operations": [
            {"op": "add", "path": "members", "value": [{"value": other, "display": "Adele"}]}]})
        assert r.status_code == 200 and {m["value"] for m in r.json()["members"]} == {uid, other}
        assert grants(owner, other) == {"data_steward"}
        r = await client.patch(f"/scim/v2/Groups/{gid}", headers=t, json={"schemas": [PATCH], "Operations": [
            {"op": "Remove", "path": f'members[value eq "{uid}"]'}]})
        assert [m["value"] for m in r.json()["members"]] == [other]
        assert grants(owner, uid) == {"analyst"} and user_row(owner, uid)[2] == "analyst"

        # groups on the user: add through the user's PATCH
        lead = (await client.post("/scim/v2/Groups", headers=t, json={"displayName": "Meridian Leads"})).json()["id"]
        r = await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={"schemas": [PATCH], "Operations": [
            {"op": "add", "path": "groups", "value": [{"value": lead}]}]})
        assert r.status_code == 200 and [g["value"] for g in r.json()["groups"]] == [lead]
        assert grants(owner, uid) == {"analyst", "programme_lead"} and user_row(owner, uid)[2] == "programme_lead"

        # the map changes: everyone in a SCIM group follows at once
        r = await client.put("/api/v1/admin/scim/group-roles", headers=headers(), json={"mappings": [
            {"group": "Meridian Stewards", "role": "sap_basis"}, {"group": "Meridian Leads", "role": "programme_lead"}]})
        assert r.json()["resynced_users"] == 1
        assert grants(owner, other) == {"sap_basis"}
        # renaming a group to a name the map does not know takes its role away
        r = await client.patch(f"/scim/v2/Groups/{lead}", headers=t, json={"schemas": [PATCH], "Operations": [
            {"op": "replace", "value": {"displayName": "Former leads"}}]})
        assert r.status_code == 200 and r.json()["displayName"] == "Former leads"
        assert grants(owner, uid) == {"analyst"}
        # deleting a group takes its role from its members
        assert (await client.delete(f"/scim/v2/Groups/{gid}", headers=t)).status_code == 204
        assert grants(owner, other) == set() and user_row(owner, other)[2] == "viewer"
        scim_error(await client.get(f"/scim/v2/Groups/{gid}", headers=t), 404)

        r = await client.get("/scim/v2/Groups", params={"filter": 'displayName eq "former leads"',
                                                         "excludedAttributes": "members"}, headers=t)
        assert r.json()["totalResults"] == 1 and "members" not in r.json()["Resources"][0]
        with owner.connect() as c:
            n = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND action = 'scim.roles'"),
                          {"t": s["tid"]}).scalar()
        assert n >= 6


@pytest.mark.anyio
async def test_scim_errors(owner, monkeypatch):
    s = await tenant_with_token(owner, monkeypatch)
    t = bearer(s["token"])
    async with s["client"] as client:
        scim_error(await client.get("/scim/v2/Users", params={"filter": 'name.familyName co "x"'}, headers=t), 400,
                   "invalidFilter")
        scim_error(await client.get("/scim/v2/Users", params={"filter": 'title eq "x"'}, headers=t), 400,
                   "invalidFilter")
        scim_error(await client.get(f"/scim/v2/Users/{uuid.uuid4()}", headers=t), 404)
        scim_error(await client.get("/scim/v2/Users/not-a-uuid", headers=t), 404)
        scim_error(await client.post("/scim/v2/Users", content=b"{not json", headers=t), 400, "invalidSyntax")
        scim_error(await client.post("/scim/v2/Users", json={"schemas": [USER], "name": {"givenName": "x"}},
                                     headers=t), 400, "invalidValue")
        email = f"dup-{s['tid'][:8]}@example.com"
        assert (await client.post("/scim/v2/Users", json=okta_user(email), headers=t)).status_code == 201
        scim_error(await client.post("/scim/v2/Users", json=okta_user(email, "00uOther"), headers=t), 409, "uniqueness")
        scim_error(await client.post("/scim/v2/Users", json=okta_user(f"x{email}"), headers=t), 409, "uniqueness")
        uid = (await client.get("/scim/v2/Users", params={"filter": f'userName eq "{email}"'}, headers=t)
               ).json()["Resources"][0]["id"]
        scim_error(await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={
            "schemas": [PATCH], "Operations": [{"op": "move", "path": "active", "value": True}]}), 400, "invalidSyntax")
        scim_error(await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={
            "schemas": [PATCH], "Operations": [{"op": "replace", "path": "active", "value": "maybe"}]}), 400,
            "invalidValue")
        scim_error(await client.patch(f"/scim/v2/Users/{uid}", headers=t, json={
            "schemas": [PATCH], "Operations": [{"op": "add", "path": "groups", "value": [{"value": str(uuid.uuid4())}]}]}),
            400, "invalidValue")
        assert (await client.post("/scim/v2/Groups", headers=t, json={"displayName": "Dup"})).status_code == 201
        scim_error(await client.post("/scim/v2/Groups", headers=t, json={"displayName": "dup"}), 409, "uniqueness")
        scim_error(await client.post("/scim/v2/Groups", headers=t, json={"members": []}), 400, "invalidValue")
        # the tenant's only admin cannot be deactivated from the identity provider
        scim_error(await client.delete(f"/scim/v2/Users/{s['user']}", headers=t), 409)
        assert user_row(owner, s["user"])[3] is True
        # the group-to-role map refuses unknown and retired roles and duplicate groups
        for bad in ([{"group": "A", "role": "no_such_role"}], [{"group": "A", "role": "steward"}],
                    [{"group": "A", "role": "viewer"}, {"group": " a ", "role": "analyst"}]):
            r = await client.put("/api/v1/admin/scim/group-roles", headers=headers(), json={"mappings": bad})
            assert r.status_code == 422, r.text


@pytest.mark.anyio
async def test_tenant_isolation(owner, monkeypatch):
    a = await tenant_with_token(owner, monkeypatch)
    async with a["client"]:
        pass
    b = await tenant_with_token(owner, monkeypatch)
    async with b["client"] as client:
        ua = (await client.post("/scim/v2/Users", json=okta_user(f"a-{a['tid'][:8]}@example.com"),
                                headers=bearer(a["token"]))).json()["id"]
        ub = (await client.post("/scim/v2/Users", json=okta_user(f"b-{b['tid'][:8]}@example.com"),
                                headers=bearer(b["token"]))).json()["id"]
        ga = (await client.post("/scim/v2/Groups", json={"displayName": "Same name"}, headers=bearer(a["token"]))).json()
        gb = await client.post("/scim/v2/Groups", json={"displayName": "Same name"}, headers=bearer(b["token"]))
        assert gb.status_code == 201  # group names are unique per tenant only
        listed = (await client.get("/scim/v2/Users", headers=bearer(a["token"]))).json()["Resources"]
        assert ua in {u["id"] for u in listed} and ub not in {u["id"] for u in listed}
        assert a["user"] in {u["id"] for u in listed} and b["user"] not in {u["id"] for u in listed}
        scim_error(await client.get(f"/scim/v2/Users/{ub}", headers=bearer(a["token"])), 404)
        scim_error(await client.patch(f"/scim/v2/Users/{ub}", headers=bearer(a["token"]), json={
            "schemas": [PATCH], "Operations": [{"op": "replace", "path": "active", "value": False}]}), 404)
        scim_error(await client.delete(f"/scim/v2/Groups/{gb.json()['id']}", headers=bearer(a["token"])), 404)
        # a member from another tenant is refused
        scim_error(await client.patch(f"/scim/v2/Groups/{ga['id']}", headers=bearer(a["token"]), json={
            "schemas": [PATCH], "Operations": [{"op": "add", "path": "members", "value": [{"value": ub}]}]}),
            400, "invalidValue")
        assert user_row(owner, ub)[3] is True


def test_rls_on_new_tables(owner):
    """The policy itself, as a role that cannot bypass row-level security."""
    t1, t2 = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        for t in (t1, t2):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'R')"), {"t": t})
            c.execute(text("INSERT INTO scim_groups (tenant_id, display_name) VALUES (:t, 'G')"), {"t": t})
            c.execute(text("INSERT INTO tenant_settings (tenant_id, key, value) VALUES (:t, 'theme', '{}')"), {"t": t})
            c.execute(text("INSERT INTO health_samples (tenant_id, sampled_at, component, status) "
                           "VALUES (:t, now(), 'db', 'up')"), {"t": t})
            c.execute(text("INSERT INTO scim_group_role_map (tenant_id, group_key, display_name, role_key) "
                           "VALUES (:t, 'g', 'G', 'viewer')"), {"t": t})
        c.execute(text("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'step8_rls_app') THEN "
                       "CREATE ROLE step8_rls_app NOSUPERUSER NOBYPASSRLS; END IF; END $$"))
        c.execute(text("GRANT SELECT, UPDATE ON scim_groups, tenant_settings, health_samples, scim_group_role_map, "
                       "scim_tokens, scim_users, scim_group_members TO step8_rls_app"))
    with owner.connect() as conn:
        tx = conn.begin()
        conn.execute(text("SET LOCAL ROLE step8_rls_app"))
        conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": t1})
        for table in ("scim_groups", "tenant_settings", "health_samples", "scim_group_role_map"):
            seen = {str(r[0]) for r in conn.execute(text(f"SELECT DISTINCT tenant_id FROM {table} "
                                                         f"WHERE tenant_id IN (:a, :b)"), {"a": t1, "b": t2})}
            assert seen == {t1}, table
        assert conn.execute(text("UPDATE scim_groups SET display_name = 'x' WHERE tenant_id = :t"),
                            {"t": t2}).rowcount == 0
        tx.rollback()

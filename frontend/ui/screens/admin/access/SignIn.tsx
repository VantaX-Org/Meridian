"use client";

import { useState } from "react";
import { Button, Card, Code, Confirm, EmptyState, Field, Input, Select, Toggle } from "@/ui/kit";
import { Facts, Frame, day, useAct, useCan, useSectionChat, useSync } from "../common";
import { useRoles, useSso } from "@/lib/v2/admin-queries";
import { useScimGroupRoles, useScimToken } from "@/lib/v2/enterprise-queries";
import { removeSso, saveSso, testSso } from "@/lib/api/v2/admin";
import { putScimGroupRoles, revokeScimToken, rotateScimToken } from "@/lib/api/v2/enterprise";
import { roleText } from "@/lib/v2/labels";
import { t, tx } from "@/lib/v2/i18n";
import { apiErrorMessage } from "@/lib/error";

type Map = { group: string; role: string };

export function SignIn() {
  const can = useCan();
  const edit = can("manage_users");
  const sso = useSso();
  const token = useScimToken();
  const groups = useScimGroupRoles();
  const roles = useRoles();
  const { run, busy } = useAct();
  const c = sso.data;

  const [f, setF] = useState({ issuer: "", client_id: "", client_secret: "", display_name: "", domains: "", enforce: false });
  const [test, setTest] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [ask, setAsk] = useState<"sso" | "rotate" | "revoke" | null>(null);
  const [maps, setMaps] = useState<Map[]>([]);

  useSync(c, (c) => setF({ issuer: c.issuer, client_id: c.client_id, client_secret: "", display_name: c.display_name, domains: c.allowed_domains.join(", "), enforce: c.enforce }));
  useSync(groups.data, (g) => setMaps(g.mappings.map((m) => ({ group: m.group, role: m.role }))));

  const tk = token.data;
  useSectionChat("signin", t("Sign in and provisioning"), [
    c?.configured ? t("Single sign-on is set up with {issuer}.", { issuer: c.issuer }) : t("Single sign-on is not set up."),
    c?.enforce ? t("People must sign in through single sign-on.") : t("Password sign-in is still allowed."),
    tk?.configured ? t("SCIM provisioning has a token.") : t("SCIM provisioning has no token."),
  ], [t("Is single sign-on enforced?"), t("Is SCIM provisioning on?")]);

  const input = () => ({ issuer: f.issuer, client_id: f.client_id, display_name: f.display_name, allowed_domains: f.domains.split(",").map((d) => d.trim()).filter(Boolean), default_role: "viewer" as const, enforce: f.enforce, ...(f.client_secret ? { client_secret: f.client_secret } : {}) });
  const runTest = async () => {
    setTest(null);
    try { const r = await testSso(f.issuer); setTest(tx(r.message)); } catch (e) { setTest(tx(apiErrorMessage(e))); }
  };
  const rotate = async () => { const r = await run(() => rotateScimToken(), t("A new SCIM token is ready."), ["scim"]); if (r?.token) setNewToken(r.token); };

  const roleOptions = (roles.data ?? []).map((r) => ({ value: r.key, label: roleText(r.key) }));
  return (
    <Frame slug="signin" title={t("Sign in and provisioning")} lead={t("Single sign-on, SCIM provisioning and the groups that map to roles.")} loading={sso.isLoading} error={sso.isError}>
      <Card title={t("Single sign-on")} sub={c?.configured ? t("Configured") : t("Not configured")}>
        <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => saveSso(input()), t("Single sign-on saved."), ["sso"]); }}>
          <Field label={t("Issuer URL")}><Input value={f.issuer} disabled={!edit} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></Field>
          <Field label={t("Client ID")}><Input value={f.client_id} disabled={!edit} onChange={(e) => setF({ ...f, client_id: e.target.value })} /></Field>
          <Field label={t("Client secret")} hint={c?.has_secret ? t("A secret is stored. Leave empty to keep it.") : t("No secret is stored yet.")}>
            <Input type="password" autoComplete="off" value={f.client_secret} disabled={!edit} onChange={(e) => setF({ ...f, client_secret: e.target.value })} />
          </Field>
          <Field label={t("Button label")}><Input value={f.display_name} disabled={!edit} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
          <Field label={t("Allowed email domains")} hint={t("Separate domains with a comma.")}><Input value={f.domains} disabled={!edit} onChange={(e) => setF({ ...f, domains: e.target.value })} /></Field>
          <Toggle label={t("Require single sign-on")} checked={f.enforce} onChange={(v: boolean) => setF({ ...f, enforce: v })} />
          {c && <Facts items={[[t("Redirect address"), <Code key="r" code={c.redirect_uri} description={t("Register this with your identity provider")} />], [t("New people get the role"), roleText(c.default_role)]]} />}
          <div className="mx-links">
            {edit && <Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button>}
            <Button variant="secondary" type="button" onClick={runTest}>{t("Test the connection")}</Button>
            {edit && c?.configured && <Button variant="ghost" type="button" onClick={() => setAsk("sso")}>{t("Remove")}</Button>}
          </div>
          {test && <p role="status" className="mx-muted">{test}</p>}
        </form>
      </Card>

      <Card title={t("SCIM provisioning")} sub={t("Lets your identity provider create and remove people.")}>
        {newToken && (
          <div role="status" className="mx-col">
            <p>{t("Copy the token now. It is shown once.")}</p>
            <Code code={newToken} description={t("SCIM token")} />
          </div>
        )}
        {!tk ? <EmptyState heading={t("No SCIM status is available")} /> : (
          <>
            <Facts items={[
              [t("Address"), <Code key="u" code={tk.base_url} description={t("SCIM base address")} />],
              [t("Token"), tk.configured ? tk.token_prefix : t("None")],
              [t("Created"), day(tk.created_at)],
              [t("Last used"), day(tk.last_used_at)],
            ]} />
            {edit && (
              <div className="mx-links">
                <Button variant="primary" onClick={() => setAsk("rotate")}>{tk.configured ? t("Rotate the token") : t("Create a token")}</Button>
                {tk.configured && <Button variant="ghost" onClick={() => setAsk("revoke")}>{t("Revoke the token")}</Button>}
              </div>
            )}
          </>
        )}
      </Card>

      <Card title={t("Group to role")} sub={t("A person in a group gets the mapped role.")}>
        {maps.length === 0 && <p className="mx-muted">{t("No groups are mapped yet.")}</p>}
        <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => putScimGroupRoles(maps.filter((m) => m.group.trim())), t("Group mapping saved."), ["scim"]); }}>
          {maps.map((m, i) => (
            <div key={i} className="mx-links">
              <Input aria-label={t("Group")} value={m.group} disabled={!edit} onChange={(e) => setMaps(maps.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)))} />
              <Select aria-label={t("Role")} value={m.role} disabled={!edit} options={roleOptions} onChange={(e) => setMaps(maps.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
              {edit && <Button variant="ghost" type="button" onClick={() => setMaps(maps.filter((_, j) => j !== i))}>{t("Remove")}</Button>}
            </div>
          ))}
          {edit && (
            <div className="mx-links">
              <Button variant="secondary" type="button" onClick={() => setMaps([...maps, { group: "", role: roleOptions[0]?.value ?? "viewer" }])}>{t("Add a group")}</Button>
              <Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button>
            </div>
          )}
        </form>
      </Card>

      <Confirm open={ask === "sso"} danger title={t("Remove single sign-on?")} confirmLabel={t("Remove")} cancelLabel={t("Cancel")}
        onCancel={() => setAsk(null)} onConfirm={() => { setAsk(null); void run(() => removeSso(), t("Single sign-on removed."), ["sso"]); }}>
        {t("People can then sign in only with a password.")}
      </Confirm>
      <Confirm open={ask === "rotate"} title={t("Create a new SCIM token?")} confirmLabel={t("Create")} cancelLabel={t("Cancel")}
        onCancel={() => setAsk(null)} onConfirm={() => { setAsk(null); void rotate(); }}>
        {t("The old token stops working at once.")}
      </Confirm>
      <Confirm open={ask === "revoke"} danger title={t("Revoke the SCIM token?")} confirmLabel={t("Revoke")} cancelLabel={t("Cancel")}
        onCancel={() => setAsk(null)} onConfirm={() => { setAsk(null); setNewToken(null); void run(() => revokeScimToken(), t("SCIM token revoked."), ["scim"]); }}>
        {t("Your identity provider can no longer provision people.")}
      </Confirm>
    </Frame>
  );
}

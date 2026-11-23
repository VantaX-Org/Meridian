"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { testEditedConnection, updateSystem, type ConnectionBody, type SystemPatch } from "@/lib/api/v2/sys";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { validate } from "@/lib/forms";
import { authFor, authOptions, EMPTY, HINT, NEEDS_TOKEN_URL, RFC_TYPES, schemaFor, TOKEN_HINT, type ConnectionValues, type Key } from "@/lib/connection-form";
import { t, tx } from "@/lib/v2/i18n";
import type { SAPSystemExtended } from "@/types/api";
import { Button, Card, Field, Input, Select, useToast } from "@/ui/kit";
import { useCan } from "../admin/common";
import { errMsg } from "./shared";

const SECRETS = ["password", "client_id", "client_secret", "api_key"] as const;
const fieldsOf = (rfc: boolean): Key[] => (rfc ? ["host", "client", "sysnr", "username"] : ["base_url", "token_url", "company_id", "username", "auth_type"]);

/** Start values: what the system stores. The server never returns secrets, so they start empty. */
export function valuesOf(s: SAPSystemExtended): ConnectionValues {
  return {
    ...EMPTY, name: s.name, system_type: s.system_type, environment: s.environment, auth_type: authFor(s.system_type, s.auth_type),
    host: s.host ?? "", client: s.client ?? "", sysnr: s.sysnr ?? "", username: s.username ?? "",
    base_url: s.base_url ?? "", token_url: s.token_url ?? "", company_id: s.company_id ?? "",
  };
}

const typed = (v: ConnectionValues): Record<string, string> => Object.fromEntries(SECRETS.filter((k) => v[k]).map((k) => [k, v[k]]));

/** PUT body: only the fields that changed plus the secrets typed. Router and SNC are not sent, so the stored ones stay. */
export function patchOf(s: SAPSystemExtended, v: ConnectionValues): SystemPatch {
  const before = valuesOf(s);
  const patch: Record<string, unknown> = {};
  for (const k of fieldsOf(RFC_TYPES.includes(s.system_type))) if (v[k].trim() !== before[k].trim()) patch[k] = v[k].trim();
  const credentials = typed(v);
  if (Object.keys(credentials).length) patch.credentials = credentials;
  return patch as SystemPatch;
}

/** Test body: every field as edited; a secret left out falls back to the stored one on the server. */
export function bodyOf(s: SAPSystemExtended, v: ConnectionValues): ConnectionBody {
  const fields = Object.fromEntries(fieldsOf(RFC_TYPES.includes(s.system_type)).filter((k) => v[k].trim()).map((k) => [k, v[k].trim()]));
  return { name: s.name, system_type: s.system_type, environment: s.environment, ...fields, credentials: typed(v) } as ConnectionBody;
}

/** Edit a system's address and secrets, try the draft, save it, then re-test the stored connection. */
export function ConnectionTab({ s }: { s: SAPSystemExtended }) {
  const qc = useQueryClient();
  const toast = useToast();
  const manage = useCan()("manage_systems");
  const type = s.system_type;
  const rfc = RFC_TYPES.includes(type);
  const [v, setV] = useState<ConnectionValues>(() => valuesOf(s));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const auth = authFor(type, v.auth_type);
  const basic = auth === "basic";
  const errors = useMemo(() => validate(schemaFor(type, auth, { secretsOptional: true }), v).errors, [type, auth, v]);
  const err = (k: Key): string | undefined => (touched && errors[k] ? tx(errors[k] as string) : undefined);
  const set = (k: Key, value: string) => { setV((p) => ({ ...p, [k]: value })); setResult(null); };
  const kept = t("Leave empty to keep the stored secret");
  const run = async (key: string, fn: () => Promise<void>) => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(key);
    try { await fn(); } catch (e) { setResult({ ok: false, message: errMsg(e) }); } finally { setBusy(null); }
  };
  const test = () => run("test", async () => { const r = await testEditedConnection(s.id, bodyOf(s, v)); setResult({ ok: r.connected, message: r.message }); });
  const save = () => run("save", async () => {
    const patch = patchOf(s, v);
    if (Object.keys(patch).length) await updateSystem(s.id, patch);
    setV((p) => ({ ...p, password: "", client_id: "", client_secret: "", api_key: "" }));
    await qc.invalidateQueries({ queryKey: ["v2"] });
    const r = await testSystemConnection(s.id);
    setResult({ ok: r.connected, message: r.message });
    toast(r.connected ? t("{name} answered.", { name: s.name }) : t("{name} did not answer: {why}", { name: s.name, why: r.message }), r.connected ? "good" : "bad");
    await qc.invalidateQueries({ queryKey: ["v2"] });
  });
  if (!manage) return <Card title={t("Connection")}><p>{t("Ask a programme lead for the manage systems permission.")}</p></Card>;
  const secret = (k: Key, label: string) => (
    <Field label={label} hint={kept} error={err(k)}><Input type="password" value={v[k]} autoComplete="new-password" placeholder="********" onChange={(e) => set(k, e.target.value)} /></Field>
  );
  return (
    <Card title={t("Connection")}>
      <p>{t("Change the address or the credentials, test, then save. A secret left empty keeps the stored one.")}</p>
      {rfc ? (
        <>
          <Field label={t("Host")} hint={tx(HINT.host)} error={err("host")}><Input value={v.host} onChange={(e) => set("host", e.target.value)} /></Field>
          <Field label={t("Client")} hint={tx(HINT.client)} error={err("client")}><Input value={v.client} inputMode="numeric" onChange={(e) => set("client", e.target.value)} /></Field>
          <Field label={t("Instance number")} hint={tx(HINT.sysnr)} error={err("sysnr")}><Input value={v.sysnr} inputMode="numeric" onChange={(e) => set("sysnr", e.target.value)} /></Field>
          <Field label={t("User")} hint={tx(HINT.username)}><Input value={v.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} /></Field>
          {secret("password", t("Password"))}
        </>
      ) : (
        <>
          {authOptions(type).length > 1 ? <Field label={t("Sign-in method")}><Select value={auth} options={authOptions(type).map((o) => ({ value: o.value, label: tx(o.label) }))} onChange={(e) => set("auth_type", e.target.value)} /></Field> : null}
          <Field label={t("Base URL")} hint={tx(HINT.base_url)} error={err("base_url")}><Input value={v.base_url} onChange={(e) => set("base_url", e.target.value)} /></Field>
          {!basic && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors" || type === "concur") ? (
            <Field label={t("Token URL")} hint={tx(TOKEN_HINT[type] ?? HINT.token_url)} error={err("token_url")}><Input value={v.token_url} onChange={(e) => set("token_url", e.target.value)} /></Field>
          ) : null}
          {type === "successfactors" || type === "ariba" ? (
            <Field label={type === "ariba" ? t("Realm") : t("Company ID")} hint={tx(type === "ariba" ? HINT.realm : HINT.company_id)} error={err("company_id")}><Input value={v.company_id} onChange={(e) => set("company_id", e.target.value)} /></Field>
          ) : null}
          {basic ? (
            <>
              <Field label={t("User")} hint={tx(HINT.basic_username)} error={err("username")}><Input value={v.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} /></Field>
              {secret("password", t("Password"))}
            </>
          ) : (
            <>{secret("client_id", t("Client ID"))}{secret("client_secret", t("Client secret"))}</>
          )}
          {type === "ariba" ? secret("api_key", t("API key")) : null}
        </>
      )}
      {result ? <p role="status">{result.ok ? t("Connected.") : t("Not connected.")} {result.message}</p> : null}
      <Button variant="secondary" disabled={busy !== null} onClick={() => void test()}>{busy === "test" ? t("Testing") : t("Test these settings")}</Button>
      <Button variant="primary" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? t("Saving") : t("Save and test")}</Button>
    </Card>
  );
}

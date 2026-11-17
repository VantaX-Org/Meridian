"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { t, tx } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { usePolicyPacks } from "@/lib/v2/step10-queries";
import { cronError, MODES, PRESETS } from "@/lib/v2/cron";
import { roleWord } from "@/lib/v2/people";
import { VIEW_AS_ROLES } from "@/lib/v2/view-as";
import { validate } from "@/lib/forms";
import { createProfile, registerSystem, testDraftConnection, type ConnectionBody } from "@/lib/api/v2/sys";
import { applyPolicyPack } from "@/lib/api/v2/step10";
import { inviteUser } from "@/lib/api/v2/admin";
import {
  authFor, authOptions, connectionOf, EMPTY, ENVIRONMENTS, HINT, NEEDS_TOKEN_URL, RFC_TYPES, schemaFor, TOKEN_HINT, TYPES,
  type ConnectionValues, type Key,
} from "@/lib/connection-form";
import type { SystemType } from "@/types/api";
import { Button, Card, Chip, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Stepper, useToast } from "@/ui/kit";
import { errMsg } from "./shared";

const EMAIL_EG = ["name", "example.invalid"].join("@");
const STEPS = ["connect", "packs", "schedule", "invite"] as const;
type Step = (typeof STEPS)[number];

/** The connect wizard (J10). The password lives in component state only until the system is registered, then it is dropped. */
export function SystemNew() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useV2Session();
  const allowed = can("manage_systems");

  const [step, setStep] = useState<Step>("connect");
  const [v, setV] = useState<ConnectionValues>({ ...EMPTY });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [packs, setPacks] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [cron, setCron] = useState(PRESETS[1]?.value ?? "0 2 * * *");
  const [mode, setMode] = useState<"full" | "delta">("delta");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("data_steward");

  const type = v.system_type as SystemType;
  const rfc = RFC_TYPES.includes(type);
  const auth = authFor(type, v.auth_type);
  const basic = auth === "basic";
  const errors = useMemo(
    () => validate(schemaFor(type, auth, { odataPath: type === "s4hana_onprem" && v.extraction_path === "odata", snc: v.snc_mode === "1" }), v).errors,
    [type, auth, v],
  );
  const err = (k: Key): string | undefined => (touched && errors[k] ? tx(errors[k] as string) : undefined);
  const set = (k: Key, value: string) => { setV((p) => ({ ...p, [k]: value })); setResult(null); };
  const setType = (value: string) => setV((p) => ({ ...p, system_type: value, auth_type: authFor(value as SystemType, ""), base_url: "", token_url: "", company_id: "" }));
  const valid = Object.keys(errors).length === 0;

  const body = (): ConnectionBody => {
    const { connection, credentials } = connectionOf(v);
    return { name: v.name.trim(), system_type: type, environment: v.environment, ...connection, credentials };
  };
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(errMsg(e)); } finally { setBusy(null); }
  };
  const test = () => {
    setTouched(true);
    if (!valid) return;
    void run("test", async () => { const r = await testDraftConnection(body()); setResult({ ok: r.connected, message: r.message }); });
  };
  const register = () => {
    setTouched(true);
    if (!valid) return;
    void run("register", async () => {
      const s = await registerSystem(body());
      setV((p) => ({ ...p, password: "", client_secret: "", api_key: "" }));
      setCreated({ id: s.id, name: s.name });
      await qc.invalidateQueries({ queryKey: ["v2"] });
      toast(t("System connected."), "good");
      setStep("packs");
    });
  };

  const packQ = usePolicyPacks(step === "packs");
  const next = (from: Step) => setStep(STEPS[STEPS.indexOf(from) + 1] ?? "invite");
  const finish = () => router.push(created ? `/n/s/${created.id}` : "/n/s");

  if (!allowed) return (
    <div className="mx-col">
      <PageHeader title={t("Connect a system")} />
      <EmptyState heading={t("You cannot connect systems")} body={t("Ask a programme lead for the manage systems permission.")} action={<Button variant="secondary" href="/n/s">{t("All systems")}</Button>} />
    </div>
  );

  const labelSteps = STEPS.map((id) => ({ id, label: id === "connect" ? t("Connect") : id === "packs" ? t("Policy packs") : id === "schedule" ? t("Schedule runs") : t("Invite people") }));

  return (
    <div className="mx-col">
      <PageHeader title={t("Connect a system")} actions={<Button variant="secondary" href="/n/s">{t("All systems")}</Button>} />
      <Stepper steps={labelSteps} current={STEPS.indexOf(step)} label={t("Connection steps")} />
      {error ? <ErrorState heading={t("That did not work")} body={error} /> : null}

      {step === "connect" ? (
        <Card title={t("Connect SAP")} sub={t("Meridian reads from the system and never writes to it. The password goes to the server once and is not shown again.")}>
          <div className="mx-col">
            <Field label={t("System name")} error={err("name")}><Input value={v.name} placeholder={t("ECC Production")} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label={t("System type")}><Select value={v.system_type} options={TYPES.map((o) => ({ value: o.value, label: tx(o.label) }))} onChange={(e) => setType(e.target.value)} /></Field>
            <Field label={t("Environment")}><Select value={v.environment} options={ENVIRONMENTS.map((o) => ({ value: o.value, label: tx(o.label) }))} onChange={(e) => set("environment", e.target.value)} /></Field>
            {rfc ? (
              <>
                <Field label={t("Host")} hint={tx(HINT.host)} error={err("host")}><Input value={v.host} placeholder="sap-ecc.example.invalid" onChange={(e) => set("host", e.target.value)} /></Field>
                <Field label={t("Client")} hint={tx(HINT.client)} error={err("client")}><Input value={v.client} inputMode="numeric" placeholder="100" onChange={(e) => set("client", e.target.value)} /></Field>
                <Field label={t("Instance number")} hint={tx(HINT.sysnr)} error={err("sysnr")}><Input value={v.sysnr} inputMode="numeric" placeholder="00" onChange={(e) => set("sysnr", e.target.value)} /></Field>
                <Field label={t("User")} hint={tx(HINT.username)}><Input value={v.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} /></Field>
                <Field label={t("Password")} error={err("password")}><Input type="password" value={v.password} autoComplete="new-password" placeholder="********" onChange={(e) => set("password", e.target.value)} /></Field>
              </>
            ) : (
              <>
                {authOptions(type).length > 1 ? <Field label={t("Sign-in method")}><Select value={auth} options={authOptions(type).map((o) => ({ value: o.value, label: tx(o.label) }))} onChange={(e) => set("auth_type", e.target.value)} /></Field> : null}
                <Field label={t("Base URL")} hint={tx(HINT.base_url)} error={err("base_url")}><Input value={v.base_url} placeholder="https://tenant.example.invalid" onChange={(e) => set("base_url", e.target.value)} /></Field>
                {!basic && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors" || type === "concur" || type === "ariba") ? (
                  <Field label={t("Token URL")} hint={tx(TOKEN_HINT[type] ?? HINT.token_url)} error={err("token_url")}><Input value={v.token_url} placeholder="https://auth.example.invalid/oauth/token" onChange={(e) => set("token_url", e.target.value)} /></Field>
                ) : null}
                {type === "successfactors" || type === "ariba" ? (
                  <Field label={type === "ariba" ? t("Realm") : t("Company ID")} hint={tx(type === "ariba" ? HINT.realm : HINT.company_id)} error={err("company_id")}><Input value={v.company_id} onChange={(e) => set("company_id", e.target.value)} /></Field>
                ) : null}
                {basic ? (
                  <>
                    <Field label={t("User")} hint={tx(HINT.basic_username)} error={err("username")}><Input value={v.username} autoComplete="off" onChange={(e) => set("username", e.target.value)} /></Field>
                    <Field label={t("Password")} error={err("password")}><Input type="password" value={v.password} autoComplete="new-password" placeholder="********" onChange={(e) => set("password", e.target.value)} /></Field>
                  </>
                ) : (
                  <>
                    <Field label={t("Client ID")} hint={tx(HINT.client_id)} error={err("client_id")}><Input value={v.client_id} autoComplete="off" onChange={(e) => set("client_id", e.target.value)} /></Field>
                    <Field label={t("Client secret")} error={err("client_secret")}><Input type="password" value={v.client_secret} autoComplete="new-password" placeholder="********" onChange={(e) => set("client_secret", e.target.value)} /></Field>
                  </>
                )}
                {type === "ariba" ? <Field label={t("API key")} hint={tx(HINT.api_key)} error={err("api_key")}><Input type="password" value={v.api_key} autoComplete="new-password" placeholder="********" onChange={(e) => set("api_key", e.target.value)} /></Field> : null}
              </>
            )}
            {result ? <p role="status" className="mx-muted">{result.ok ? t("Connected.") : t("Not connected.")} {result.message}</p> : null}
            <div className="mx-links">
              <Button variant="secondary" disabled={busy !== null} onClick={test}>{busy === "test" ? t("Testing") : t("Test connection")}</Button>
              <Button variant="primary" disabled={busy !== null} onClick={register}>{busy === "register" ? t("Connecting") : t("Connect system")}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === "packs" ? (
        <Card title={t("Choose policy packs")} sub={t("A pack turns on the rules a regulator or standard expects. You can change this later.")}>
          {packQ.isLoading ? <Skeleton lines={4} label={t("Loading policy packs")} /> : packQ.isError ? <ErrorState heading={t("Policy packs did not load")} retryLabel={t("Try again")} onRetry={() => void packQ.refetch()} /> : !packQ.data?.packs.length ? (
            <EmptyState heading={t("No policy packs")} body={t("This deployment has no packs to apply.")} />
          ) : (
            <div className="mx-links">{packQ.data.packs.map((p) => <Chip key={p.id} selected={packs.includes(p.id) || p.applied} onClick={() => setPacks((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}>{p.name}</Chip>)}</div>
          )}
          <div className="mx-links">
            <Button variant="primary" disabled={busy !== null} onClick={() => void run("packs", async () => { for (const id of packs) await applyPolicyPack(id); next("packs"); })}>{packs.length ? t("Apply and continue") : t("Continue")}</Button>
            <Button variant="secondary" onClick={() => next("packs")}>{t("Skip")}</Button>
          </div>
        </Card>
      ) : null}

      {step === "schedule" && created ? (
        <Card title={t("Schedule runs")} sub={t("Pick a domain and how often to read it.")}>
          <div className="mx-col">
            <Field label={t("Domain")}><Input value={domain} placeholder="material_master" onChange={(e) => setDomain(e.target.value)} /></Field>
            <Field label={t("Schedule")} error={cronError(cron)}><Select value={cron} options={PRESETS.filter((p) => p.value !== "custom").map((p) => ({ value: p.value, label: p.label }))} onChange={(e) => setCron(e.target.value)} /></Field>
            <div className="mx-links">{MODES.map((m) => <Chip key={m.value} selected={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</Chip>)}</div>
            <div className="mx-links">
              <Button variant="primary" disabled={busy !== null || !domain.trim() || Boolean(cronError(cron))} onClick={() => void run("sched", async () => { await createProfile(created.id, { system_id: created.id, domain: domain.trim(), tables: [], schedule_cron: cron, extraction_mode: mode }); next("schedule"); })}>{t("Add schedule")}</Button>
              <Button variant="secondary" onClick={() => next("schedule")}>{t("Skip")}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {step === "invite" ? (
        <Card title={t("Invite people")} sub={t("They get an email invitation with this system as their scope.")}>
          <div className="mx-col">
            <Field label={t("Email")}><Input type="email" value={email} placeholder={EMAIL_EG} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t("Role")}><Select value={role} options={VIEW_AS_ROLES.map((r) => ({ value: r, label: roleWord(r) }))} onChange={(e) => setRole(e.target.value)} /></Field>
            <div className="mx-links">
              <Button variant="primary" disabled={busy !== null || !email.includes("@")} onClick={() => void run("invite", async () => { await inviteUser({ email: email.trim(), grants: [{ role_key: role, system_id: created?.id ?? null }] }); toast(t("Invitation sent."), "good"); setEmail(""); })}>{t("Send invitation")}</Button>
              <Button variant="secondary" onClick={finish}>{t("Open the system")}</Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

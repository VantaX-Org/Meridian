"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Async, Button, ConfirmDialog, EmptyState, Field, Input, Mono, Notice, PageHeader, Skeleton, Switch, toast } from "@/design";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { SettingsSection, SettingsSheet } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import {
  getSsoConfig, removeSsoConfig, saveSsoConfig, testSsoConfig,
  type SsoConfig, type SsoConfigInput, type SsoTestResult,
} from "@/lib/api/sso";
import { queryKeys } from "@/lib/query-keys";
import { apiErrorMessage } from "@/lib/error";


interface FormState {
  issuer: string;
  clientId: string;
  secret: string;
  displayName: string;
  domains: string;
  enforce: boolean;
}

const EMPTY_FORM: FormState = { issuer: "", clientId: "", secret: "", displayName: "", domains: "", enforce: false };

const toForm = (c: SsoConfig): FormState => ({
  issuer: c.issuer, clientId: c.client_id, secret: "", displayName: c.display_name,
  domains: c.allowed_domains.join(", "), enforce: c.enforce,
});

/** "corp.com, Example.org" to ["corp.com", "example.org"]; the server validates each one. */
export function parseDomains(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

/** Sign-in settings: OpenID Connect single sign-on (write-only secret, domains, enforcement) and the fixed password rules. */
export default function AdminSignInPage() {
  const { can, loading } = useRole();
  const canManage = can("manage_users");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.ssoConfig(), queryFn: getSsoConfig, enabled: canManage && !loading });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadedFrom, setLoadedFrom] = useState<SsoConfig | null>(null);
  const [confirmEnforce, setConfirmEnforce] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testResult, setTestResult] = useState<SsoTestResult | null>(null);

  // Load the saved configuration into the form once per fetched document (the secret field always starts empty).
  const saved = q.data;
  if (saved && saved !== loadedFrom) {
    setLoadedFrom(saved);
    setForm(toForm(saved));
  }
  // An error shows once its field was typed in or left, never on a form nobody has touched.
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const touch = (...keys: (keyof FormState)[]) => setTouched((t) => (keys.every((k) => t[k]) ? t : { ...t, ...Object.fromEntries(keys.map((k) => [k, true])) }));
  const set = (patch: Partial<FormState>) => { touch(...(Object.keys(patch) as (keyof FormState)[])); setForm((f) => ({ ...f, ...patch })); };

  const input: SsoConfigInput = {
    issuer: form.issuer.trim(), client_id: form.clientId.trim(), display_name: form.displayName.trim(),
    allowed_domains: parseDomains(form.domains), default_role: "viewer", enforce: form.enforce,
    ...(form.secret.trim() ? { client_secret: form.secret.trim() } : {}),
  };
  const needsSecret = !saved?.has_secret || (!!saved && (saved.issuer !== input.issuer || saved.client_id !== input.client_id));
  const errors = {
    issuer: form.issuer.trim() ? undefined : "Enter the issuer address",
    clientId: form.clientId.trim() ? undefined : "Enter the client ID",
    secret: needsSecret && !form.secret.trim() ? (saved?.has_secret ? "Enter the secret again when the issuer or client ID changes" : "Enter the client secret") : undefined,
    displayName: form.displayName.trim() ? undefined : "Enter the name shown on the sign-in button",
  };
  const invalid = Object.values(errors).some(Boolean);
  // The secret's message explains an edit to a saved issuer or client ID, so it needs no touch first.
  const shown = (k: "issuer" | "clientId" | "secret" | "displayName") => (touched[k] || (k === "secret" && saved?.has_secret) ? errors[k] : undefined);
  /** What a disabled Save is waiting for, as a phrase ("the issuer address and the client secret"). */
  const missing = [
    errors.issuer && "the issuer address",
    errors.clientId && "the client ID",
    errors.secret && (saved?.has_secret ? "the client secret again" : "the client secret"),
    errors.displayName && "the display name",
  ].filter((m): m is string => Boolean(m));
  const missingText = missing.length < 2 ? missing.join("") : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;

  const save = useMutation({
    mutationFn: () => saveSsoConfig(input),
    onSuccess: (c) => {
      qc.setQueryData(queryKeys.ssoConfig(), c);
      setConfirmEnforce(false);
      setTestResult(null);
      toast("Sign-in settings saved");
    },
    onError: (e: unknown) => { setConfirmEnforce(false); toast.error(apiErrorMessage(e) || "The settings could not be saved"); },
  });
  const remove = useMutation({
    mutationFn: removeSsoConfig,
    onSuccess: (c) => {
      qc.setQueryData(queryKeys.ssoConfig(), c);
      setLoadedFrom(null);
      setConfirmRemove(false);
      setTestResult(null);
      toast("Single sign-on turned off");
    },
    onError: (e: unknown) => { setConfirmRemove(false); toast.error(apiErrorMessage(e) || "Single sign-on could not be turned off"); },
  });
  const test = useMutation({
    mutationFn: () => testSsoConfig(form.issuer.trim() || undefined),
    onSuccess: setTestResult,
    onError: (e: unknown) => setTestResult({ ok: false, message: apiErrorMessage(e) || "The test could not run" }),
  });

  if (loading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (!canManage) {
    return (
      <EmptyState title="Only administrators change sign-in" detail="Ask an administrator to set up single sign-on or review the sign-in rules." ghost="list"
        action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />} />
    );
  }

  // Requiring single sign-on is confirmed: it stops password sign-in for everyone except administrators.
  const onSave = () => {
    if (form.enforce && !saved?.enforce) setConfirmEnforce(true);
    else save.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader tabs={<SettingsTabs />} title="Sign-in" meta="How people prove who they are: your identity provider, and the rules for passwords" />
      <SettingsSheet>
        <SettingsSection title="Single sign-on" hint="OpenID Connect with your identity provider, such as Microsoft Entra ID or Okta. People who sign in for the first time get the Viewer role and no access grants; grant access under Roles and access.">
          <Async query={q} skeleton={240}>{(
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Issuer address" error={shown("issuer")}>
                  <Input type="url" inputMode="url" placeholder="https://login.example.com/tenant-id/v2.0" value={form.issuer} onChange={(e) => set({ issuer: e.target.value })} onBlur={() => touch("issuer")} />
                </Field>
                <Field label="Client ID" error={shown("clientId")}>
                  <Input value={form.clientId} onChange={(e) => set({ clientId: e.target.value })} onBlur={() => touch("clientId")} autoComplete="off" />
                </Field>
                <Field label="Client secret" error={shown("secret")}>
                  <Input type="password" autoComplete="new-password" value={form.secret} onChange={(e) => set({ secret: e.target.value })} onBlur={() => touch("secret")}
                    placeholder={saved?.has_secret ? "Stored. Leave blank to keep it" : ""} />
                </Field>
                <Field label="Display name" error={shown("displayName")}>
                  <Input value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} onBlur={() => touch("displayName")} placeholder="Company login" maxLength={60} />
                </Field>
              </div>
              <Field label="Allowed email domains">
                <Input value={form.domains} onChange={(e) => set({ domains: e.target.value })} placeholder="example.com, example.org" />
              </Field>
              <p className="m-text-meta m-ink-3">
                Only these domains can sign in, and link to an existing account by email. Leave it empty and nobody can. The secret is stored encrypted and is never shown again.
              </p>
              {saved?.redirect_uri ? (
                <p className="m-text-meta m-ink-3">Register this redirect address at your identity provider: <Mono inline>{saved.redirect_uri}</Mono></p>
              ) : null}
              <Switch checked={form.enforce} onCheckedChange={(v) => set({ enforce: v })} label="Require single sign-on" />
              <p className="m-text-meta m-ink-3">
                When on, password sign-in stops for everyone except administrators, who keep it as a way in if the provider is down.
              </p>
              {testResult ? <Notice tone={testResult.ok ? "success" : "danger"}>{testResult.message}</Notice> : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={invalid} pending={save.isPending} onClick={onSave}>Save sign-in settings</Button>
                <Button variant="secondary" pending={test.isPending} disabled={!form.issuer.trim()} onClick={() => test.mutate()}>Test sign-in</Button>
                {saved?.configured ? <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Turn off single sign-on</Button> : null}
              </div>
              {/* A disabled button says what it is waiting for. */}
              {invalid ? <p className="m-text-meta m-ink-3" data-testid="signin-missing">{`Save is off until you enter ${missingText}.`}{!form.issuer.trim() ? " Test sign-in needs the issuer address." : ""}</p> : null}
            </>
          )}</Async>
        </SettingsSection>

        <SettingsSection title="Password sign-in" hint="These rules are fixed and apply to every password account. They are not settings.">
          <dl className="grid grid-cols-[160px_1fr] gap-y-1 m-text-body">
            <dt className="m-ink-3">Password rules</dt>
            <dd>At least 12 characters, not the email name, and not a common password</dd>
            <dt className="m-ink-3">Lockout</dt>
            <dd>10 failed sign-ins lock the account for 15 minutes</dd>
          </dl>
        </SettingsSection>
      </SettingsSheet>

      <ConfirmDialog
        open={confirmEnforce}
        onOpenChange={setConfirmEnforce}
        title="Require single sign-on"
        tone="danger"
        body="Password sign-in will stop for everyone except administrators. People who cannot sign in through the identity provider will be locked out until an administrator changes this."
        confirmLabel="Require single sign-on"
        cancelLabel="Keep password sign-in"
        pending={save.isPending}
        onConfirm={() => save.mutate()}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Turn off single sign-on"
        tone="danger"
        body="The settings are removed. People who signed in through the identity provider keep their accounts and sign in with a password; those who never set one use Forgot password."
        confirmLabel="Turn off single sign-on"
        cancelLabel="Keep single sign-on"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

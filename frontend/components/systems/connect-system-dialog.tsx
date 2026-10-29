"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input, Notice, Select, toast } from "@/design";
import { registerSystem, testDraftConnection } from "@/lib/api/systems";
import { apiErrorMessage } from "@/lib/error";
import { useFormErrors } from "@/lib/forms";
import { queryKeys } from "@/lib/query-keys";
import type { SystemType } from "@/types/api";

import {
  TYPES,
  ENVIRONMENTS,
  environmentLabel,
  RFC_TYPES,
  NEEDS_TOKEN_URL,
  authOptions,
  defaultAuth,
  authFor,
  HINT,
  EMPTY,
  CONNECTION_KEYS,
  connectionKey,
  schemaFor,
  testBlockedHint,
  connectionOf,
  TOKEN_HINT,
  type ConnectionValues,
} from "@/lib/connection-form";
export {
  TYPES,
  ENVIRONMENTS,
  environmentLabel,
  RFC_TYPES,
  NEEDS_TOKEN_URL,
  authOptions,
  defaultAuth,
  authFor,
  HINT,
  EMPTY,
  CONNECTION_KEYS,
  connectionKey,
  schemaFor,
  testBlockedHint,
  connectionOf,
};
export type { ConnectionValues };

type Key = keyof ConnectionValues;

export const Hint = ({ text }: { text: string }) => <p className="m-text-meta m-ink-3 -mt-2">{text}</p>;
type Bind = (key: Key) => { value: string; onChange: (e: { target: { value: string } }) => void; onBlur?: () => void };

/**
 * The type-specific connection fields, shared by the connect dialog and the edit form. In the edit form
 * (`secretPlaceholder="Unchanged"`) the stored secrets are never shown and an empty one keeps the stored value.
 */
export function ConnectionFields({ v, bind, error, onAuthChange, secretPlaceholder }: {
  v: ConnectionValues;
  bind: Bind;
  error: (key: Key) => string | undefined;
  onAuthChange: (auth: string) => void;
  secretPlaceholder?: string;
}) {
  const type = v.system_type as SystemType;
  if (RFC_TYPES.includes(type)) {
    return (
      <>
        <Field label="Host" error={error("host")}><Input {...bind("host")} /></Field>
        <Hint text={HINT.host} />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-3">
            <Field label="Client" error={error("client")}><Input {...bind("client")} inputMode="numeric" maxLength={3} /></Field>
            <Hint text={HINT.client} />
          </div>
          <div className="flex flex-col gap-3">
            <Field label="Instance number" error={error("sysnr")}><Input {...bind("sysnr")} inputMode="numeric" maxLength={2} /></Field>
            <Hint text={HINT.sysnr} />
          </div>
        </div>
        <Field label="User (optional)"><Input {...bind("username")} autoComplete="off" /></Field>
        <Hint text={HINT.username} />
        <Field label="Password" error={error("password")}><Input {...bind("password")} type="password" autoComplete="new-password" placeholder={secretPlaceholder} /></Field>
      </>
    );
  }
  const options = authOptions(type);
  const auth = authFor(type, v.auth_type);
  const basic = auth === "basic";
  const tokenRequired = !basic && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors");
  return (
    <>
      {options.length > 1 ? (
        <Field label="Sign-in method"><Select value={auth} onValueChange={onAuthChange} options={options} /></Field>
      ) : null}
      <Field label="Base URL" error={error("base_url")}><Input {...bind("base_url")} type="url" placeholder="https://" /></Field>
      <Hint text={HINT.base_url} />
      {type === "successfactors" ? (
        <>
          <Field label="Company ID" error={error("company_id")}><Input {...bind("company_id")} /></Field>
          <Hint text={HINT.company_id} />
        </>
      ) : null}
      {type === "ariba" ? (
        <>
          <Field label="Realm" error={error("company_id")}><Input {...bind("company_id")} /></Field>
          <Hint text={HINT.realm} />
        </>
      ) : null}
      {basic ? (
        <>
          <Field label="User" error={error("username")}><Input {...bind("username")} autoComplete="off" /></Field>
          <Hint text={HINT.basic_username} />
          <Field label="Password" error={error("password")}><Input {...bind("password")} type="password" autoComplete="new-password" placeholder={secretPlaceholder} /></Field>
        </>
      ) : (
        <>
          <Field label={tokenRequired ? "Token URL" : "Token URL (optional)"} error={error("token_url")}><Input {...bind("token_url")} type="url" placeholder="https://" /></Field>
          <Hint text={TOKEN_HINT[type] ?? HINT.token_url} />
          <Field label="Client ID" error={error("client_id")}><Input {...bind("client_id")} autoComplete="off" placeholder={secretPlaceholder} /></Field>
          <Hint text={HINT.client_id} />
          <Field label="Client secret" error={error("client_secret")}><Input {...bind("client_secret")} type="password" autoComplete="new-password" placeholder={secretPlaceholder} /></Field>
          {type === "ariba" ? (
            <>
              <Field label="API key" error={error("api_key")}><Input {...bind("api_key")} type="password" autoComplete="new-password" placeholder={secretPlaceholder} /></Field>
              <Hint text={HINT.api_key} />
            </>
          ) : null}
        </>
      )}
    </>
  );
}

/** The last test's outcome, kept in the form: connected or not, the latency when the API gave one, and its message. */
export type TestOutcomeValue =
  | { connected: boolean; message?: string | null; latency_ms?: number | null }
  | { failed: string };

export function TestOutcome({ outcome, stale = false }: { outcome: TestOutcomeValue; stale?: boolean }) {
  if (stale) {
    return (
      <Notice tone="info" title="Test result out of date">
        A connection field changed after the last test. Test again to try the values as they are now.
      </Notice>
    );
  }
  if ("failed" in outcome) {
    return <Notice tone="danger" title="Test did not run">{outcome.failed}</Notice>;
  }
  const latency = outcome.latency_ms != null ? `${outcome.latency_ms.toLocaleString()} ms` : null;
  return (
    <Notice tone={outcome.connected ? "success" : "danger"} title={outcome.connected ? "Connected" : "Not connected"}>
      {[latency, outcome.message].filter(Boolean).join(". ") || null}
    </Notice>
  );
}

/** Connect an SAP system: registers it with its credentials (stored encrypted by the API, never shown again). */
export function ConnectSystemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [v, setV] = useState<ConnectionValues>(EMPTY);
  const [outcome, setOutcome] = useState<TestOutcomeValue | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const type = v.system_type as SystemType;
  const auth = authFor(type, v.auth_type);
  const schema = useMemo(() => schemaFor(type, auth), [type, auth]);
  const form = useFormErrors(schema, v);
  // A field change ends the shown test result: it no longer describes these values.
  const update = (patch: Partial<ConnectionValues>) => { setV((cur) => ({ ...cur, ...patch })); setOutcome(null); setSaveError(null); };
  const bind: Bind = (key) => ({ value: v[key], onChange: (e) => update({ [key]: e.target.value }), onBlur: () => form.blur(key) });
  const blocked = testBlockedHint(form.errors, type);

  const body = (): Parameters<typeof registerSystem>[0] => {
    const { connection, credentials } = connectionOf(v);
    return { name: v.name.trim(), system_type: type, environment: v.environment, ...connection, credentials };
  };
  // Test before save: the draft is tried against SAP without being stored.
  const test = useMutation({
    mutationFn: () => testDraftConnection(body()),
    onMutate: () => setOutcome(null),
    onSuccess: (r) => setOutcome(r),
    onError: (e) => setOutcome({ failed: apiErrorMessage(e) }),
  });
  const m = useMutation({
    mutationFn: () => registerSystem(body()),
    onMutate: () => setSaveError(null),
    onSuccess: (system) => {
      toast.success(`${system.name} connected`);
      void qc.invalidateQueries({ queryKey: queryKeys.systems() });
      void qc.invalidateQueries({ queryKey: queryKeys.configLandscape() });
      setV(EMPTY);
      setOutcome(null);
      onOpenChange(false);
      // The next step is on the new system: its health tab shows the first check and what to extract.
      router.push(`/systems/${system.id}?tab=health`);
    },
    onError: (e) => setSaveError(apiErrorMessage(e)),
  });
  const untested = form.valid && !test.isPending && !(outcome && "connected" in outcome && outcome.connected);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Connect a system">
      <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (form.valid) m.mutate(); }}>
        <Field label="Name" error={form.error("name")}><Input {...bind("name")} placeholder="ECC Production" /></Field>
        <Field label="Type">
          <Select value={v.system_type} onValueChange={(t) => update({ system_type: t, auth_type: defaultAuth(t as SystemType) })} options={TYPES} />
        </Field>
        <Field label="Environment"><Select value={v.environment} onValueChange={(t) => update({ environment: t })} options={ENVIRONMENTS} /></Field>
        <ConnectionFields v={v} bind={bind} error={form.error} onAuthChange={(a) => update({ auth_type: a })} />
        {outcome ? <TestOutcome outcome={outcome} /> : null}
        {saveError ? <Notice tone="danger" title="Not saved">{saveError}</Notice> : null}
        {untested && !outcome ? (
          <p className="m-text-meta m-ink-3">{"Not tested yet. You can connect now and test it later from the system's page."}</p>
        ) : null}
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Button type="button" variant="secondary" pending={test.isPending} disabled={blocked !== null} onClick={() => test.mutate()}>Test connection</Button>
            <Button type="submit" pending={m.isPending} disabled={!form.valid}>Connect system</Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Not now</Button>
          </div>
          {blocked ? <p className="m-text-meta m-ink-3">{blocked}</p> : null}
        </div>
      </form>
    </Dialog>
  );
}

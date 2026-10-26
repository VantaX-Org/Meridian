"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button, Dialog, Field, Input, Notice, Select, toast } from "@/design";
import { registerSystem, testDraftConnection } from "@/lib/api/systems";
import { apiErrorMessage } from "@/lib/error";
import { length, oneOf, pattern, required, url, useFormErrors, type FormErrors, type Rule, type Schema } from "@/lib/forms";
import { queryKeys } from "@/lib/query-keys";
import type { SystemType } from "@/types/api";

export const TYPES: { value: SystemType; label: string }[] = [
  { value: "ecc", label: "SAP ECC" },
  { value: "s4hana_onprem", label: "S/4HANA on premise" },
  { value: "ewm", label: "Extended Warehouse Management" },
  { value: "s4hana_cloud", label: "S/4HANA Cloud" },
  { value: "successfactors", label: "SuccessFactors" },
  { value: "concur", label: "Concur" },
  { value: "ariba", label: "Ariba" },
  { value: "btp", label: "BTP" },
];
export const ENVIRONMENTS = [{ value: "PRD", label: "Production" }, { value: "QAS", label: "Quality" }, { value: "DEV", label: "Development" }];
export const environmentLabel = (v: string) => ENVIRONMENTS.find((e) => e.value === v)?.label ?? v;
export const RFC_TYPES: readonly SystemType[] = ["ecc", "s4hana_onprem", "ewm"];
/** Cloud types whose OAuth flow has no default token endpoint (sap/s4hana_cloud.py, sap/btp.py, sap/ariba.py). */
export const NEEDS_TOKEN_URL: readonly SystemType[] = ["s4hana_cloud", "btp", "ariba"];

/**
 * The auth types each cloud connector accepts (sap/*.py `connect`): SuccessFactors takes Basic
 * (user@company ID and password) or OAuth client credentials; every other cloud type is OAuth only,
 * Ariba with an API key beside it. RFC systems are always "rfc".
 */
const OAUTH = { value: "oauth2_client_credentials", label: "OAuth client credentials" };
const BASIC = { value: "basic", label: "User and password" };
export function authOptions(type: SystemType): { value: string; label: string }[] {
  if (RFC_TYPES.includes(type)) return [{ value: "rfc", label: "RFC user and password" }];
  return type === "successfactors" ? [OAUTH, BASIC] : [OAUTH];
}
export const defaultAuth = (type: SystemType): string => authOptions(type)[0]!.value;
/** The stored auth type when this type accepts it, else the type's default. */
export const authFor = (type: SystemType, stored: string | null | undefined): string =>
  authOptions(type).some((o) => o.value === stored) ? (stored as string) : defaultAuth(type);

/** One line under each SAP field, the same in the connect dialog and the edit form. */
export const HINT = {
  host: "Host name or IP of the application server, for example sap-ecc.internal",
  client: "3 digits, for example 100",
  sysnr: "2 digits, for example 00",
  username: "Leave empty to use the deployment's default RFC user",
  basic_username: "The API user; Meridian signs in as user@company ID",
  base_url: "The tenant's API root, for example https://my123456.s4hana.cloud.sap",
  token_url: "The XSUAA /oauth/token endpoint",
  company_id: "The SuccessFactors company ID",
  realm: "The Ariba realm, for example mycompany-T",
  client_id: "OAuth client ID from the service key",
  api_key: "The application key from the Ariba developer portal",
};
const TOKEN_HINT: Partial<Record<SystemType, string>> = {
  successfactors: "The SuccessFactors /oauth/token endpoint",
  concur: "Leave empty to use Concur's default token endpoint",
  ariba: "The Ariba OAuth endpoint, for example https://api.ariba.com/v2/oauth/token",
};
export const Hint = ({ text }: { text: string }) => <p className="m-text-meta m-ink-3 -mt-2">{text}</p>;

export const EMPTY = {
  name: "", system_type: "ecc", environment: "DEV", auth_type: "rfc",
  host: "", client: "", sysnr: "", username: "", password: "",
  base_url: "", token_url: "", company_id: "", client_id: "", client_secret: "", api_key: "",
};
export type ConnectionValues = typeof EMPTY;
type Key = keyof ConnectionValues;

/** The fields a connection test reads; a change to any of them makes an earlier test result stale. */
export const CONNECTION_KEYS: readonly Key[] = [
  "system_type", "auth_type", "host", "client", "sysnr", "username", "password",
  "base_url", "token_url", "company_id", "client_id", "client_secret", "api_key",
];
export const connectionKey = (v: ConnectionValues): string => JSON.stringify(CONNECTION_KEYS.map((k) => v[k].trim()));

/** How each field is named in the "to test, complete ..." hint. */
const FIELD_NAMES: Partial<Record<Key, string>> = {
  host: "the host", client: "the client", sysnr: "the instance number", username: "the user", password: "the password",
  base_url: "the base URL", token_url: "the token URL", company_id: "the company ID", client_id: "the client ID", client_secret: "the client secret", api_key: "the API key",
};

/**
 * Validation by connection kind: RFC systems need host, client, instance and password; cloud systems a base URL and
 * the secrets of their auth type. `secretsOptional` (the edit form) lets a secret stay empty: the stored one is kept.
 */
export function schemaFor(type: SystemType, auth: string, { secretsOptional = false } = {}): Schema<ConnectionValues> {
  const secret = (message: string): Rule | undefined => (secretsOptional ? undefined : required(message));
  const common: Schema<ConnectionValues> = {
    name: [required("Enter a system name"), length(1, 100, "Use up to 100 characters")],
    system_type: oneOf(TYPES.map((t) => t.value)),
    environment: oneOf(ENVIRONMENTS.map((e) => e.value)),
  };
  if (RFC_TYPES.includes(type)) {
    return {
      ...common,
      host: [required("Enter the host name"), length(1, 255)],
      client: [required("Enter the 3-digit client"), pattern(/^\d{3}$/, "Enter a 3-digit client")],
      sysnr: [required("Enter the 2-digit instance number"), pattern(/^\d{2}$/, "Enter a 2-digit instance number")],
      password: secret("Enter the password"),
    };
  }
  const basic = auth === "basic";
  return {
    ...common,
    auth_type: oneOf(authOptions(type).map((o) => o.value)),
    base_url: [required("Enter the base URL"), url()],
    token_url: !basic && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors") ? [required("Enter the token URL"), url()] : url(),
    company_id: type === "successfactors" ? required("Enter the company ID") : type === "ariba" ? required("Enter the realm") : undefined,
    ...(basic
      ? { username: required("Enter the user"), password: secret("Enter the password") }
      : { client_id: secret("Enter the client ID"), client_secret: secret("Enter the client secret") }),
    ...(type === "ariba" ? { api_key: secret("Enter the API key") } : {}),
  };
}

/** Why Test connection is disabled, as one line: the connection fields still missing or invalid. Null when it can run. */
export function testBlockedHint(errors: FormErrors<ConnectionValues>, type: SystemType): string | null {
  const name = (k: Key) => (k === "company_id" && type === "ariba" ? "the realm" : FIELD_NAMES[k] ?? k);
  const missing = CONNECTION_KEYS.filter((k) => errors[k]).map(name);
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `To test, complete ${list}`;
}

/** The connection part of a register, update or test body, with only the secrets that were typed. */
export function connectionOf(v: ConnectionValues): {
  connection: { host?: string; client?: string; sysnr?: string; username?: string; base_url?: string; token_url?: string; company_id?: string; auth_type: string };
  credentials: Record<string, string>;
} {
  const type = v.system_type as SystemType;
  const typed = (keys: readonly Key[]) => Object.fromEntries(keys.filter((k) => v[k]).map((k) => [k, v[k]]));
  const username = v.username.trim();
  if (RFC_TYPES.includes(type)) {
    return {
      connection: { host: v.host.trim(), client: v.client.trim(), sysnr: v.sysnr.trim(), auth_type: "rfc", ...(username ? { username } : {}) },
      credentials: typed(["password"]),
    };
  }
  const auth = authFor(type, v.auth_type);
  const basic = auth === "basic";
  return {
    connection: {
      base_url: v.base_url.trim(), auth_type: auth,
      ...(v.token_url.trim() ? { token_url: v.token_url.trim() } : {}),
      ...(v.company_id.trim() ? { company_id: v.company_id.trim() } : {}),
      ...(basic && username ? { username } : {}),
    },
    credentials: typed(basic ? ["password"] : type === "ariba" ? ["client_id", "client_secret", "api_key"] : ["client_id", "client_secret"]),
  };
}

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

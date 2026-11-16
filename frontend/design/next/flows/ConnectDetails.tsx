"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { apiErrorMessage } from "@/lib/error";
import { useFormErrors } from "@/lib/forms";
import {
  connectionKey, connectionOf, ENVIRONMENTS, EMPTY, HINT, NEEDS_TOKEN_URL, RFC_TYPES, schemaFor, testBlockedHint, TOKEN_HINT, TYPES,
  type ConnectionValues, type Key,
} from "@/lib/connection-form";
import type { SystemType, TestConnectionResponse } from "@/types/api";
import { registerSystem, testDraftConnection, type ConnectionBody } from "@/lib/api/v2/sys";
import { useV2Session } from "@/lib/v2/hooks";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { Button, Chip } from "@/design/next/kit";
import { t, tx } from "@/lib/v2/i18n";
import "@/design/next/shell/connect-native.css";

/** The only sign-in this form offers. A password-based method (RFC user and password, SuccessFactors basic) is never sent from here. */
const OAUTH = "oauth2_client_credentials";
/** Cloud types sign in with OAuth client credentials (Ariba adds an API key). RFC types need a password on the server, so an administrator sets them up. */
export const CLOUD_TYPES = TYPES.filter((x) => !RFC_TYPES.includes(x.value));
const isCloud = (type: SystemType) => !RFC_TYPES.includes(type);

type Outcome = { connected: boolean; message: string; latency: number | null } | { failed: string };
const asOutcome = (r: TestConnectionResponse): Outcome => ({ connected: r.connected, message: r.message ?? "", latency: (r as { latency_ms?: number | null }).latency_ms ?? null });

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  const described = [hint ? `${id}-h` : "", error ? `${id}-e` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="nx-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, ...(error ? { "aria-invalid": true as const } : {}), "aria-describedby": described })}
      {hint ? <span id={`${id}-h`} className="nx-note">{hint}</span> : null}
      {error ? <span id={`${id}-e`} className="nx-cd-err">{error}</span> : null}
    </div>
  );
}

function TestOutcomeLine({ outcome, stale }: { outcome: Outcome; stale: boolean }) {
  if (stale) return <p className="nx-note" role="status">{t("A connection field changed after the last test. Test again to try the values as they are now.")}</p>;
  if ("failed" in outcome) {
    return <p role="status" data-testid="test-outcome"><Chip tone="bad">{t("Test did not run")}</Chip> <span>{outcome.failed}</span></p>;
  }
  return (
    <p role="status" data-testid="test-outcome">
      <Chip tone={outcome.connected ? "good" : "bad"}>{outcome.connected ? t("Connected") : t("Not connected")}</Chip>{" "}
      <span>{[outcome.latency != null ? t("{latency} ms", { latency: outcome.latency }) : null, outcome.message].filter(Boolean).join(". ")}</span>
    </p>
  );
}

/**
 * Connect a new system: name, type, environment, base URL and OAuth client credentials. Same contract as the v2 ConnectionForm
 * (POST /systems/test-connection to test, POST /systems to save, then `onSaved`). No password is ever asked for or sent.
 */
export function ConnectDetails({ initialType, saveLabel, onSaved }: { initialType?: SystemType; saveLabel?: string; onSaved?: (s: { id: string; name: string }) => void | Promise<void> }) {
  const { can } = useV2Session();
  const allowed = can("manage_systems");
  const refresh = useRefreshV2();
  const asked = initialType ?? "s4hana_cloud";
  const [v, setV] = useState<ConnectionValues>(() => ({ ...EMPTY, system_type: isCloud(asked) ? asked : "s4hana_cloud", environment: "DEV", auth_type: OAUTH }));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ value: Outcome; key: string } | null>(null);
  const type = v.system_type as SystemType;
  const schema = useMemo(() => schemaFor(type, OAUTH), [type]);
  const form = useFormErrors(schema, v);
  const key = connectionKey(v);
  const set = (k: Key) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const err = (k: Key) => { const m = form.error(k); return m ? tx(m) : undefined; };
  const tokenRequired = NEEDS_TOKEN_URL.includes(type) || type === "successfactors";
  const blocked = testBlockedHint(form.errors, type);

  /** The register or test body. Any password key is stripped, whatever the values hold. */
  const body = (): ConnectionBody => {
    const { connection, credentials } = connectionOf({ ...v, auth_type: OAUTH, password: "", username: "" });
    const { password: _drop, ...safe } = credentials;
    void _drop;
    return { name: v.name.trim(), system_type: type, environment: v.environment, ...connection, credentials: safe };
  };

  const test = async () => {
    if (!allowed || blocked) return;
    const sent = key;
    setTesting(true);
    try {
      const r = await testDraftConnection(body());
      setOutcome({ value: asOutcome(r), key: sent });
    } catch (e) {
      setOutcome({ value: { failed: apiErrorMessage(e) }, key: sent });
    } finally {
      setTesting(false);
      refresh();
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    form.touchAll();
    if (!form.valid || !allowed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const d = description.trim();
      const s = await registerSystem({ ...body(), ...(d ? { description: d } : {}) });
      refresh();
      await onSaved?.({ id: s.id, name: s.name });
    } catch (x) {
      setError(apiErrorMessage(x));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="nx-cd" aria-label={t("Connect a system")} data-testid="connection-form" onSubmit={submit} noValidate>
      {!allowed ? <p className="nx-note" role="note">{t("Changing a connection needs the manage systems permission. You can read the settings; nothing here is sent.")}</p> : null}
      {initialType && !isCloud(initialType) ? (
        <p className="nx-note" role="note" data-testid="rfc-notice">
          {t("{type} signs in with an SAP user and password. Meridian does not send passwords from this screen, so an administrator connects it on the server. You can connect a cloud system here.", { type: tx(TYPES.find((x) => x.value === initialType)?.label ?? initialType) })}
        </p>
      ) : null}
      <fieldset className="nx-fieldset" disabled={!allowed}>
        <Field label={t("Name")} error={err("name")}>
          {(p) => <input {...p} className="nx-input" value={v.name} onChange={set("name")} onBlur={() => form.blur("name")} placeholder={t("ECC production")} />}
        </Field>
        <Field label={t("System type")}>
          {(p) => (
            <select {...p} className="nx-input" value={type} onChange={(e) => { setV((x) => ({ ...x, system_type: e.target.value, auth_type: OAUTH })); }}>
              {CLOUD_TYPES.map((x) => <option key={x.value} value={x.value}>{tx(x.label)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Environment")}>
          {(p) => (
            <select {...p} className="nx-input" value={v.environment} onChange={set("environment")}>
              {ENVIRONMENTS.map((x) => <option key={x.value} value={x.value}>{tx(x.label)}</option>)}
            </select>
          )}
        </Field>
        <Field label={t("Description")}>
          {(p) => <input {...p} className="nx-input" value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </fieldset>
      <fieldset className="nx-fieldset" disabled={!allowed}>
        <legend>{t("Connection")}</legend>
        <p className="nx-note">{t("OAuth client credentials")}</p>
        <Field label={t("Base URL")} hint={tx(HINT.base_url)} error={err("base_url")}>
          {(p) => <input {...p} className="nx-input" type="url" value={v.base_url} onChange={set("base_url")} onBlur={() => form.blur("base_url")} placeholder="https://" />}
        </Field>
        {type === "successfactors" || type === "ariba" ? (
          <Field label={type === "ariba" ? t("Realm") : t("Company ID")} hint={tx(type === "ariba" ? HINT.realm : HINT.company_id)} error={err("company_id")}>
            {(p) => <input {...p} className="nx-input" value={v.company_id} onChange={set("company_id")} onBlur={() => form.blur("company_id")} />}
          </Field>
        ) : null}
        <Field label={tokenRequired ? t("Token URL") : t("Token URL (optional)")} hint={tx(TOKEN_HINT[type] ?? HINT.token_url)} error={err("token_url")}>
          {(p) => <input {...p} className="nx-input" type="url" value={v.token_url} onChange={set("token_url")} onBlur={() => form.blur("token_url")} placeholder="https://" />}
        </Field>
      </fieldset>
      <fieldset className="nx-fieldset" disabled={!allowed}>
        <legend>{t("Sign-in secrets")}</legend>
        <Field label={t("Client ID")} hint={tx(HINT.client_id)} error={err("client_id")}>
          {(p) => <input {...p} className="nx-input" autoComplete="off" value={v.client_id} onChange={set("client_id")} onBlur={() => form.blur("client_id")} />}
        </Field>
        <Field label={t("Client secret")} error={err("client_secret")}>
          {(p) => <input {...p} className="nx-input" type="password" autoComplete="new-password" value={v.client_secret} onChange={set("client_secret")} onBlur={() => form.blur("client_secret")} />}
        </Field>
        {type === "ariba" ? (
          <Field label={t("API key")} hint={tx(HINT.api_key)} error={err("api_key")}>
            {(p) => <input {...p} className="nx-input" type="password" autoComplete="new-password" value={v.api_key} onChange={set("api_key")} onBlur={() => form.blur("api_key")} />}
          </Field>
        ) : null}
      </fieldset>
      {outcome ? <TestOutcomeLine outcome={outcome.value} stale={outcome.key !== key} /> : null}
      {error ? <p role="alert" className="nx-cd-err">{error}</p> : null}
      <div className="nx-cn-acts">
        <Button variant="secondary" loading={testing} loadingLabel={t("Testing…")} disabled={!allowed || !!blocked} reason={blocked ? tx(blocked) : undefined} onClick={() => void test()}>
          {t("Test connection")}
        </Button>
        <Button variant="primary" type="submit" loading={saving} loadingLabel={t("Saving…")} disabled={!allowed}>
          {saveLabel ?? t("Connect system")}
        </Button>
      </div>
      <p className="nx-note">{t("You can connect now and test later. Nothing is read from SAP until you extract.")}</p>
    </form>
  );
}

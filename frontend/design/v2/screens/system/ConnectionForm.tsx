"use client";

import { useMemo, useState, type FormEvent } from "react";
import { apiErrorMessage } from "@/lib/error";
import { useFormErrors } from "@/lib/forms";
import {
  authFor, authOptions, connectionKey, connectionOf, defaultAuth, ENVIRONMENTS, EMPTY, HINT, NEEDS_TOKEN_URL, RFC_TYPES, schemaFor, testBlockedHint, TOKEN_HINT, TYPES,
  type ConnectionValues,
} from "@/lib/connection-form";
import type { SAPSystemExtended, SystemType, TestConnectionResponse } from "@/types/api";
import { deleteSystem, registerSystem, testDraftConnection, testEditedConnection, updateSystem, type ConnectionBody } from "@/lib/api/v2/sys";
import { useV2Session } from "@/lib/v2/hooks";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { ConfirmBar, Field, Gate } from "../../forms";
import { VerdictMark } from "../../marks";

/** The edit form's values from the stored system. Stored secrets are never shown, so they start empty. */
export const editValues = (s: SAPSystemExtended): ConnectionValues => ({
  name: s.name, system_type: s.system_type, environment: s.environment, auth_type: authFor(s.system_type, s.auth_type),
  host: s.host ?? "", client: s.client ?? "", sysnr: s.sysnr ?? "", username: s.username ?? "", password: "",
  base_url: s.base_url ?? "", token_url: s.token_url ?? "", company_id: s.company_id ?? "", client_id: "", client_secret: "", api_key: "",
});

type Outcome = { connected: boolean; message: string; latency: number | null } | { failed: string };

function TestOutcomeLine({ outcome, stale }: { outcome: Outcome; stale: boolean }) {
  if (stale) return <p className="m2-note" role="status">A connection field changed after the last test. Test again to try the values as they are now.</p>;
  if ("failed" in outcome) {
    return (
      <p className="m2-result" role="status" data-tone="fail" data-testid="test-outcome">
        <span className="m2-result-t"><VerdictMark verdict="no-go" />Test did not run</span>
        <span>{outcome.failed}</span>
      </p>
    );
  }
  return (
    <p className="m2-result" role="status" data-tone={outcome.connected ? "ok" : "fail"} data-testid="test-outcome">
      <span className="m2-result-t"><VerdictMark verdict={outcome.connected ? "go" : "no-go"} />{outcome.connected ? "Connected" : "Not connected"}</span>
      <span>{[outcome.latency != null ? `${outcome.latency} ms` : null, outcome.message].filter(Boolean).join(". ")}</span>
    </p>
  );
}

const asOutcome = (r: TestConnectionResponse): Outcome => ({ connected: r.connected, message: r.message ?? "", latency: (r as { latency_ms?: number | null }).latency_ms ?? null });

/**
 * Connect a system (no `system`) or edit one: name, environment, role and target, host or base URL, client, sign-in,
 * credentials, Test connection, rotate credentials and remove. Secrets are never shown; an empty secret keeps the
 * stored one. Needs manage_systems; without it the form says so and nothing is sent.
 */
export function ConnectionForm({ system, onSaved, onRemoved }: { system?: SAPSystemExtended; onSaved?: (s: { id: string; name: string }) => void; onRemoved?: () => void }) {
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const others = useSystemsExtended().data ?? [];
  const allowed = can("manage_systems");
  const [v, setV] = useState<ConnectionValues>(() => (system ? editValues(system) : EMPTY));
  const [description, setDescription] = useState(system?.description ?? "");
  const [active, setActive] = useState(system?.is_active ?? true);
  const [role, setRole] = useState<"source" | "target">(system?.role ?? "source");
  const [target, setTarget] = useState(system?.target_system_id ?? "none");
  const [outcome, setOutcome] = useState<{ value: Outcome; key: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [typed, setTyped] = useState("");

  const type = v.system_type as SystemType;
  const rfc = RFC_TYPES.includes(type);
  const auth = authFor(type, v.auth_type);
  const schema = useMemo(() => schemaFor(type, auth, { secretsOptional: Boolean(system) }), [type, auth, system]);
  const form = useFormErrors(schema, v);
  const key = connectionKey(v);
  const blocked = testBlockedHint(form.errors, type);
  const set = (patch: Partial<ConnectionValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setDone(null);
  };
  const bind = (k: keyof ConnectionValues) => ({ value: v[k], onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value }), onBlur: () => form.blur(k) });

  const body = (): ConnectionBody => {
    const { connection, credentials } = connectionOf(v);
    const extra = system ? { username: v.username.trim(), ...(rfc ? {} : { token_url: v.token_url.trim() }) } : {};
    return { name: v.name.trim(), system_type: type, environment: v.environment, ...connection, ...extra, credentials };
  };
  const run = async (what: string, fn: () => Promise<void>) => {
    setPending(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setPending(null);
    }
  };

  const test = () =>
    void run("test", async () => {
      const sent = key;
      try {
        const r = system ? await testEditedConnection(system.id, body()) : await testDraftConnection(body());
        setOutcome({ value: asOutcome(r), key: sent });
      } catch (e) {
        setOutcome({ value: { failed: apiErrorMessage(e) }, key: sent });
      }
      refresh();
    });
  const save = (e: FormEvent) => {
    e.preventDefault();
    form.touchAll();
    if (!form.valid || !allowed) return;
    void run("save", async () => {
      if (system) {
        const { connection, credentials } = connectionOf(v);
        const saved = await updateSystem(system.id, {
          name: v.name.trim(), environment: v.environment, description, is_active: active, role,
          ...(role === "source" ? { target_system_id: target === "none" ? "" : target } : {}),
          ...connection, username: v.username.trim(), ...(rfc ? {} : { token_url: v.token_url.trim() }),
          ...(Object.keys(credentials).length ? { credentials } : {}),
        });
        setDone(`${saved.name} is saved.`);
        refresh();
        onSaved?.({ id: saved.id, name: saved.name });
      } else {
        const saved = await registerSystem({ ...body(), ...(description ? { description } : {}) });
        refresh();
        onSaved?.({ id: saved.id, name: saved.name });
      }
    });
  };
  const rotate = () =>
    void run("rotate", async () => {
      if (!system) return;
      const { credentials } = connectionOf(v);
      if (Object.keys(credentials).length === 0) {
        setError("Type the new secret first. An empty field keeps the stored one.");
        return;
      }
      await updateSystem(system.id, { credentials });
      setV((cur) => ({ ...cur, password: "", client_id: "", client_secret: "", api_key: "" }));
      setDone("Credentials replaced. Test the connection to confirm they work.");
      refresh();
    });
  const remove = () =>
    void run("remove", async () => {
      if (!system) return;
      await deleteSystem(system.id);
      refresh();
      onRemoved?.();
    });

  const secretHint = system ? "Leave empty to keep the stored value" : undefined;
  const tokenRequired = !rfc && auth !== "basic" && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors");

  return (
    <form className="m2-form6" noValidate onSubmit={save} aria-label={system ? `Connection settings of ${system.name}` : "Connect a system"} data-testid="connection-form">
      {!allowed ? <Gate>Changing a connection needs the manage systems permission. You can read the settings; nothing here is sent.</Gate> : null}
      <fieldset disabled={!allowed} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "var(--m2-s3)", minWidth: 0 }}>
        <Field label="Name" error={form.error("name")}>
          {(p) => <input {...p} {...bind("name")} placeholder="ECC production" />}
        </Field>
        {!system ? (
          <Field label="System type">
            {(p) => (
              <select {...p} value={v.system_type} onChange={(e) => set({ system_type: e.target.value, auth_type: defaultAuth(e.target.value as SystemType) })}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <div className="m2-grid2">
          <Field label="Environment">
            {(p) => (
              <select {...p} value={v.environment} onChange={(e) => set({ environment: e.target.value })}>
                {ENVIRONMENTS.map((x) => (
                  <option key={x.value} value={x.value}>{x.label}</option>
                ))}
              </select>
            )}
          </Field>
          {system ? (
            <Field label="Role">
              {(p) => (
                <select {...p} value={role} onChange={(e) => setRole(e.target.value === "target" ? "target" : "source")}>
                  <option value="source">Source</option>
                  <option value="target">Target</option>
                </select>
              )}
            </Field>
          ) : null}
        </div>
        {system && role === "source" ? (
          <Field label="Target system" hint="The configuration is compared with this system. None compares with the SAP standard baseline.">
            {(p) => (
              <select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="none">None (SAP standard baseline)</option>
                {others.filter((o) => o.id !== system.id).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field label="Description">{(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        {system ? (
          <label className="m2-chk">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        ) : null}

        <fieldset>
          <legend>Connection</legend>
          {rfc ? (
            <>
              <Field label="Host" hint={HINT.host} error={form.error("host")}>{(p) => <input {...p} {...bind("host")} />}</Field>
              <div className="m2-grid2">
                <Field label="Client" hint={HINT.client} error={form.error("client")}>{(p) => <input {...p} {...bind("client")} inputMode="numeric" maxLength={3} />}</Field>
                <Field label="Instance number" hint={HINT.sysnr} error={form.error("sysnr")}>{(p) => <input {...p} {...bind("sysnr")} inputMode="numeric" maxLength={2} />}</Field>
              </div>
              <Field label="User (optional)" hint={HINT.username}>{(p) => <input {...p} {...bind("username")} autoComplete="off" />}</Field>
            </>
          ) : (
            <>
              {authOptions(type).length > 1 ? (
                <Field label="Sign-in method">
                  {(p) => (
                    <select {...p} value={auth} onChange={(e) => set({ auth_type: e.target.value })}>
                      {authOptions(type).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : null}
              <Field label="Base URL" hint={HINT.base_url} error={form.error("base_url")}>{(p) => <input {...p} {...bind("base_url")} type="url" placeholder="https://" />}</Field>
              {type === "successfactors" ? <Field label="Company ID" hint={HINT.company_id} error={form.error("company_id")}>{(p) => <input {...p} {...bind("company_id")} />}</Field> : null}
              {type === "ariba" ? <Field label="Realm" hint={HINT.realm} error={form.error("company_id")}>{(p) => <input {...p} {...bind("company_id")} />}</Field> : null}
              {auth === "basic" ? <Field label="User" hint={HINT.basic_username} error={form.error("username")}>{(p) => <input {...p} {...bind("username")} autoComplete="off" />}</Field> : null}
              {auth !== "basic" ? (
                <Field label={tokenRequired ? "Token URL" : "Token URL (optional)"} hint={TOKEN_HINT[type] ?? HINT.token_url} error={form.error("token_url")}>
                  {(p) => <input {...p} {...bind("token_url")} type="url" placeholder="https://" />}
                </Field>
              ) : null}
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>{system ? "Credentials" : "Sign-in secrets"}</legend>
          {system ? <p className="m2-note">Stored secrets are never shown. Type new values to replace them; an empty field keeps the stored one.</p> : null}
          {rfc || auth === "basic" ? (
            <Field label="Password" hint={secretHint} error={form.error("password")}>{(p) => <input {...p} {...bind("password")} type="password" autoComplete="new-password" />}</Field>
          ) : (
            <>
              <Field label="Client ID" hint={secretHint ?? HINT.client_id} error={form.error("client_id")}>{(p) => <input {...p} {...bind("client_id")} autoComplete="off" />}</Field>
              <Field label="Client secret" hint={secretHint} error={form.error("client_secret")}>{(p) => <input {...p} {...bind("client_secret")} type="password" autoComplete="new-password" />}</Field>
              {type === "ariba" ? <Field label="API key" hint={secretHint ?? HINT.api_key} error={form.error("api_key")}>{(p) => <input {...p} {...bind("api_key")} type="password" autoComplete="new-password" />}</Field> : null}
            </>
          )}
          {system ? (
            <div className="m2-acts">
              <button type="button" className="m2-btn" disabled={!allowed || pending !== null} onClick={rotate}>
                {pending === "rotate" ? "Replacing…" : "Rotate credentials"}
              </button>
            </div>
          ) : null}
        </fieldset>
      </fieldset>

      {outcome ? <TestOutcomeLine outcome={outcome.value} stale={outcome.key !== key} /> : null}
      {error ? <p className="m2-ferr" role="alert">{error}</p> : null}
      {done ? <p className="m2-note" role="status">{done}</p> : null}
      {blocked && allowed ? <p className="m2-fhint">{blocked}</p> : null}
      <div className="m2-acts">
        <button type="button" className="m2-btn" disabled={!allowed || blocked !== null || pending !== null} onClick={test}>
          {pending === "test" ? "Testing…" : "Test connection"}
        </button>
        <button type="submit" className="m2-btn m2-strong" disabled={!allowed || pending !== null}>
          {pending === "save" ? "Saving…" : system ? "Save changes" : "Connect system"}
        </button>
        {system && allowed ? (
          <button type="button" className="m2-btn m2-ghost" aria-expanded={removing} onClick={() => setRemoving((x) => !x)}>
            Remove system
          </button>
        ) : null}
      </div>
      {!system ? <p className="m2-fhint">You can connect now and test later. Nothing is read from SAP until you extract.</p> : null}
      {removing && system ? (
        <>
          <Field label={`Type ${system.name} to confirm`}>{(p) => <input {...p} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}</Field>
          <ConfirmBar
            message="Its credentials and schedules go with it. Extracted runs and findings stay."
            confirmLabel="Remove system"
            pending={pending === "remove"}
            disabled={typed !== system.name}
            onConfirm={remove}
            onCancel={() => {
              setRemoving(false);
              setTyped("");
            }}
          />
        </>
      ) : null}
    </form>
  );
}

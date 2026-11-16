"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, labelOf, systemTypeLabel } from "@/lib/format";
import { useFormErrors } from "@/lib/forms";
import {
  authFor, authOptions, connectionKey, connectionOf, ENVIRONMENTS, HINT, NEEDS_TOKEN_URL, pathsFor, READ_FUNCTIONS, RFC_TYPES, schemaFor, SNC_QOPS, testBlockedHint, TOKEN_HINT,
  type ConnectionValues,
} from "@/lib/connection-form";
import type { SAPSystemExtended, SystemType, TestConnectionResponse } from "@/types/api";
import { deleteProfile, deleteSystem, testEditedConnection, updateProfile, updateSystem, type ConnectionBody, type SystemPatch } from "@/lib/api/v2/sys";
import { loadSystemConfig, retryJobById } from "@/lib/api/v2/runs";
import { AREA_STATUS_WORD, objectSource, objectText, SOURCE_WORD } from "@/lib/v2/config-text";
import { cronError, CUSTOM, describeCron, isPreset, MODES, PRESETS } from "@/lib/v2/cron";
import { useOpenItem, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { useSystemConfigLoad, useSystemProfiles, useSystemsExtended } from "@/lib/v2/runs-queries";
import { useConfigItems, useRefreshV2 } from "@/lib/v2/sys-queries";
import { describeTable } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { t, tx } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { ConnectDetails } from "@/design/next/flows/ConnectDetails";
import { Button, Chip, Code, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Field, Gate, Note, OutcomeLine, useOutcome } from "./objects-shared";

/* ---------------------------------------------------------------- connection */

/** The edit form's values from the stored system. Stored secrets are never shown, so they start empty. */
const editValues = (s: SAPSystemExtended): ConnectionValues => ({
  name: s.name, system_type: s.system_type, environment: s.environment, auth_type: authFor(s.system_type, s.auth_type),
  host: s.host ?? "", client: s.client ?? "", sysnr: s.sysnr ?? "", username: s.username ?? "", password: "",
  base_url: s.base_url ?? "", token_url: s.token_url ?? "", company_id: s.company_id ?? "", client_id: "", client_secret: "", api_key: "",
  extraction_path: s.extraction_path ?? "table_reader", read_function: s.read_function ?? "",
  saprouter: s.saprouter ?? "", snc_mode: s.snc_mode ? "1" : "", snc_partnername: s.snc_partnername ?? "", snc_qop: s.snc_qop ?? "", snc_myname: s.snc_myname ?? "",
});

/**
 * The secrets the form may send. A password is never sent from this screen: the key is dropped here, so every body,
 * test, save and rotate goes through one place that cannot carry it.
 */
export function safeCredentials(v: ConnectionValues): Record<string, string> {
  const { password: _drop, ...safe } = connectionOf(v).credentials;
  void _drop;
  return safe;
}

const PATH_LABEL: Record<string, () => string> = {
  table_reader: () => t("Table reader"),
  odp: () => t("ODP, table reader for the rest"),
  auto: () => t("Automatic: table reader"),
  odata: () => t("OData through the SAP Gateway"),
};
const PATH_HINT: Record<string, () => string> = {
  table_reader: () => t("Reads each table with the table reader below. Needs read access to the tables."),
  odp: () => t("Reads mapped tables through ODP providers (RODPS_REPL). Fields a provider does not carry are reported per table; other tables use the table reader."),
  auto: () => t("Reads with the table reader. ODP is used only when you choose it, after confirming with SAP that your licence allows it (SAP Note 3255746)."),
  odata: () => t("Reads through the released APIs your Gateway exposes, such as API_PRODUCT_SRV and API_BUSINESS_PARTNER, with this system's user."),
};
const QOP_LABEL: Record<string, () => string> = {
  "": () => t("SAP default"),
  "1": () => t("1: authentication only"),
  "2": () => t("2: integrity"),
  "3": () => t("3: privacy (encryption)"),
  "8": () => t("8: the system's default"),
  "9": () => t("9: maximum available"),
};
const READER_LABEL: Record<string, () => string> = {
  "": () => t("Deployment default"),
  RFC_READ_TABLE: () => "RFC_READ_TABLE", // i18n-ignore
  "/BODS/RFC_READ_TABLE2": () => "/BODS/RFC_READ_TABLE2", // i18n-ignore
  BBP_RFC_READ_TABLE: () => "BBP_RFC_READ_TABLE", // i18n-ignore
  auto: () => t("Find the first available"),
};

type TestResult = { connected: boolean; message: string; latency: number | null } | { failed: string };

const asResult = (r: TestConnectionResponse): TestResult => ({ connected: r.connected, message: r.message ?? "", latency: (r as { latency_ms?: number | null }).latency_ms ?? null });

function TestLine({ result, stale }: { result: TestResult; stale: boolean }) {
  if (stale) return <Note>{t("A connection field changed after the last test. Test again to try the values as they are now.")}</Note>;
  if ("failed" in result) {
    return (
      <div className="nx-ob-result" role="status" data-tone="fail" data-testid="test-outcome">
        <Chip tone="bad">{t("Test did not run")}</Chip>
        <span>{result.failed}</span>
      </div>
    );
  }
  return (
    <div className="nx-ob-result" role="status" data-tone={result.connected ? "ok" : "fail"} data-testid="test-outcome">
      <Chip tone={result.connected ? "good" : "bad"}>{result.connected ? t("Connected") : t("Not connected")}</Chip>
      <span>{[result.latency != null ? t("{latency} ms", { latency: result.latency }) : null, result.message].filter(Boolean).join(". ")}</span>
    </div>
  );
}

/** A stored system's connection: name, environment, role and target, host or base URL, sign-in, secrets, test, rotate and remove. */
function ConnectionEditor({ system, onSaved, onRemoved, saveLabel }: { system: SAPSystemExtended; onSaved?: () => void | Promise<void>; onRemoved: () => void; saveLabel?: string }) {
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const others = useSystemsExtended().data ?? [];
  const allowed = can("manage_systems");
  const [v, setV] = useState<ConnectionValues>(() => editValues(system));
  const [description, setDescription] = useState(system.description ?? "");
  const [active, setActive] = useState(system.is_active ?? true);
  const [role, setRole] = useState<"source" | "target">(system.role ?? "source");
  const [target, setTarget] = useState(system.target_system_id ?? "none");
  const [tested, setTested] = useState<{ value: TestResult; key: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const type = v.system_type as SystemType;
  const rfc = RFC_TYPES.includes(type);
  const auth = authFor(type, v.auth_type);
  const odataPath = type === "s4hana_onprem" && v.extraction_path === "odata";
  const snc = rfc && v.snc_mode === "1";
  const schema = useMemo(() => schemaFor(type, auth, { secretsOptional: true, odataPath, snc }), [type, auth, odataPath, snc]);
  const form = useFormErrors(schema, v);
  const key = connectionKey(v);
  const blocked = testBlockedHint(form.errors, type);
  const err = (k: keyof ConnectionValues) => {
    const m = form.error(k);
    return m ? tx(m) : undefined;
  };
  const set = (patch: Partial<ConnectionValues>) => {
    setV((cur) => ({ ...cur, ...patch }));
    setDone(null);
  };
  const bind = (k: keyof ConnectionValues) => ({ value: v[k], onChange: (e: { target: { value: string } }) => set({ [k]: e.target.value }), onBlur: () => form.blur(k) });

  const body = (): ConnectionBody => {
    const { connection } = connectionOf(v);
    return { name: v.name.trim(), system_type: type, environment: v.environment, ...connection, username: v.username.trim(), ...(rfc ? {} : { token_url: v.token_url.trim() }), credentials: safeCredentials(v) };
  };
  const go = async (what: string, fn: () => Promise<void>) => {
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
    void go("test", async () => {
      const sent = key;
      try {
        setTested({ value: asResult(await testEditedConnection(system.id, body())), key: sent });
      } catch (e) {
        setTested({ value: { failed: apiErrorMessage(e) }, key: sent });
      }
      refresh();
    });
  const save = (e: FormEvent) => {
    e.preventDefault();
    form.touchAll();
    if (!form.valid || !allowed) return;
    void go("save", async () => {
      const { connection } = connectionOf(v);
      const credentials = safeCredentials(v);
      const saved = await updateSystem(system.id, {
        name: v.name.trim(), environment: v.environment, description, is_active: active, role,
        ...(role === "source" ? { target_system_id: target === "none" ? "" : target } : {}),
        ...connection, username: v.username.trim(), ...(rfc ? { read_function: v.read_function as SystemPatch["read_function"] } : { token_url: v.token_url.trim() }),
        ...(Object.keys(credentials).length ? { credentials } : {}),
      });
      setDone(t("{name} is saved.", { name: saved.name }));
      refresh();
      await onSaved?.();
    });
  };
  const rotate = () =>
    void go("rotate", async () => {
      const credentials = safeCredentials(v);
      if (Object.keys(credentials).length === 0) {
        setError(t("Type the new secret first. An empty field keeps the stored one."));
        return;
      }
      await updateSystem(system.id, { credentials });
      setV((cur) => ({ ...cur, client_id: "", client_secret: "", api_key: "" }));
      setDone(t("Credentials replaced. Test the connection to confirm they work."));
      refresh();
    });
  const remove = () =>
    void go("remove", async () => {
      await deleteSystem(system.id);
      setRemoving(false);
      refresh();
      onRemoved();
    });

  const secretHint = t("Leave empty to keep the stored value");
  const tokenRequired = !rfc && auth !== "basic" && (NEEDS_TOKEN_URL.includes(type) || type === "successfactors");
  const passwordSystem = rfc || auth === "basic";

  return (
    <form className="nx-ob-form" noValidate onSubmit={save} aria-label={t("Connection settings of {name}", { name: system.name })} data-testid="connection-form">
      {!allowed ? <Gate>{t("Changing a connection needs the manage systems permission. You can read the settings; nothing here is sent.")}</Gate> : null}
      <fieldset disabled={!allowed} className="nx-ob-form">
        <Field label={t("Name")} error={err("name")}>
          {(p) => <input {...p} {...bind("name")} placeholder={t("ECC production")} />}
        </Field>
        <div className="nx-ob-grid">
          <Field label={t("Environment")}>
            {(p) => (
              <select {...p} value={v.environment} onChange={(e) => set({ environment: e.target.value })}>
                {ENVIRONMENTS.map((x) => (
                  <option key={x.value} value={x.value}>{tx(x.label)}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("Role")}>
            {(p) => (
              <select {...p} value={role} onChange={(e) => setRole(e.target.value === "target" ? "target" : "source")}>
                <option value="source">{t("Source")}</option>
                <option value="target">{t("Target")}</option>
              </select>
            )}
          </Field>
        </div>
        {role === "source" ? (
          <Field label={t("Target system")} hint={t("The configuration is compared with this system. None compares with the SAP standard baseline.")}>
            {(p) => (
              <select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="none">{t("None (SAP standard baseline)")}</option>
                {others.filter((o) => o.id !== system.id).map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field label={t("Description")}>{(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <label className="nx-ob-check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t("Active")}
        </label>

        <fieldset className="nx-ob-form">
          <legend>{t("Connection")}</legend>
          {rfc ? (
            <>
              <Field label={t("Host")} hint={tx(HINT.host)} error={err("host")}>{(p) => <input {...p} {...bind("host")} />}</Field>
              <div className="nx-ob-grid">
                <Field label={t("Client")} hint={tx(HINT.client)} error={err("client")}>{(p) => <input {...p} {...bind("client")} inputMode="numeric" maxLength={3} />}</Field>
                <Field label={t("Instance number")} hint={tx(HINT.sysnr)} error={err("sysnr")}>{(p) => <input {...p} {...bind("sysnr")} inputMode="numeric" maxLength={2} />}</Field>
              </div>
              <Field label={t("User (optional)")} hint={tx(HINT.username)}>{(p) => <input {...p} {...bind("username")} autoComplete="off" />}</Field>
              <Field label={t("SAProuter string (optional)")} hint={t("Only when SAP is reached through a SAProuter, for example /H/router.example.com/S/3299/H/. Leave empty for a direct connection.")} error={err("saprouter")}>
                {(p) => <input {...p} {...bind("saprouter")} autoComplete="off" spellCheck={false} data-testid="saprouter" />}
              </Field>
              <label className="nx-ob-check">
                <input type="checkbox" checked={snc} onChange={(e) => set({ snc_mode: e.target.checked ? "1" : "" })} data-testid="snc-mode" />
                {t("Secure Network Communications (SNC)")}
              </label>
              {snc ? (
                <>
                  <Field label={t("SNC partner name")} hint={t("The SAP system's SNC name, for example p:CN=ECC, O=Company, C=ZA. Your Basis team has it.")} error={err("snc_partnername")}>
                    {(p) => <input {...p} {...bind("snc_partnername")} autoComplete="off" spellCheck={false} data-testid="snc-partnername" />}
                  </Field>
                  <div className="nx-ob-grid">
                    <Field label={t("Protection level")} error={err("snc_qop")}>
                      {(p) => (
                        <select {...p} value={v.snc_qop} onChange={(e) => set({ snc_qop: e.target.value })} data-testid="snc-qop">
                          {SNC_QOPS.map((x) => (
                            <option key={x || "default"} value={x}>{QOP_LABEL[x]()}</option>
                          ))}
                        </select>
                      )}
                    </Field>
                    <Field label={t("Own SNC name (optional)")} hint={t("Leave empty to use the name of the server's SNC credential.")}>
                      {(p) => <input {...p} {...bind("snc_myname")} autoComplete="off" spellCheck={false} />}
                    </Field>
                  </div>
                  <Note>{t("The SNC library path is set on the server (SNC_LIB). It is not entered here.")}</Note>
                </>
              ) : null}
              <Field label={t("Extraction path")} hint={(PATH_HINT[v.extraction_path] ?? PATH_HINT.table_reader)()} error={err("extraction_path")}>
                {(p) => (
                  <select {...p} value={v.extraction_path} onChange={(e) => set({ extraction_path: e.target.value })} data-testid="extraction-path">
                    {pathsFor(type).map((x) => (
                      <option key={x} value={x}>{PATH_LABEL[x]()}</option>
                    ))}
                  </select>
                )}
              </Field>
              {v.extraction_path !== "odata" ? (
                <Field label={t("Table reader")} hint={t("The function that reads tables the extraction path does not cover. Agree it with your Basis team.")} error={err("read_function")}>
                  {(p) => (
                    <select {...p} value={v.read_function} onChange={(e) => set({ read_function: e.target.value })} data-testid="read-function">
                      {READ_FUNCTIONS.map((x) => (
                        <option key={x || "default"} value={x}>{READER_LABEL[x]()}</option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : (
                <Field label={t("Gateway base URL")} hint={t("The SAP Gateway of this system, for example https://s4host:44300. Meridian sends this system's client as sap-client.")} error={err("base_url")}>
                  {(p) => <input {...p} {...bind("base_url")} type="url" placeholder="https://" />}
                </Field>
              )}
            </>
          ) : (
            <>
              {authOptions(type).length > 1 ? (
                <Field label={t("Sign-in method")}>
                  {(p) => (
                    <select {...p} value={auth} onChange={(e) => set({ auth_type: e.target.value })}>
                      {authOptions(type).map((o) => (
                        <option key={o.value} value={o.value}>{tx(o.label)}</option>
                      ))}
                    </select>
                  )}
                </Field>
              ) : null}
              <Field label={t("Base URL")} hint={tx(HINT.base_url)} error={err("base_url")}>{(p) => <input {...p} {...bind("base_url")} type="url" placeholder="https://" />}</Field>
              {type === "successfactors" ? <Field label={t("Company ID")} hint={tx(HINT.company_id)} error={err("company_id")}>{(p) => <input {...p} {...bind("company_id")} />}</Field> : null}
              {type === "ariba" ? <Field label={t("Realm")} hint={tx(HINT.realm)} error={err("company_id")}>{(p) => <input {...p} {...bind("company_id")} />}</Field> : null}
              {auth === "basic" ? <Field label={t("User")} hint={tx(HINT.basic_username)} error={err("username")}>{(p) => <input {...p} {...bind("username")} autoComplete="off" />}</Field> : null}
              {auth !== "basic" ? (
                <Field label={tokenRequired ? t("Token URL") : t("Token URL (optional)")} hint={tx(TOKEN_HINT[type] ?? HINT.token_url)} error={err("token_url")}>
                  {(p) => <input {...p} {...bind("token_url")} type="url" placeholder="https://" />}
                </Field>
              ) : null}
            </>
          )}
        </fieldset>

        <fieldset className="nx-ob-form">
          <legend>{t("Credentials")}</legend>
          {passwordSystem ? (
            <Note testId="password-note">{t("The password is set on the server by an administrator. Meridian does not send passwords from this screen.")}</Note>
          ) : (
            <>
              <Note>{t("Stored secrets are never shown. Type new values to replace them; an empty field keeps the stored one.")}</Note>
              <Field label={t("Client ID")} hint={secretHint} error={err("client_id")}>{(p) => <input {...p} {...bind("client_id")} autoComplete="off" />}</Field>
              <Field label={t("Client secret")} hint={secretHint} error={err("client_secret")}>{(p) => <input {...p} {...bind("client_secret")} type="password" autoComplete="new-password" />}</Field>
              {type === "ariba" ? <Field label={t("API key")} hint={secretHint} error={err("api_key")}>{(p) => <input {...p} {...bind("api_key")} type="password" autoComplete="new-password" />}</Field> : null}
              <div className="nx-ib-acts">
                <Button variant="secondary" loading={pending === "rotate"} loadingLabel={t("Replacing…")} disabled={!allowed || pending !== null} onClick={rotate}>
                  {t("Rotate credentials")}
                </Button>
              </div>
            </>
          )}
        </fieldset>
      </fieldset>

      {tested ? <TestLine result={tested.value} stale={tested.key !== key} /> : null}
      {error ? <p className="nx-ob-err" role="alert">{error}</p> : null}
      {done ? <Note>{done}</Note> : null}
      {blocked && allowed ? <span className="nx-ob-hint">{tx(blocked)}</span> : null}
      <div className="nx-ib-acts">
        <Button variant="secondary" loading={pending === "test"} loadingLabel={t("Testing…")} disabled={!allowed || blocked !== null || pending !== null} onClick={test}>
          {t("Test connection")}
        </Button>
        <Button type="submit" variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={!allowed || pending !== null}>
          {saveLabel ?? t("Save changes")}
        </Button>
        {allowed ? (
          <Button variant="danger" onClick={() => setRemoving(true)}>
            {t("Remove system")}
          </Button>
        ) : null}
      </div>
      <Confirm
        open={removing}
        title={t("Remove system")}
        consequence={t("Its credentials and schedules go with it. Extracted runs and findings stay.")}
        confirmLabel={t("Remove system")}
        danger
        phrase={system.name}
        onConfirm={remove}
        onCancel={() => setRemoving(false)}
      />
    </form>
  );
}

/**
 * `?open=connection:<system id>` edits a system's connection; `?open=connection:new` connects a new one.
 * `?open=connection:<system id>:<job id>` comes from a job SAP refused the sign-in for: saving retries that job.
 */
export function ConnectionInspector({ id, onClose }: BodyProps) {
  const router = useRouter();
  const v2 = useV2Href();
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const systems = useSystemsExtended();
  const isNew = id === "new";
  const [systemId, retryJob] = id.split(":");
  const system = systems.data?.find((s) => s.id === systemId);
  const saveAndRetry = async () => {
    if (!retryJob) return;
    const r = await retryJobById(retryJob);
    void qc.invalidateQueries({ queryKey: ["v2"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
    if (r.job_id) openItem({ kind: "job", id: r.job_id });
  };
  return (
    <InspectorFrame
      title={isNew ? t("Connect a system") : system?.name ?? t("Connection")}
      status={isNew ? t("New system") : system ? t("{systemTypeLabel}, connection settings", { systemTypeLabel: systemTypeLabel(system.system_type) }) : undefined}
      onClose={onClose}
    >
      {isNew ? (
        <ConnectDetails onSaved={(s) => router.replace(v2(`/s/${s.id}?open=system:${s.id}`))} />
      ) : systems.isLoading ? (
        <Skeleton lines={5} />
      ) : systems.isError ? (
        <ErrorState sentence={t("The system could not be read.")} onRetry={() => void systems.refetch()} />
      ) : !system ? (
        <EmptyState heading={t("This system is not in the tenant. It may have been removed.")} />
      ) : (
        <>
          <p className="nx-ib-meta">
            <V2Link href={`/s/${system.id}`}>{t("Open the system")}</V2Link>
          </p>
          <ConnectionEditor key={system.id} system={system} onRemoved={() => router.replace(v2("/"))} {...(retryJob ? { onSaved: saveAndRetry, saveLabel: t("Save and retry the failed job") } : {})} />
        </>
      )}
    </InspectorFrame>
  );
}

/* ---------------------------------------------------------------- config */

function ConfigItems({ system, object, total }: { system: string; object: string; total: number }) {
  const q = useConfigItems(system, object);
  if (q.isLoading) return <Skeleton lines={3} />;
  if (q.isError) return <ErrorState sentence={t("The rows of this object could not be read. They are stored with the last completed load.")} onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <EmptyState heading={t("The last completed load stored no rows for this object.")} />;
  const cols = [...new Set(items.flatMap((i) => Object.keys(i.values)))].slice(0, 5);
  return (
    <>
      {total > items.length ? <Note testId="config-items-cap">{t("The first {n} of {total}", { n: int(items.length), total: int(total) })}</Note> : null}
      <div className="nx-ob-scroll" tabIndex={0} role="region" aria-label={t("Rows, scrollable")}>
        <table className="nx-ob-table" aria-label={t("Rows of {object}", { object })} data-testid="config-items">
          <thead>
            <tr>
              <th scope="col">{t("Key")}</th>
              {cols.map((c) => (
                <th key={c} scope="col"><Code code={c} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.key}>
                <th scope="row"><Code code={i.key} /></th>
                {cols.map((c) => (
                  <td key={c}>{i.values[c] == null ? <Dash /> : String(i.values[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ConfigBody({ system, area }: { system: string; area: string }) {
  const q = useSystemConfigLoad(system);
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [picked, setPicked] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton lines={5} />;
  if (q.isError) return <ErrorState sentence={t("The configuration could not be read.")} onRetry={() => void q.refetch()} />;
  const a = q.data?.areas.find((x) => x.area === area);
  if (!a) return <EmptyState heading={t("This system has no configuration area with that name. Load the configuration to read the areas.")} />;
  const history = new Map((q.data?.objects ?? []).map((o) => [o.object, o.history]));
  const load = () =>
    void run("load", async () => {
      const r = await loadSystemConfig(system);
      refresh();
      return { tone: "ok", title: t("Configuration load started"), detail: t("Every area is read again."), job: r.job_id };
    });
  return (
    <>
      <Facts>
        <Fact label={t("Status")}>{AREA_STATUS_WORD[a.status] ?? labelOf(a.status)}</Fact>
        <Fact label={t("Objects read")}>{t("{tables_done} of {tables_total}", { tables_done: a.tables_done, tables_total: a.tables_total })}</Fact>
        <Fact label={t("Loaded")}>{q.data?.finished_at ? formatDate(q.data.finished_at, "datetime") : <Dash />}</Fact>
      </Facts>
      <section className="nx-ib-sec">
        <h3>{t("Objects")}</h3>
        <div className="nx-ob-scroll" tabIndex={0} role="region" aria-label={t("Table 1, scrollable")}>
          <table className="nx-ob-table" data-testid="area-objects">
            <thead>
              <tr>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Source")}</th>
                <th scope="col" className="nx-ob-num">{t("Rows")}</th>
                <th scope="col">{t("Last change")}</th>
              </tr>
            </thead>
            <tbody>
              {a.objects.map((o) => {
                const h = history.get(o.object);
                const readable = o.state === "loaded" && o.rows > 0;
                const code = <Code code={o.object} text={o.label || undefined} />;
                return (
                  <tr key={o.object}>
                    <th scope="row">
                      {readable ? (
                        <button type="button" className="nx-btn nx-btn-quiet" aria-pressed={picked === o.object} onClick={() => setPicked(picked === o.object ? null : o.object)}>
                          {code}
                        </button>
                      ) : (
                        code
                      )}
                      {o.state !== "loaded" ? <span className="nx-ob-hint" style={{ display: "block" }}>{objectText(o)}</span> : null}
                    </th>
                    <td>{SOURCE_WORD[objectSource(o.state)]}</td>
                    <td className="nx-ob-num">{int(o.rows)}</td>
                    <td>{h?.last_change ? `${h.last_change}${h.changes_in_window ? t(", {changes_in_window} in the window", { changes_in_window: h.changes_in_window }) : ""}` : <Dash />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {picked ? (
        <section className="nx-ib-sec">
          <h3>{t("Rows of {picked}", { picked })}</h3>
          <ConfigItems system={system} object={picked} total={a.objects.find((o) => o.object === picked)?.rows ?? 0} />
        </section>
      ) : (
        <Note>{t("Choose an object with rows to read them, as stored by the last completed load.")}</Note>
      )}
      <Actions>
        <Button variant="secondary" loading={pending === "load"} loadingLabel={t("Starting…")} disabled={!can("trigger_sync") || pending !== null} onClick={load}>
          {t("Load configuration again")}
        </Button>
        <V2Link href={`/s/${system}?tab=configuration&part=compare`} className="nx-btn nx-btn-secondary">{t("Compare with the target")}</V2Link>
      </Actions>
      {!can("trigger_sync") ? <Gate>{t("Loading the configuration needs the trigger sync permission.")}</Gate> : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </>
  );
}

/** `?open=config:<system>:<area>`: one configuration area, the objects behind it, where each came from, and their rows. */
export function ConfigInspector({ id, onClose }: BodyProps) {
  const at = id.indexOf(":");
  const system = at > 0 ? id.slice(0, at) : "";
  const area = at > 0 ? id.slice(at + 1) : "";
  const q = useSystemConfigLoad(system, Boolean(system));
  const label = q.data?.areas.find((x) => x.area === area)?.label;
  return (
    <InspectorFrame title={label ?? labelOf(area) ?? t("Configuration area")} status={t("Configuration area")} onClose={onClose}>
      {system && area ? <ConfigBody system={system} area={area} /> : <EmptyState heading={t("This address does not name a configuration area.")} />}
    </InspectorFrame>
  );
}

/* ---------------------------------------------------------------- schedule */

interface ScheduleValue {
  cron: string;
  mode: "full" | "delta";
}

const scheduleValid = (v: ScheduleValue): boolean => !cronError(v.cron);

function ScheduleFields({ value, onChange }: { value: ScheduleValue; onChange: (v: ScheduleValue) => void }) {
  const [custom, setCustom] = useState(() => !isPreset(value.cron));
  const error = custom && value.cron.trim() ? cronError(value.cron) : custom ? t("Enter five fields: minute, hour, day, month, weekday") : undefined;
  return (
    <>
      <Field label={t("Schedule")} hint={t("Times are UTC; a due run starts within 5 minutes.")}>
        {(p) => (
          <select
            {...p}
            value={custom ? CUSTOM : value.cron}
            onChange={(e) => {
              if (e.target.value === CUSTOM) setCustom(true);
              else {
                setCustom(false);
                onChange({ ...value, cron: e.target.value });
              }
            }}
          >
            {PRESETS.map((x) => (
              <option key={x.value} value={x.value}>{x.label}</option>
            ))}
          </select>
        )}
      </Field>
      {custom ? (
        <Field label={t("Cron expression")} error={error ? tx(error) : undefined} hint={t("Minute hour day month weekday")}>
          {(p) => <input {...p} className="nx-ob-mono" value={value.cron} onChange={(e) => onChange({ ...value, cron: e.target.value })} placeholder="0 2 * * 1" />}
        </Field>
      ) : null}
      <Field label={t("Mode")} hint={t("Changes only reads the records SAP changed since the last download, with a full download at least once a week.")}>
        {(p) => (
          <select {...p} value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value === "delta" ? "delta" : "full" })}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

function ScheduleBody({ system, profileId, onClose }: { system: string; profileId: string; onClose: () => void }) {
  const q = useSystemProfiles(system);
  const { can } = useV2Session();
  const allowed = can("manage_systems");
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const p = q.data?.find((x) => x.id === profileId);
  const [edit, setEdit] = useState<ScheduleValue | null>(null);
  const [removing, setRemoving] = useState(false);
  if (q.isLoading) return <Skeleton lines={5} />;
  if (q.isError) return <ErrorState sentence={t("The schedule could not be read.")} onRetry={() => void q.refetch()} />;
  if (!p) return <EmptyState heading={t("This schedule is not on the system any more. It may have been deleted.")} />;
  const value: ScheduleValue = edit ?? { cron: p.schedule_cron ?? "0 2 * * 1", mode: p.extraction_mode ?? "full" };
  const dirty = edit !== null && (edit.cron !== (p.schedule_cron ?? "") || edit.mode !== p.extraction_mode);

  const save = () =>
    void run("save", async () => {
      const saved = await updateProfile(system, p.id, { schedule_cron: value.cron.trim(), extraction_mode: value.mode });
      setEdit(null);
      refresh();
      return { tone: "ok", title: t("Schedule saved"), detail: `${describeCron(saved.schedule_cron)}${saved.next_run_at ? t(", next run {next_run_at}", { next_run_at: formatDate(saved.next_run_at, "datetime") }) : ""}.` };
    });
  const toggle = () =>
    void run("toggle", async () => {
      const saved = await updateProfile(system, p.id, { active: !p.active });
      refresh();
      return { tone: "ok", title: saved.active ? t("Schedule resumed") : t("Schedule paused") };
    });
  const remove = () =>
    void run("remove", async () => {
      setRemoving(false);
      await deleteProfile(system, p.id);
      refresh();
      onClose();
      return { tone: "ok", title: t("Schedule deleted") };
    });

  return (
    <>
      <Facts>
        <Fact label={t("Object")}>{labelOf(p.domain)}</Fact>
        <Fact label={t("Schedule")}>{describeCron(p.schedule_cron)}</Fact>
        <Fact label={t("Mode")}>{p.extraction_mode === "delta" ? t("Changes only") : t("Full")}</Fact>
        <Fact label={t("State")}>{p.active ? t("On") : t("Paused")}</Fact>
        <Fact label={t("Next run")}>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : <Dash />}</Fact>
        <Fact label={t("Last run")}>{p.last_run_at ? formatDate(p.last_run_at, "datetime") : <Dash />}</Fact>
        <Fact label={t("Tables")}>
          {p.tables.length ? (
            <span className="nx-ob-pick">
              {p.tables.map((tb) => (
                <Code key={tb} code={tb} text={describeTable(tb) ?? undefined} />
              ))}
            </span>
          ) : (
            <Dash />
          )}
        </Fact>
      </Facts>
      {allowed ? (
        <>
          <section className="nx-ib-sec">
            <h3>{t("Change the schedule")}</h3>
            <form
              className="nx-ob-form"
              aria-label={t("Change the schedule")}
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty && scheduleValid(value)) save();
              }}
            >
              <ScheduleFields value={value} onChange={setEdit} />
              <div className="nx-ib-acts">
                <Button type="submit" variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={!dirty || !scheduleValid(value) || pending !== null}>
                  {t("Save schedule")}
                </Button>
              </div>
            </form>
          </section>
          <Actions>
            <Button variant="secondary" disabled={pending !== null} onClick={toggle}>
              {p.active ? t("Pause") : t("Resume")}
            </Button>
            <Button variant="danger" disabled={pending !== null} onClick={() => setRemoving(true)}>
              {t("Delete schedule")}
            </Button>
          </Actions>
          <Confirm
            open={removing}
            title={t("Delete schedule")}
            consequence={t("The object is no longer extracted on a schedule. Its extraction log goes with it; runs and findings already analysed stay.")}
            confirmLabel={t("Delete schedule")}
            danger
            onConfirm={remove}
            onCancel={() => setRemoving(false)}
          />
        </>
      ) : (
        <Gate>{t("Changing, pausing and deleting a schedule needs the manage systems permission.")}</Gate>
      )}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
      <p className="nx-ib-meta">
        <V2Link href={`/s/${system}?tab=schedules`}>{t("All schedules of the system")}</V2Link>
      </p>
    </>
  );
}

/** `?open=syncschedule:<system>:<profile>`: one extraction schedule, its timetable and mode, pause, resume and delete. */
export function ScheduleInspector({ id, onClose }: BodyProps) {
  const at = id.indexOf(":");
  const system = at > 0 ? id.slice(0, at) : "";
  const profile = at > 0 ? id.slice(at + 1) : "";
  return (
    <InspectorFrame title={t("Schedule")} status={t("Extraction schedule")} onClose={onClose}>
      {system && profile ? <ScheduleBody system={system} profileId={profile} onClose={onClose} /> : <EmptyState heading={t("This address does not name a schedule.")} />}
    </InspectorFrame>
  );
}

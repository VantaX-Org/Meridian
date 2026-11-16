"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mono, V2Link } from "@/design/v2/parts";
import * as api from "@/lib/api/v2/admin";
import type { QualityThresholds } from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLlmConfig, getLlmProviders, putLlmAggregatesOnly, putLlmConfig, testLlm, type LlmBody, type LlmConfig, type LlmProvider } from "@/lib/api/v2/llm";
import { MAX_WINDOWS, getMaintenance, putMaintenance, type MaintenanceWindow } from "@/lib/api/v2/maintenance";
import { enterSandbox, exitSandbox } from "@/lib/api/v2/step10";
import { formatDate, formatModuleName } from "@/lib/format";
import { refreshAdmin, useQualityThresholds } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { refreshStep10, useSandbox } from "@/lib/v2/step10-queries";
import { bandsFor } from "@/lib/v2/thresholds";
import { Button, Confirm } from "../kit";
import { Block, Field, Kv, Loaded, OutcomeNote, Status, Switch, useCan, useOutcome, useUnsaved } from "./tenant-kit";

/* Sandbox mode */

/** Rows per table in words: "1 analysis_versions, 794 findings". */
const rowsWords = (m: Record<string, number>): string =>
  Object.entries(m)
    .map(([k, v]) => `${int(v)} ${k}`)
    .join(", ");

/** Copy the latest run into a sandbox and decide on it with nothing leaving the deployment. Entering and exiting need manage_system. */
export function SandboxBlock() {
  const qc = useQueryClient();
  const can = useCan()("manage_system");
  const q = useSandbox();
  const [asking, setAsking] = useState<"enter" | "exit" | null>(null);
  const { outcome, pending, run } = useOutcome("sandbox");
  return (
    <Block id="sandbox" title={t("Sandbox mode")} hint={t("A copy of the latest run to decide on, to rehearse or to train people, with nothing leaving the deployment: notifications, webhooks, digests, report mailouts and SAP write-backs are held back and logged.")}>
      <Loaded q={q} what={t("The sandbox state")} rows={2}>
        {(s) => (
          <>
            <Kv
              rows={[
                [t("State"), <Status key="s" tone={s.sandbox ? "at-risk" : "neutral"}>{s.sandbox ? t("In sandbox") : t("Off")}</Status>],
                [t("Since"), s.since ? (s.by ? t("{when}, by {who}", { when: formatDate(s.since, "datetime"), who: s.by }) : formatDate(s.since, "datetime")) : "—"],
                [
                  t("Runs copied"),
                  s.runs.length ? (
                    <span key="r">
                      {s.runs.map((r, n) => (
                        <span key={r}>
                          {n > 0 ? ", " : ""}
                          <V2Link href={`/run/${r}`}>
                            <Mono>{r.slice(0, 12)}</Mono>
                          </V2Link>
                        </span>
                      ))}
                    </span>
                  ) : (
                    t("None")
                  ),
                ],
                [t("Deliveries held back"), int(s.skipped_deliveries)],
              ]}
            />
            <OutcomeNote outcome={outcome} />
            {can ? (
              <div className="nx-tn-actions">
                <Button variant={s.sandbox ? "danger" : "primary"} role="switch" aria-checked={s.sandbox} disabled={pending !== null} loading={pending !== null} loadingLabel={t("Working…")} onClick={() => setAsking(s.sandbox ? "exit" : "enter")}>
                  {s.sandbox ? t("Exit sandbox mode") : t("Enter sandbox mode")}
                </Button>
              </div>
            ) : (
              <p className="nx-sub">{t("Entering and exiting sandbox mode needs the manage system permission.")}</p>
            )}
            <Confirm
              open={asking === "enter"}
              title={t("Enter sandbox mode")}
              consequence={t("The latest finished run is copied into a sandbox run. Until you exit, decisions land on the copy only and nothing leaves this deployment. Decisions on the real run are refused.")}
              confirmLabel={t("Copy the latest run and enter")}
              onCancel={() => setAsking(null)}
              onConfirm={() => {
                if (pending) return;
                void run("enter", async () => {
                  const r = await enterSandbox(true);
                  setAsking(null);
                  await refreshStep10(qc, "sandbox");
                  return { tone: "ok", title: t("Sandbox mode is on"), detail: r.sandbox_run_id ? t("Copied run {run}: {rows}.", { run: r.sandbox_run_id.slice(0, 12), rows: rowsWords(r.copied) || t("no rows") }) : t("No finished run to copy: the flag alone is on.") };
                });
              }}
            />
            <Confirm
              open={asking === "exit"}
              title={t("Exit sandbox mode")}
              consequence={t("The sandbox runs and every decision made on them are discarded. Deliveries held back are not sent afterwards.")}
              confirmLabel={t("Discard the sandbox and exit")}
              danger
              onCancel={() => setAsking(null)}
              onConfirm={() => {
                if (pending) return;
                void run("exit", async () => {
                  const r = await exitSandbox();
                  setAsking(null);
                  await refreshStep10(qc, "sandbox");
                  return { tone: "ok", title: t("Sandbox mode is off"), detail: Object.keys(r.discarded).length ? t("Discarded: {rows}.", { rows: rowsWords(r.discarded) }) : undefined };
                });
              }}
            />
          </>
        )}
      </Loaded>
    </Block>
  );
}

/* Scheduled maintenance */

/** A row as typed: the times are datetime-local strings in the browser's zone. */
type Window = { title: string; start: string; end: string; detail: string };

const pad = (n: number) => String(n).padStart(2, "0");
const toLocal = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const windowOf = (w: MaintenanceWindow): Window => ({ title: w.title, start: toLocal(w.starts_at), end: toLocal(w.ends_at), detail: w.detail ?? "" });

/** The first problem with a row, in the words the backend uses, or null. */
function problem(d: Window): string | null {
  if (!d.title.trim()) return t("Give the window a title.");
  if (!d.start || !d.end) return t("Give a start and an end.");
  if (Date.parse(d.end) <= Date.parse(d.start)) return t("A maintenance window must end after it starts.");
  return null;
}

function windowState(w: MaintenanceWindow, now: number) {
  const s = Date.parse(w.starts_at);
  const e = Date.parse(w.ends_at);
  if (e <= now) return <Status tone="neutral">{t("Over")}</Status>;
  if (s <= now) return <Status tone="at-risk">{t("In progress")}</Status>;
  return <Status tone="neutral">{t("Scheduled")}</Status>;
}

function WindowsEditor({ initial }: { initial: MaintenanceWindow[] }) {
  const qc = useQueryClient();
  const f = useFixture();
  const [rows, setRows] = useState<Window[]>(() => initial.map(windowOf));
  const dirty = useUnsaved(rows);
  const { outcome, pending, run } = useOutcome("maintenance");
  const bad = rows.map(problem);
  const set = (i: number, p: Partial<Window>) => setRows(rows.map((r, n) => (n === i ? { ...r, ...p } : r)));
  return (
    <>
      {rows.length ? (
        <div className="nx-tn-split" role="group" aria-label={t("Maintenance windows")}>
          {rows.map((r, i) => (
            <fieldset key={i} className="nx-tn-fieldset">
              <div className="nx-tn-form">
                <Field label={t("Title")} error={bad[i]}>
                  <input className="nx-input" maxLength={120} aria-label={t("Title of window {n}", { n: i + 1 })} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
                </Field>
                <Field label={t("What users see")}>
                  <input className="nx-input" maxLength={500} aria-label={t("Detail of window {n}", { n: i + 1 })} value={r.detail} placeholder={t("Optional")} onChange={(e) => set(i, { detail: e.target.value })} />
                </Field>
                <Field label={t("Starts")}>
                  <input className="nx-input" type="datetime-local" aria-label={t("Start of window {n}", { n: i + 1 })} value={r.start} onChange={(e) => set(i, { start: e.target.value })} />
                </Field>
                <Field label={t("Ends")}>
                  <input className="nx-input" type="datetime-local" aria-label={t("End of window {n}", { n: i + 1 })} value={r.end} onChange={(e) => set(i, { end: e.target.value })} />
                </Field>
              </div>
              <div className="nx-tn-actions">
                <Button variant="quiet" size={32} onClick={() => setRows(rows.filter((_, n) => n !== i))}>
                  {t("Remove")}
                </Button>
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className="nx-sub">{t("No maintenance is scheduled. The public status page shows none.")}</p>
      )}
      <p className="nx-sub">{t("Times are in your time zone, {zone}. They are stored in UTC.", { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</p>
      <OutcomeNote outcome={outcome} />
      <div className="nx-tn-actions">
        <Button variant="quiet" disabled={rows.length >= MAX_WINDOWS} onClick={() => setRows([...rows, { title: "", start: "", end: "", detail: "" }])}>
          {t("Add a window")}
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || bad.some(Boolean) || pending !== null}
          loading={pending === "save"}
          loadingLabel={t("Saving…")}
          onClick={() =>
            void run("save", async () => {
              const saved = await putMaintenance(rows.map((r) => ({ title: r.title.trim(), starts_at: new Date(r.start).toISOString(), ends_at: new Date(r.end).toISOString(), detail: r.detail.trim() || null })));
              qc.setQueryData(["v2", "maintenance", f], saved);
              return { tone: "ok", title: t("Maintenance windows saved") };
            })
          }
        >
          {t("Save windows")}
        </Button>
      </div>
    </>
  );
}

/** The windows the public status page announces. Reading and changing them both need manage_settings, as the route does. */
export function MaintenanceBlock() {
  const write = useCan()("manage_settings");
  const f = useFixture();
  const q = useQuery({ queryKey: ["v2", "maintenance", f], queryFn: getMaintenance, enabled: write, retry: false });
  const [now] = useState(() => Date.now());
  if (!write) return null;
  return (
    <Block id="maintenance" title={t("Scheduled maintenance")} hint={t("Windows announced on the public status page before they start, and shown as in progress while they run.")}>
      <Loaded q={q} what={t("The maintenance windows")} rows={2}>
        {(m) => (
          <>
            {m.windows.length ? (
              <ul className="nx-tn-list" aria-label={t("Saved windows")}>
                {m.windows.map((w) => (
                  <li key={w.id ?? w.starts_at}>
                    {windowState(w, now)} {w.title}: {formatDate(w.starts_at, "datetime")} {t("to")} {formatDate(w.ends_at, "datetime")}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="nx-sub" data-testid="maint-none">
                {t("No maintenance window is scheduled.")}
              </p>
            )}
            <WindowsEditor key={JSON.stringify(m.windows)} initial={m.windows} />
          </>
        )}
      </Loaded>
    </Block>
  );
}

/* Language model */

type LlmDraft = Omit<LlmBody, "temperature" | "max_tokens" | "request_timeout"> & { temperature: string; max_tokens: string; request_timeout: string };

/** The key is never prefilled: a stored key shows only its last four characters in the hint. */
const llmDraftOf = (c: LlmConfig): LlmDraft => ({
  provider: c.provider,
  model: c.model,
  base_url: c.base_url,
  api_key: "",
  azure_deployment: c.azure_deployment,
  azure_api_version: c.azure_api_version,
  temperature: String(c.temperature),
  max_tokens: String(c.max_tokens),
  request_timeout: String(c.request_timeout),
});

function LlmEditor({ config, providers }: { config: LlmConfig; providers: Record<string, LlmProvider> }) {
  const qc = useQueryClient();
  const f = useFixture();
  const [d, setD] = useState<LlmDraft>(() => llmDraftOf(config));
  const dirty = useUnsaved(d);
  const { outcome, pending, run } = useOutcome("llm");
  const p = providers[d.provider];
  // A different provider keeps no key: the stored key belongs to the saved provider.
  const keyStored = config.has_api_key && d.provider === config.provider;
  const temp = Number(d.temperature);
  const tokens = Number(d.max_tokens);
  const timeout = Number(d.request_timeout);
  const errs = {
    key: p?.requires_api_key && !d.api_key && !keyStored ? t("{provider} needs an API key.", { provider: p.label }) : null,
    url: p?.requires_base_url && !d.base_url && !p.default_base_url ? t("{provider} needs a base URL.", { provider: p.label }) : null,
    temp: d.temperature.trim() !== "" && temp >= 0 && temp <= 2 ? null : t("Between 0 and 2"),
    tokens: Number.isInteger(tokens) && tokens >= 1 ? null : t("A whole number above 0"),
    timeout: Number.isInteger(timeout) && timeout >= 1 ? null : t("A whole number of seconds"),
  };
  const valid = !Object.values(errs).some(Boolean);
  const body = (): LlmBody => ({ ...d, model: d.model.trim(), base_url: d.base_url.trim(), temperature: temp, max_tokens: tokens, request_timeout: timeout });
  const pick = (provider: string) => {
    const n = providers[provider];
    setD({ ...d, provider, api_key: "", model: n?.default_model ?? "", base_url: n?.default_base_url ?? "" });
  };
  return (
    <>
      <div className="nx-tn-form">
        <Field label={t("Provider")}>
          <select className="nx-input" value={d.provider} onChange={(e) => pick(e.target.value)}>
            {Object.entries(providers).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Model")} hint={p ? t("Empty uses {model}.", { model: p.default_model }) : undefined}>
          <input className="nx-input nx-mono" value={d.model} placeholder={p?.default_model} onChange={(e) => setD({ ...d, model: e.target.value })} />
        </Field>
        {p?.requires_base_url || d.base_url ? (
          <Field label={t("Base URL")} error={errs.url}>
            <input className="nx-input nx-mono" type="url" value={d.base_url} placeholder={p?.default_base_url || "https://"} onChange={(e) => setD({ ...d, base_url: e.target.value })} />
          </Field>
        ) : null}
        {p?.requires_api_key || d.provider === "custom" ? (
          <Field label={t("API key")} error={errs.key} hint={keyStored ? t("A key ending {preview} is stored. Leave empty to keep it.", { preview: config.api_key_preview.slice(-4) }) : undefined}>
            <input className="nx-input" type="password" autoComplete="new-password" value={d.api_key} onChange={(e) => setD({ ...d, api_key: e.target.value })} />
          </Field>
        ) : null}
        {d.provider === "azure_openai" ? (
          <>
            <Field label={t("Azure deployment")}>
              <input className="nx-input nx-mono" value={d.azure_deployment} onChange={(e) => setD({ ...d, azure_deployment: e.target.value })} />
            </Field>
            <Field label={t("Azure API version")}>
              <input className="nx-input nx-mono" value={d.azure_api_version} onChange={(e) => setD({ ...d, azure_api_version: e.target.value })} />
            </Field>
          </>
        ) : null}
        <Field label={t("Temperature")} error={errs.temp} hint={t("0 gives the same answer each time.")}>
          <input className="nx-input" type="number" min={0} max={2} step={0.1} value={d.temperature} onChange={(e) => setD({ ...d, temperature: e.target.value })} />
        </Field>
        <Field label={t("Longest answer, tokens")} error={errs.tokens}>
          <input className="nx-input" type="number" min={1} value={d.max_tokens} onChange={(e) => setD({ ...d, max_tokens: e.target.value })} />
        </Field>
        <Field label={t("Time limit, seconds")} error={errs.timeout}>
          <input className="nx-input" type="number" min={1} value={d.request_timeout} onChange={(e) => setD({ ...d, request_timeout: e.target.value })} />
        </Field>
      </div>
      <p className="nx-sub">{d.provider === "ollama" ? t("The bundled model runs inside this deployment. No finding leaves the server.") : t("Aletheia sends aggregated findings to this provider, never SAP records.")}</p>
      <OutcomeNote outcome={outcome} />
      <div className="nx-tn-actions">
        <Button
          variant="quiet"
          disabled={!valid || pending !== null}
          loading={pending === "test"}
          loadingLabel={t("Testing…")}
          onClick={() =>
            void run("test", async () => {
              const r = await testLlm(body());
              return { tone: r.success ? "ok" : "fail", title: r.success ? t("The model answered") : t("The model did not answer"), detail: r.message };
            })
          }
        >
          {t("Test the model")}
        </Button>
        <Button
          variant="primary"
          disabled={!dirty || !valid || pending !== null}
          loading={pending === "save"}
          loadingLabel={t("Saving…")}
          onClick={() =>
            void run("save", async () => {
              const r = await putLlmConfig(body());
              await qc.invalidateQueries({ queryKey: ["v2", "llm", f] });
              return { tone: "ok", title: t("Aletheia now uses {model}", { model: r.model }) };
            })
          }
        >
          {t("Save the model")}
        </Button>
      </div>
    </>
  );
}

function LlmPrivacy({ on }: { on: boolean }) {
  const qc = useQueryClient();
  const f = useFixture();
  const { outcome, pending, run } = useOutcome("llm-privacy");
  return (
    <>
      <Switch
        checked={on}
        disabled={pending !== null}
        label={t("Aggregates only to the model")}
        hint={t("On: no sample from a row reaches the model, not a value, a mask or a key shape. Aletheia sends counts and totals only, and falls back to the deterministic checks where a sample would have helped.")}
        onChange={(v) =>
          void run("privacy", async () => {
            await putLlmAggregatesOnly(v);
            await qc.invalidateQueries({ queryKey: ["v2", "llm", f] });
            return { tone: "ok", title: v ? t("Only aggregates go to the model") : t("Masked samples may go to the model") };
          })
        }
      />
      <OutcomeNote outcome={outcome} />
    </>
  );
}

/** The provider and model Aletheia answers with, read and changed under manage_llm. Until saved here the environment decides. */
export function LlmBlock() {
  const can = useCan()("manage_llm");
  const f = useFixture();
  const cfg = useQuery({ queryKey: ["v2", "llm", f], queryFn: getLlmConfig, enabled: can, retry: false });
  const prov = useQuery({ queryKey: ["v2", "llm", f, "providers"], queryFn: getLlmProviders, enabled: can, retry: false, staleTime: Infinity });
  if (!can) return null;
  return (
    <Block id="llm" title={t("Language model")} hint={t("The model behind Aletheia's answers. It sees aggregated findings only; every number comes from the deterministic checks.")}>
      <Loaded q={cfg} what={t("The language model settings")} rows={3}>
        {(c) => (
          <>
            <p className="nx-sub" data-testid="llm-source">
              {c.source === "environment" ? t("Set by the deployment's environment. Saving here overrides it for this tenant.") : t("Saved here {when}.", { when: c.updated_at ? formatDate(c.updated_at, "datetime") : "" })}
            </p>
            <LlmPrivacy on={c.aggregates_only} />
            <Loaded q={prov} what={t("The providers")} rows={2}>
              {(pv) => <LlmEditor key={JSON.stringify(c)} config={c} providers={pv.providers} />}
            </Loaded>
          </>
        )}
      </Loaded>
    </Block>
  );
}

/* Quality thresholds */

const KEYS = ["target", "warning", "critical"] as const;
type Bands = Record<string, Record<(typeof KEYS)[number], string>>;

function bandsOk(d: Bands[string]): boolean {
  const [tg, w, c] = KEYS.map((k) => (d[k].trim() === "" ? Number.NaN : Number(d[k])));
  return [tg, w, c].every((v) => Number.isFinite(v) && v >= 0 && v <= 100) && c <= w && w <= tg;
}

/** Where a dimension's bands come from for this scope: its own row, the tenant default, or the score bands. */
function source(q: QualityThresholds, scope: string, dim: string): "module" | "tenant" | "fallback" {
  if (scope !== "*" && q.modules[scope]?.[dim]) return "module";
  return q.tenant[dim] && JSON.stringify(q.tenant[dim]) !== JSON.stringify(q.fallback) ? "tenant" : "fallback";
}

function ThresholdTable({ q, write, modules, scope, setScope }: { q: QualityThresholds; write: boolean; modules: string[]; scope: string; setScope: (s: string) => void }) {
  const qc = useQueryClient();
  const { outcome, pending, run } = useOutcome("quality-thresholds");
  const draftOf = (s: string): Bands =>
    Object.fromEntries(
      q.dimensions.map((d) => {
        const b = (s === "*" ? q.tenant[d] : bandsFor(q, s, d)) ?? q.fallback;
        return [d, { target: String(b.target), warning: String(b.warning), critical: String(b.critical) }];
      }),
    );
  const [draft, setDraft] = useState<Bands>(() => draftOf(scope));
  const pick = (s: string) => {
    setScope(s);
    setDraft(draftOf(s));
  };
  const save = (dim: string) =>
    void run(`save-${dim}`, async () => {
      const d = draft[dim];
      await api.putQualityThreshold({ module: scope, dimension: dim, target: Number(d.target), warning: Number(d.warning), critical: Number(d.critical) });
      await refreshAdmin(qc, "settings");
      return { tone: "ok", title: t("Thresholds saved"), detail: t("Object and run screens show the new band at once. Scores do not change.") };
    });
  const clear = (dim: string) =>
    void run(`clear-${dim}`, async () => {
      await api.deleteQualityThreshold(scope, dim);
      await refreshAdmin(qc, "settings");
      return { tone: "ok", title: t("Override removed"), detail: scope === "*" ? t("This dimension now uses the score bands.") : t("This dimension now uses the tenant default.") };
    });
  const SRC = { module: t("This module"), tenant: t("Tenant default"), fallback: t("Score bands") };
  return (
    <>
      <div className="nx-tn-inline">
        <Field label={t("Applies to")}>
          <select className="nx-input" value={scope} onChange={(e) => pick(e.target.value)} data-testid="threshold-scope">
            <option value="*">{t("All modules (tenant default)")}</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {formatModuleName(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="nx-tn-table-wrap" tabIndex={0}>
        <table className="nx-table" data-testid="quality-thresholds" aria-label={t("Quality thresholds")}>
          <thead>
            <tr>
              <th scope="col">{t("Dimension")}</th>
              {KEYS.map((k) => (
                <th key={k} scope="col" className="nx-tn-num">
                  {labelText(k)}
                </th>
              ))}
              <th scope="col">{t("Set by")}</th>
              {write ? <th scope="col" aria-label={t("Actions")} /> : null}
            </tr>
          </thead>
          <tbody>
            {q.dimensions.map((d) => {
              const src = source(q, scope, d);
              const own = scope === "*" ? src === "tenant" : src === "module";
              const good = bandsOk(draft[d]);
              return (
                <tr key={d}>
                  <th scope="row">{d === "overall" ? t("Overall score") : labelText(d)}</th>
                  {KEYS.map((k) => (
                    <td key={k} className="nx-tn-num">
                      {write ? (
                        <input
                          className="nx-input nx-tn-num"
                          type="number"
                          min={0}
                          max={100}
                          aria-label={t("{dim} {band}", { dim: labelText(d), band: labelText(k) })}
                          value={draft[d][k]}
                          onChange={(e) => setDraft({ ...draft, [d]: { ...draft[d], [k]: e.target.value } })}
                        />
                      ) : (
                        draft[d][k]
                      )}
                    </td>
                  ))}
                  <td>
                    {SRC[src]}
                    {write && !good ? (
                      <span className="nx-tn-bad" role="alert">
                        {" "}
                        {t("Critical must not exceed warning, and warning must not exceed target.")}
                      </span>
                    ) : null}
                  </td>
                  {write ? (
                    <td>
                      <div className="nx-tn-actions">
                        <Button variant="primary" size={32} disabled={!good || pending !== null} loading={pending === `save-${d}`} loadingLabel={t("Saving…")} onClick={() => save(d)}>
                          {t("Save")}
                        </Button>
                        {own ? (
                          <Button variant="quiet" size={32} disabled={pending !== null} onClick={() => clear(d)}>
                            {t("Clear")}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <OutcomeNote outcome={outcome} />
    </>
  );
}

/** Target, warning and critical per dimension, for the tenant and per module. Viewers see them read only. */
export function QualityThresholdsBlock({ write, modules }: { write: boolean; modules: string[] }) {
  const q = useQualityThresholds();
  // The scope outlives the table, which remounts on every refetch so its drafts start from the saved values.
  const [scope, setScope] = useState("*");
  return (
    <div id="quality-thresholds">
      <Block title={t("Quality thresholds")} hint={t("Each dimension and the overall score are held to a target, a warning line and a critical line. Set them once for the tenant and override them per module. Object and run screens show the band a score falls in.")}>
        <Loaded q={q} what={t("The quality thresholds")} rows={4}>
          {(d) => <ThresholdTable key={JSON.stringify(d)} q={d} write={write} modules={modules} scope={scope} setScope={setScope} />}
        </Loaded>
      </Block>
    </div>
  );
}

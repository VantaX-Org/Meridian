"use client";

import "../step10.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDigest, deleteDigest, sendDigestNow, updateDigest, type Digest, type DigestBody, type DigestChannel } from "@/lib/api/v2/step10";
import { formatDate } from "@/lib/format";
import { useChannels, useUsers, useWaves } from "@/lib/v2/admin-queries";
import { cronError, CUSTOM, describeCron, isPreset, PRESETS } from "@/lib/v2/cron";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useRunList } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { audienceWords, CHANNEL_WORD, deliveryTone, deliveryWord, emailOk, emailsFrom, passRateText, zoneOk } from "@/lib/v2/step10";
import { refreshStep10, useDigestDeliveries, useDigestHtml, useDigestNumbers, useDigests, usePolicyEvidence, usePolicyPacks } from "@/lib/v2/step10-queries";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { Field } from "../forms";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { SeverityMark, VerdictMark, type SeverityKey } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { PolicyMark } from "../Ruler";
import { appliedWords, CoverageList, PackActions } from "../admin/step10";
import { Confirm, Dialog, NeedsPermission, StatusWord } from "../admin/kit";
import { ResultFrame, useOutcome } from "./shared";

const sev = (s: string | null | undefined): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "info");

// ── policy pack ──────────────────────────────────────────────────────────────

/** The evidence of a pack per class, for the current state or one run: authority, fields, and each rule's numbers. */
function Evidence({ id }: { id: string }) {
  const [run, setRun] = useState<string>("");
  const runs = useRunList();
  const q = usePolicyEvidence(id, run || null);
  const { hrefFor } = useOpenItem();
  return (
    <>
      <h3>{t("Evidence")}</h3>
      <Field label={t("Evidence of")} hint={t("The current state reads every object at its latest run; a run reads that run only.")}>
        {(p) => (
          <select {...p} className="m2-sel" value={run} onChange={(e) => setRun(e.target.value)}>
            <option value="">{t("The current state")}</option>
            {(runs.data?.versions ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {t("Run {run_at}", { run_at: formatDate(v.run_at, "datetime") })}
              </option>
            ))}
          </select>
        )}
      </Field>
      {q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The evidence could not be read.")}</ErrorFrame>
      ) : (
        <ul className="m2-s10-classes" data-testid="pack-classes">
          {q.data.classes.map((c) => (
            <li key={c.id} data-testid={`class-${c.id}`}>
              <div className="m2-s10-ch">
                <strong>{c.label}</strong>
                <span className="m2-v">
                  {c.breached ? <PolicyMark mark={{ count: 1, title: t("Breached: a critical rule of this class fails") }} /> : c.rules_measured > 0 ? <VerdictMark verdict="go" /> : null}
                  {c.breached ? t("Breached") : c.rules_measured > 0 ? t("Evidenced") : t("No rule measured")}
                </span>
              </div>
              <span className="m2-s10-auth">{c.authority}</span>
              <p className="m2-meta" style={{ margin: "4px 0 0" }}>
                {t("{measured} of {count} rules measured, pass rate {rate}, {failing} failing records", { measured: c.rules_measured, count: c.rules_count, rate: passRateText(c.pass_rate) ?? "—", failing: int(c.failing_records) })}
              </p>
              <div className="m2-s10-fields" aria-label={t("Fields of {label}", { label: c.label })}>
                {c.fields.map((f) => (
                  <Mono key={f}>{f}</Mono>
                ))}
              </div>
              {c.rules.length ? (
                <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Rules of {label}, scrollable", { label: c.label })} style={{ marginTop: 8 }}>
                  <table className="m2-tbl" aria-label={t("Rules evidencing {label}", { label: c.label })}>
                    <thead>
                      <tr>
                        <th scope="col">{t("Rule")}</th>
                        <th scope="col">{t("Severity")}</th>
                        <th scope="col" className="m2-r">{t("Pass rate")}</th>
                        <th scope="col" className="m2-r">{t("Failing")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rules.map((r) => (
                        <tr key={r.check_id}>
                          <th scope="row">
                            <V2Link href={hrefFor({ kind: "rule", id: r.check_id })}>
                              <Mono>{r.check_id}</Mono>
                            </V2Link>
                          </th>
                          <td>
                            {r.measured ? (
                              <span className="m2-v">
                                <SeverityMark severity={sev(r.severity)} />
                                {r.severity ?? "—"}
                              </span>
                            ) : (
                              <Dash why={t("Not measured: no run of this tenant evaluated the rule")} />
                            )}
                          </td>
                          <td className="m2-r">{passRateText(r.pass_rate) ?? <Dash why={t("Not measured")} />}</td>
                          <td className="m2-r">{r.measured ? t("{failing} of {total}", { failing: int(r.failing_records), total: int(r.total_records) }) : <Dash why={t("Not measured")} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="m2-prov">{t("No catalogue rule checks these fields yet: the class is listed so the gap is visible.")}</p>
              )}
              {c.failing_records > 0 ? (
                <p className="m2-prov">
                  <V2Link href={`/work?policy=${encodeURIComponent(`${id}:${c.id}`)}&filter=open`}>{t("Open the failing records in Work")}</V2Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** `?open=policypack:<id>`: one pack, its state, coverage, apply or remove, and its classes with their evidence. */
export function PolicyPackInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = usePolicyPacks();
  const p = q.data?.packs.find((x) => x.id === id);
  return (
    <InspectorFrame title={p?.name ?? t("Policy pack")} status={p ? (p.applied ? t("Applied") : t("Not applied")) : undefined} onClose={onClose}>
      {p ? (
        <>
          <Facts>
            <Fact label={t("Authority")}>{p.authority}</Fact>
            <Fact label={t("State")}>{appliedWords(p)}</Fact>
            <Fact label={t("Classes")}>{int(p.classes.length)}</Fact>
          </Facts>
          <p className="m2-prov">{p.description}</p>
          <CoverageList p={p} />
          <PackActions p={p} scope={`pack-insp:${p.id}`} />
          <Evidence id={p.id} />
        </>
      ) : q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The policy pack could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("There is no policy pack called {id}.", { id })}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}

// ── digest ───────────────────────────────────────────────────────────────────

const ROLE_KEYS = ["programme_lead", "data_steward", "data_owner", "analyst", "sap_basis", "platform_admin", "auditor", "viewer", "process_analyst"];
const CHANNELS: DigestChannel[] = ["email", "alert_channel", "webhook"];

interface Draft {
  name: string;
  audience: "role" | "wave";
  role: string;
  wave_id: string;
  cron: string;
  custom: boolean;
  timezone: string;
  channel: DigestChannel;
  recipients: string;
  users: string[];
  alert_channel_id: string;
  attach_pdf: boolean;
  enabled: boolean;
}

const draftOf = (d: Digest | null): Draft => ({
  name: d?.name ?? "",
  audience: d?.audience ?? "role",
  role: d?.role ?? "programme_lead",
  wave_id: d?.wave_id ?? "",
  cron: d?.cron ?? "0 7 * * 1",
  custom: d ? !isPreset(d.cron) : true,
  timezone: d?.timezone ?? "UTC",
  channel: d?.channel ?? "email",
  recipients: (d?.recipients ?? []).join("\n"),
  users: d?.recipient_user_ids ?? [],
  alert_channel_id: d?.alert_channel_id ?? "",
  attach_pdf: d?.attach_pdf ?? true,
  enabled: d?.enabled ?? true,
});

function bodyOf(x: Draft): DigestBody {
  return {
    name: x.name.trim(),
    audience: x.audience,
    role: x.audience === "role" ? x.role : null,
    wave_id: x.audience === "wave" ? x.wave_id || null : null,
    cron: x.cron.trim(),
    timezone: x.timezone.trim(),
    channel: x.channel,
    recipients: x.channel === "email" ? emailsFrom(x.recipients) : [],
    recipient_user_ids: x.channel === "email" ? x.users : [],
    alert_channel_id: x.channel === "alert_channel" ? x.alert_channel_id || null : null,
    attach_pdf: x.attach_pdf,
    enabled: x.enabled,
  };
}

/** What is wrong with a draft, field by field; empty when it can be sent. */
function problems(x: Draft): Partial<Record<"name" | "cron" | "timezone" | "target" | "channel" | "recipients", string>> {
  const out: Partial<Record<"name" | "cron" | "timezone" | "target" | "channel" | "recipients", string>> = {};
  if (!x.name.trim()) out.name = t("Give the digest a name.");
  const ce = cronError(x.cron);
  if (ce) out.cron = ce;
  if (!zoneOk(x.timezone)) out.timezone = t("An IANA time zone, such as Africa/Johannesburg or Europe/Berlin.");
  if (x.audience === "wave" && !x.wave_id) out.target = t("Choose the wave.");
  if (x.channel === "alert_channel" && !x.alert_channel_id) out.channel = t("Choose the alert channel.");
  const bad = emailsFrom(x.recipients).filter((e) => !emailOk(e));
  if (x.channel === "email" && bad.length) out.recipients = t("Not an email address: {list}", { list: bad.join(", ") });
  else if (x.channel === "email" && x.audience === "wave" && !emailsFrom(x.recipients).length && !x.users.length) out.recipients = t("A wave digest by email needs at least one recipient.");
  return out;
}

/** The form of a digest, new or existing: who it is for, when, where it goes and to whom. */
function DigestForm({ initial, onSaved }: { initial: Digest | null; onSaved: (d: Digest) => void }) {
  const qc = useQueryClient();
  const waves = useWaves();
  const channels = useChannels();
  const users = useUsers();
  const [x, setX] = useState<Draft>(() => draftOf(initial));
  const { outcome, pending, run } = useOutcome(initial ? `digest-form:${initial.id}` : "digest-form:new");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setX((cur) => ({ ...cur, [k]: v }));
  const errs = problems(x);
  const ok = Object.keys(errs).length === 0;
  const people = (users.data?.users ?? []).filter((u) => u.is_active);
  const save = () =>
    void run("save", async () => {
      const body = bodyOf(x);
      let saved: Digest;
      if (initial) {
        const before = bodyOf(draftOf(initial));
        const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof DigestBody]))) as Partial<DigestBody>;
        if (Object.keys(changed).length === 0) return { tone: "info", title: t("Nothing to save") };
        saved = await updateDigest(initial.id, changed);
      } else saved = await createDigest(body);
      await refreshStep10(qc, "digests");
      onSaved(saved);
      return { tone: "ok", title: initial ? t("Digest saved") : t("Digest added"), detail: saved.next_run_at ? t("Next send {when}.", { when: formatDate(saved.next_run_at, "datetime") }) : t("Paused: it is not sent until it is turned on.") };
    });
  return (
    <div data-testid="digest-form">
      <Field label={t("Name")} error={x.name ? errs.name : undefined}>
        {(p) => <input {...p} value={x.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />}
      </Field>
      <div className="m2-segs" role="group" aria-label={t("For")} style={{ marginTop: 8 }}>
        <button type="button" className="m2-seg" aria-pressed={x.audience === "role"} onClick={() => set("audience", "role")}>
          {t("A role")}
        </button>
        <button type="button" className="m2-seg" aria-pressed={x.audience === "wave"} onClick={() => set("audience", "wave")}>
          {t("A migration wave")}
        </button>
      </div>
      {x.audience === "role" ? (
        <Field label={t("Role")} hint={t("Without recipients, an email digest goes to every active user holding the role.")}>
          {(p) => (
            <select {...p} value={x.role} onChange={(e) => set("role", e.target.value)}>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r] ?? r}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        <Field label={t("Wave")} error={errs.target}>
          {(p) => (
            <select {...p} value={x.wave_id} onChange={(e) => set("wave_id", e.target.value)}>
              <option value="">{t("Choose the wave")}</option>
              {(waves.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={t("Cadence")} hint={x.custom ? undefined : describeCron(x.cron)}>
        {(p) => (
          <select
            {...p}
            value={x.custom ? CUSTOM : x.cron}
            onChange={(e) => (e.target.value === CUSTOM ? set("custom", true) : setX((cur) => ({ ...cur, custom: false, cron: e.target.value })))}
          >
            {PRESETS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {x.custom ? (
        <Field label={t("Cron expression")} error={errs.cron} hint={errs.cron ? undefined : t("Minute hour day month weekday, in the time zone below.")}>
          {(p) => <input {...p} className="m2-mono" value={x.cron} onChange={(e) => set("cron", e.target.value)} placeholder="0 7 * * 1" />}
        </Field>
      ) : null}
      <Field label={t("Time zone")} error={errs.timezone}>
        {(p) => <input {...p} value={x.timezone} maxLength={64} onChange={(e) => set("timezone", e.target.value)} placeholder="Africa/Johannesburg" />}
      </Field>
      <Field label={t("Channel")} error={errs.channel}>
        {(p) => (
          <select {...p} value={x.channel} onChange={(e) => set("channel", e.target.value as DigestChannel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_WORD[c]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {x.channel === "alert_channel" ? (
        <Field label={t("Alert channel")}>
          {(p) => (
            <select {...p} value={x.alert_channel_id} onChange={(e) => set("alert_channel_id", e.target.value)}>
              <option value="">{t("Choose the alert channel")}</option>
              {(channels.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {`${c.kind}: ${c.target}`}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      {x.channel === "webhook" ? <p className="m2-prov">{t("Posted as the digest.sent event to every active webhook that subscribes to it, under Administration, Webhooks. The event carries the numbers only.")}</p> : null}
      {x.channel === "email" ? (
        <>
          <Field label={t("Email addresses")} error={errs.recipients} hint={errs.recipients ? undefined : t("One per line or separated by commas.")}>
            {(p) => <textarea {...p} rows={3} value={x.recipients} onChange={(e) => set("recipients", e.target.value)} />}
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: "8px 0 0" }}>
            <legend className="m2-lbl">{t("People")}</legend>
            {users.isPending ? (
              <Skeleton width="100%" height={40} />
            ) : people.length === 0 ? (
              <p className="m2-meta">{t("No active user to choose.")}</p>
            ) : (
              <ul className="m2-pick" aria-label={t("People to send to")} style={{ maxHeight: 180, overflow: "auto" }}>
                {people.map((u) => (
                  <li key={u.id}>
                    <label>
                      <input type="checkbox" checked={x.users.includes(u.id)} onChange={() => set("users", x.users.includes(u.id) ? x.users.filter((y) => y !== u.id) : [...x.users, u.id])} />
                      <span>{u.name || u.email}</span>
                      <span className="m2-meta">{u.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </>
      ) : null}
      <label className="m2-check">
        <input type="checkbox" checked={x.attach_pdf} disabled={x.channel === "webhook"} onChange={(e) => set("attach_pdf", e.target.checked)} />
        {t("Attach the digest as a PDF")}
      </label>
      <label className="m2-check">
        <input type="checkbox" checked={x.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("Send on its schedule")}
      </label>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button type="button" className="m2-btn m2-strong" disabled={!ok || pending !== null} onClick={save}>
          {pending === "save" ? t("Saving…") : initial ? t("Save changes") : t("Add the digest")}
        </button>
      </Actions>
    </div>
  );
}

/** The digest as its email reads now, in a sandboxed frame, or the numbers it is rendered from. */
function PreviewDialog({ d, onClose }: { d: Digest; onClose: () => void }) {
  const [view, setView] = useState<"email" | "numbers">("email");
  const htmlQ = useDigestHtml(d.id, view === "email");
  const num = useDigestNumbers(d.id, view === "numbers");
  return (
    <Dialog title={t("Preview of {name}", { name: d.name })} description={t("As it would be sent now. Nothing is sent from here.")} onClose={onClose} className="m2-dg-dlg">
      <div className="m2-segs" role="group" aria-label={t("Show")}>
        <button type="button" className="m2-seg" aria-pressed={view === "email"} onClick={() => setView("email")}>
          {t("The email")}
        </button>
        <button type="button" className="m2-seg" aria-pressed={view === "numbers"} onClick={() => setView("numbers")}>
          {t("The numbers")}
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        {view === "email" ? (
          htmlQ.isPending ? (
            <Skeleton width="100%" height={240} />
          ) : htmlQ.isError ? (
            <ErrorFrame onRetry={() => void htmlQ.refetch()}>{t("The preview could not be read.")}</ErrorFrame>
          ) : (
            <iframe className="m2-dg-frame" title={t("Email preview of {name}", { name: d.name })} sandbox="" srcDoc={htmlQ.data} data-testid="digest-iframe" />
          )
        ) : num.isPending ? (
          <Skeleton width="100%" height={240} />
        ) : num.isError ? (
          <ErrorFrame onRetry={() => void num.refetch()}>{t("The numbers could not be read.")}</ErrorFrame>
        ) : (
          <div className="m2-dg-num" data-testid="digest-numbers">
            <p style={{ margin: 0 }}>{num.data.landscape.text}</p>
            <dl className="m2-facts">
              <Fact label={t("Objects")}>{int(num.data.landscape.objects)}</Fact>
              <Fact label={t("Held under 85")}>{int(num.data.landscape.held_under_85)}</Fact>
              <Fact label={t("Approvals waiting")}>{int(num.data.approvals_waiting)}</Fact>
              <Fact label={t("SLA breaches")}>{int(num.data.sla_breaches)}</Fact>
              <Fact label={t("Value at risk")}>{num.data.value_at_risk.total == null ? <Dash why={t("Not priced: no cost model")} /> : `${num.data.currency} ${int(num.data.value_at_risk.total)}`}</Fact>
              <Fact label={t("Waves")}>{num.data.waves.length ? num.data.waves.map((w) => `${w.name}: ${w.gate_open ? t("gate open") : t("gate closed")}`).join("; ") : "—"}</Fact>
            </dl>
            {num.data.score_moves.length ? (
              <table className="m2-tbl" aria-label={t("Score moves")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col" className="m2-r">{t("Before")}</th>
                    <th scope="col" className="m2-r">{t("After")}</th>
                    <th scope="col" className="m2-r">{t("Change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {num.data.score_moves.map((m) => (
                    <tr key={`${m.system}:${m.module}`}>
                      <th scope="row">{`${m.system}, ${m.module}`}</th>
                      <td className="m2-r">{m.before.toFixed(1)}</td>
                      <td className="m2-r">{m.after.toFixed(1)}</td>
                      <td className="m2-r">{`${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            <p className="m2-meta" style={{ margin: 0 }}>{t("Built {when}", { when: formatDate(num.data.generated_at, "datetime") })}</p>
          </div>
        )}
      </div>
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </Dialog>
  );
}

function DeliveryLog({ d }: { d: Digest }) {
  const q = useDigestDeliveries(d.id);
  return (
    <>
      <h3>{t("Delivery log")}</h3>
      {q.isPending ? (
        <Skeleton width="100%" height={80} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The delivery log could not be read.")}</ErrorFrame>
      ) : q.data.deliveries.length === 0 ? (
        <EmptyFrame>{t("Nothing has been sent yet. Send it now, or wait for its next slot.")}</EmptyFrame>
      ) : (
        <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Delivery log, scrollable")}>
          <table className="m2-tbl" aria-label={t("Deliveries of {name}", { name: d.name })} data-testid="digest-deliveries">
            <thead>
              <tr>
                <th scope="col">{t("When")}</th>
                <th scope="col">{t("State")}</th>
                <th scope="col" className="m2-r">{t("Delivered")}</th>
                <th scope="col" className="m2-r">{t("Failed")}</th>
                <th scope="col">{t("Why")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.deliveries.map((x) => {
                const tone = deliveryTone(x.status);
                return (
                  <tr key={x.id}>
                    <th scope="row">
                      {formatDate(x.finished_at ?? x.created_at, "datetime")}
                      {x.manual ? <span className="m2-meta">{` ${t("sent by hand")}`}</span> : null}
                    </th>
                    <td>
                      <span className="m2-v">
                        {tone ? <VerdictMark verdict={tone} /> : null}
                        {deliveryWord(x.status)}
                      </span>
                    </td>
                    <td className="m2-r">{int(x.delivered)}</td>
                    <td className="m2-r">{int(x.failed)}</td>
                    <td>{x.reason === "sandbox" ? t("Sandbox mode: nothing leaves the deployment") : (x.reason ?? <Dash why={t("No note")} />)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DigestBodyView({ d, onClose }: { d: Digest; onClose: () => void }) {
  const qc = useQueryClient();
  const waves = useWaves();
  const users = useUsers();
  const [preview, setPreview] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const { outcome, pending, run } = useOutcome(`digest:${d.id}`);
  const waveName = (id: string) => waves.data?.find((w) => w.id === id)?.name ?? null;
  const names = d.recipient_user_ids.map((id) => users.data?.users.find((u) => u.id === id)?.name ?? id);
  const recipients = [...d.recipients, ...names];
  return (
    <>
      <Facts>
        <Fact label={t("For")}>{audienceWords(d, (r) => ROLE_NAMES[r] ?? r, waveName)}</Fact>
        <Fact label={t("Cadence")}>{t("{cadence}, {zone}", { cadence: describeCron(d.cron), zone: d.timezone })}</Fact>
        <Fact label={t("Channel")}>{CHANNEL_WORD[d.channel] ?? d.channel}</Fact>
        <Fact label={t("Recipients")}>{d.channel !== "email" ? <Dash why={t("This channel has no recipients of its own")} /> : recipients.length ? <span className="m2-dg-recips">{recipients.map((r) => <span key={r}>{r}</span>)}</span> : d.audience === "role" ? t("Every active user holding the role") : <Dash why={t("No recipient")} />}</Fact>
        <Fact label={t("PDF")}>{d.attach_pdf ? t("Attached") : t("Not attached")}</Fact>
        <Fact label={t("State")}>
          <StatusWord tone={d.enabled ? "go" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</StatusWord>
        </Fact>
        <Fact label={t("Last sent")}>{d.last_sent_at ? formatDate(d.last_sent_at, "datetime") : t("Never")}</Fact>
        <Fact label={t("Next send")}>{d.next_run_at ? formatDate(d.next_run_at, "datetime") : <Dash why={d.enabled ? t("Not scheduled") : t("Paused")} />}</Fact>
      </Facts>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={pending !== null}
          onClick={() =>
            void run("send", async () => {
              const r = await sendDigestNow(d.id);
              await refreshStep10(qc, "digests");
              if (r.status === "skipped") return { tone: "info", title: t("Held back"), detail: r.reason === "sandbox" ? t("Sandbox mode is on: nothing leaves the deployment. The delivery is logged as held back.") : (r.reason ?? undefined) };
              return { tone: r.status === "sent" ? "ok" : "fail", title: r.status === "sent" ? t("Digest sent") : t("Digest not sent"), detail: [t("{delivered} delivered, {failed} failed.", { delivered: r.delivered, failed: r.failed }), r.reason].filter(Boolean).join(" ") };
            })
          }
        >
          {pending === "send" ? t("Sending…") : t("Send now")}
        </button>
        <button type="button" className="m2-btn" onClick={() => setPreview(true)}>
          {t("Preview")}
        </button>
        <button
          type="button"
          className="m2-btn"
          disabled={pending !== null}
          onClick={() =>
            void run("enabled", async () => {
              await updateDigest(d.id, { enabled: !d.enabled });
              await refreshStep10(qc, "digests");
              return { tone: "ok", title: d.enabled ? t("Digest paused") : t("Digest turned on") };
            })
          }
        >
          {d.enabled ? t("Pause") : t("Turn on")}
        </button>
        <button type="button" className="m2-btn" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
          {t("Edit")}
        </button>
        <button type="button" className="m2-btn m2-ghost" onClick={() => setRemoving(true)}>
          {t("Delete")}
        </button>
      </Actions>
      {editing ? <DigestForm key={d.updated_at} initial={d} onSaved={() => setEditing(false)} /> : null}
      <DeliveryLog d={d} />
      {preview ? <PreviewDialog d={d} onClose={() => setPreview(false)} /> : null}
      {removing ? (
        <Confirm
          title={t("Delete {name}", { name: d.name })}
          body={t("It is not sent again and its delivery log goes with it.")}
          confirm={t("Delete the digest")}
          cancel={t("Keep")}
          danger
          pending={pending === "delete"}
          onCancel={() => setRemoving(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await deleteDigest(d.id);
              await refreshStep10(qc, "digests");
              setRemoving(false);
              onClose();
              return { tone: "ok", title: t("Digest deleted") };
            })
          }
        />
      ) : null}
    </>
  );
}

/** `?open=digest:<id>`: one digest, Send now, Preview, its edits and its delivery log. `digest:new` adds one. */
export function DigestInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const session = useV2Session();
  const allowed = session.can("manage_settings");
  const q = useDigests(allowed && id !== "new");
  const { openItem } = useOpenItem();
  if (!allowed) {
    return (
      <InspectorFrame title={t("Digest")} onClose={onClose}>
        <NeedsPermission what={t("Managing digests")} permission="manage_settings" />
      </InspectorFrame>
    );
  }
  if (id === "new") {
    return (
      <InspectorFrame title={t("Add a digest")} status={t("By role or by wave")} onClose={onClose}>
        <DigestForm initial={null} onSaved={(d) => openItem({ kind: "digest", id: d.id })} />
      </InspectorFrame>
    );
  }
  const d = q.data?.digests.find((x) => x.id === id);
  return (
    <InspectorFrame title={d?.name ?? t("Digest")} status={d ? (d.enabled ? t("On") : t("Paused")) : undefined} onClose={onClose}>
      {d ? (
        <DigestBodyView d={d} onClose={onClose} />
      ) : q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The digest could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("This digest does not exist. It may have been deleted.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}

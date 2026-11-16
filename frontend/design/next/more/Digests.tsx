"use client";

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDigest, deleteDigest, sendDigestNow, updateDigest, type Digest, type DigestBody, type DigestChannel, type DigestDelivery } from "@/lib/api/v2/step10";
import { formatDate } from "@/lib/format";
import { useChannels, useUsers, useWaves } from "@/lib/v2/admin-queries";
import { cronError, CUSTOM, describeCron, isPreset, PRESETS } from "@/lib/v2/cron";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { audienceWords, CHANNEL_WORD, deliveryTone, deliveryWord, emailOk, emailsFrom, zoneOk } from "@/lib/v2/step10";
import { refreshStep10, useDigestDeliveries, useDigestHtml, useDigestNumbers, useDigests } from "@/lib/v2/step10-queries";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { Button, Chip, Confirm, DataTable, SegmentedControl, Sheet, Skeleton, type Column, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { Denied, QueryView, useSubmitGuard } from "./states";
import "./journey.css";

/**
 * Scheduled digests in the new interface (GET/POST /digests, PATCH/DELETE /digests/{id}, POST /digests/{id}/send-now,
 * GET /digests/{id}/deliveries, GET /digests/{id}/preview and preview.json). One sheet kind, "digests":
 * id "" lists them, "new" adds one, any other id is one digest with Send now, Preview, Pause, Edit, Delete and its log.
 */

const ROLE_KEYS = ["programme_lead", "data_steward", "data_owner", "analyst", "sap_basis", "platform_admin", "auditor", "viewer", "process_analyst"];
const CHANNELS: DigestChannel[] = ["email", "alert_channel", "webhook"];
const roleName = (r: string) => ROLE_NAMES[r] ?? r;

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

const bodyOf = (x: Draft): DigestBody => ({
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
});

type Problem = "name" | "cron" | "timezone" | "target" | "channel" | "recipients";
function problems(x: Draft): Partial<Record<Problem, string>> {
  const out: Partial<Record<Problem, string>> = {};
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

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="nx-field">
      {label}
      {children}
      {error ? <span className="nx-sub" role="alert">{error}</span> : hint ? <span className="nx-sub">{hint}</span> : null}
    </label>
  );
}

function DigestForm({ initial, onSaved }: { initial: Digest | null; onSaved: (d: Digest) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const waves = useWaves();
  const channels = useChannels();
  const users = useUsers();
  const [x, setX] = useState<Draft>(() => draftOf(initial));
  const { busy, run } = useSubmitGuard();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setX((cur) => ({ ...cur, [k]: v }));
  const errs = problems(x);
  const ok = Object.keys(errs).length === 0;
  const people = (users.data?.users ?? []).filter((u) => u.is_active);
  const save = () =>
    run(async () => {
      try {
        const body = bodyOf(x);
        let saved: Digest;
        if (initial) {
          const before = bodyOf(draftOf(initial));
          const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof DigestBody]))) as Partial<DigestBody>;
          if (Object.keys(changed).length === 0) return toast({ text: t("Nothing to save") });
          saved = await updateDigest(initial.id, changed);
        } else saved = await createDigest(body);
        await refreshStep10(qc, "digests");
        toast({ text: `${initial ? t("Digest saved") : t("Digest added")}. ${saved.next_run_at ? t("Next send {when}.", { when: formatDate(saved.next_run_at, "datetime") }) : t("Paused: it is not sent until it is turned on.")}`, tone: "good" });
        onSaved(saved);
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  return (
    <div className="nx-form" data-testid="digest-form">
      <Field label={t("Name")} error={x.name ? errs.name : undefined}>
        <input className="nx-input" value={x.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <SegmentedControl label={t("For")} value={x.audience} onChange={(v) => set("audience", v)} items={[{ value: "role", label: t("A role") }, { value: "wave", label: t("A migration wave") }]} />
      {x.audience === "role" ? (
        <Field label={t("Role")} hint={t("Without recipients, an email digest goes to every active user holding the role.")}>
          <select className="nx-input" value={x.role} onChange={(e) => set("role", e.target.value)}>
            {ROLE_KEYS.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
          </select>
        </Field>
      ) : (
        <Field label={t("Wave")} error={errs.target}>
          <select className="nx-input" value={x.wave_id} onChange={(e) => set("wave_id", e.target.value)}>
            <option value="">{t("Choose the wave")}</option>
            {(waves.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
      )}
      <Field label={t("Cadence")} hint={x.custom ? undefined : describeCron(x.cron)}>
        <select className="nx-input" value={x.custom ? CUSTOM : x.cron} onChange={(e) => (e.target.value === CUSTOM ? set("custom", true) : setX((cur) => ({ ...cur, custom: false, cron: e.target.value })))}>
          {PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      {x.custom ? (
        <Field label={t("Cron expression")} error={errs.cron} hint={t("Minute hour day month weekday, in the time zone below.")}>
          <input className="nx-input" value={x.cron} onChange={(e) => set("cron", e.target.value)} placeholder="0 7 * * 1" />
        </Field>
      ) : null}
      <Field label={t("Time zone")} error={errs.timezone}>
        <input className="nx-input" value={x.timezone} maxLength={64} onChange={(e) => set("timezone", e.target.value)} placeholder="Africa/Johannesburg" />
      </Field>
      <Field label={t("Channel")} error={errs.channel}>
        <select className="nx-input" value={x.channel} onChange={(e) => set("channel", e.target.value as DigestChannel)}>
          {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_WORD[c]}</option>)}
        </select>
      </Field>
      {x.channel === "alert_channel" ? (
        <Field label={t("Alert channel")}>
          <select className="nx-input" value={x.alert_channel_id} onChange={(e) => set("alert_channel_id", e.target.value)}>
            <option value="">{t("Choose the alert channel")}</option>
            {(channels.data ?? []).map((c) => <option key={c.id} value={c.id}>{`${c.kind}: ${c.target}`}</option>)}
          </select>
        </Field>
      ) : null}
      {x.channel === "webhook" ? <p className="nx-note">{t("Posted as the digest.sent event to every active webhook that subscribes to it, under Administration, Webhooks. The event carries the numbers only.")}</p> : null}
      {x.channel === "email" ? (
        <>
          <Field label={t("Email addresses")} error={errs.recipients} hint={t("One per line or separated by commas.")}>
            <textarea className="nx-input nx-jtext" rows={3} value={x.recipients} onChange={(e) => set("recipients", e.target.value)} />
          </Field>
          <fieldset className="nx-form">
            <legend className="nx-jh">{t("People")}</legend>
            {users.isPending ? (
              <Skeleton lines={2} label={t("People")} />
            ) : people.length === 0 ? (
              <p className="nx-sub">{t("No active user to choose.")}</p>
            ) : (
              <ul className="nx-pick" aria-label={t("People to send to")}>
                {people.map((u) => (
                  <li key={u.id}>
                    <label className="nx-row">
                      <input className="nx-check" type="checkbox" checked={x.users.includes(u.id)} onChange={() => set("users", x.users.includes(u.id) ? x.users.filter((y) => y !== u.id) : [...x.users, u.id])} />
                      <span className="nx-row-main">{u.name || u.email}</span>
                      <span className="nx-sub">{u.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </>
      ) : null}
      <label className="nx-row">
        <input className="nx-check" type="checkbox" checked={x.attach_pdf} disabled={x.channel === "webhook"} onChange={(e) => set("attach_pdf", e.target.checked)} />
        {t("Attach the digest as a PDF")}
      </label>
      <label className="nx-row">
        <input className="nx-check" type="checkbox" checked={x.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("Send on its schedule")}
      </label>
      <div className="nx-row">
        <Button variant="primary" loading={busy} loadingLabel={t("Saving…")} disabled={!ok} onClick={() => void save()}>{initial ? t("Save changes") : t("Add the digest")}</Button>
      </div>
    </div>
  );
}

function Preview({ d }: { d: Digest }) {
  const [view, setView] = useState<"email" | "numbers">("email");
  const htmlQ = useDigestHtml(d.id, view === "email");
  const num = useDigestNumbers(d.id, view === "numbers");
  return (
    <section className="nx-form" aria-label={t("Preview of {name}", { name: d.name })}>
      <p className="nx-sub">{t("As it would be sent now. Nothing is sent from here.")}</p>
      <SegmentedControl label={t("Show")} value={view} onChange={setView} items={[{ value: "email", label: t("The email") }, { value: "numbers", label: t("The numbers") }]} />
      {view === "email" ? (
        <QueryView loading={htmlQ.isPending} error={htmlQ.isError ? t("The preview could not be read.") : null} onRetry={() => void htmlQ.refetch()} empty={false} emptyHeading="" label={t("The email")}>
          <iframe className="nx-jframe nx-card" title={t("Email preview of {name}", { name: d.name })} sandbox="" srcDoc={htmlQ.data} data-testid="digest-iframe" />
        </QueryView>
      ) : (
        <QueryView loading={num.isPending} error={num.isError ? t("The numbers could not be read.") : null} onRetry={() => void num.refetch()} empty={false} emptyHeading="" label={t("The numbers")}>
          {num.data ? (
            <div className="nx-form" data-testid="digest-numbers">
              <p>{num.data.landscape.text}</p>
              <dl className="nx-jfacts">
                <dt className="nx-sub">{t("Objects")}</dt><dd>{int(num.data.landscape.objects)}</dd>
                <dt className="nx-sub">{t("Held under 85")}</dt><dd>{int(num.data.landscape.held_under_85)}</dd>
                <dt className="nx-sub">{t("Approvals waiting")}</dt><dd>{int(num.data.approvals_waiting)}</dd>
                <dt className="nx-sub">{t("SLA breaches")}</dt><dd>{int(num.data.sla_breaches)}</dd>
                <dt className="nx-sub">{t("Value at risk")}</dt><dd>{num.data.value_at_risk.total == null ? t("Not priced: no cost model") : `${num.data.currency} ${int(num.data.value_at_risk.total)}`}</dd>
                <dt className="nx-sub">{t("Waves")}</dt><dd>{num.data.waves.length ? num.data.waves.map((w) => `${w.name}: ${w.gate_open ? t("gate open") : t("gate closed")}`).join("; ") : "-"}</dd>
              </dl>
              {num.data.score_moves.length ? (
                <DataTable
                  caption={t("Score moves")}
                  rows={num.data.score_moves}
                  rowKey={(m) => `${m.system}:${m.module}`}
                  rowLabel={(m) => `${m.system}, ${m.module}`}
                  columns={[
                    { id: "o", label: t("Object"), cell: (m) => `${m.system}, ${m.module}` },
                    { id: "b", label: t("Before"), cell: (m) => m.before.toFixed(1), align: "end" },
                    { id: "a", label: t("After"), cell: (m) => m.after.toFixed(1), align: "end" },
                    { id: "c", label: t("Change"), cell: (m) => `${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)}`, align: "end" },
                  ]}
                />
              ) : null}
              <p className="nx-sub">{t("Built {when}", { when: formatDate(num.data.generated_at, "datetime") })}</p>
            </div>
          ) : null}
        </QueryView>
      )}
    </section>
  );
}

const TONE = { go: "good", "at-risk": "warn", "no-go": "bad" } as const;
const DELIVERY_COLUMNS: Column<DigestDelivery>[] = [
  { id: "w", get label() { return t("When"); }, cell: (x) => `${formatDate(x.finished_at ?? x.created_at, "datetime")}${x.manual ? ` ${t("sent by hand")}` : ""}` },
  { id: "s", get label() { return t("State"); }, cell: (x) => { const tone = deliveryTone(x.status); return <Chip tone={tone ? TONE[tone] : "neutral"}>{deliveryWord(x.status)}</Chip>; } },
  { id: "d", get label() { return t("Delivered"); }, cell: (x) => int(x.delivered), align: "end" },
  { id: "f", get label() { return t("Failed"); }, cell: (x) => int(x.failed), align: "end" },
  { id: "y", get label() { return t("Why"); }, cell: (x) => (x.reason === "sandbox" ? t("Sandbox mode: nothing leaves the deployment") : (x.reason ?? t("No note"))) },
];

function DigestView({ d, ctx }: { d: Digest; ctx: SheetCtx }) {
  const qc = useQueryClient();
  const toast = useToast();
  const waves = useWaves();
  const users = useUsers();
  const log = useDigestDeliveries(d.id);
  const [pane, setPane] = useState<"none" | "edit" | "preview">("none");
  const [removing, setRemoving] = useState(false);
  const { busy, run } = useSubmitGuard();
  const waveName = (id: string) => waves.data?.find((w) => w.id === id)?.name ?? null;
  const recipients = [...d.recipients, ...d.recipient_user_ids.map((id) => users.data?.users.find((u) => u.id === id)?.name ?? id)];
  const act = (job: () => Promise<void>) =>
    run(async () => {
      try {
        await job();
        await refreshStep10(qc, "digests");
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  const send = () =>
    act(async () => {
      const r = await sendDigestNow(d.id);
      if (r.status === "skipped") toast({ text: r.reason === "sandbox" ? t("Sandbox mode is on: nothing leaves the deployment. The delivery is logged as held back.") : `${t("Held back")}. ${r.reason ?? ""}` });
      else toast({ text: `${r.status === "sent" ? t("Digest sent") : t("Digest not sent")}. ${t("{delivered} delivered, {failed} failed.", { delivered: r.delivered, failed: r.failed })}`, tone: r.status === "sent" ? "good" : "bad" });
    });
  return (
    <div className="nx-form">
      <dl className="nx-jfacts" data-testid="digest-facts">
        <dt className="nx-sub">{t("For")}</dt><dd>{audienceWords(d, roleName, waveName)}</dd>
        <dt className="nx-sub">{t("Cadence")}</dt><dd>{t("{cadence}, {zone}", { cadence: describeCron(d.cron), zone: d.timezone })}</dd>
        <dt className="nx-sub">{t("Channel")}</dt><dd>{CHANNEL_WORD[d.channel] ?? d.channel}</dd>
        <dt className="nx-sub">{t("Recipients")}</dt><dd>{d.channel !== "email" ? t("This channel has no recipients of its own") : recipients.length ? recipients.join(", ") : d.audience === "role" ? t("Every active user holding the role") : t("No recipient")}</dd>
        <dt className="nx-sub">{t("PDF")}</dt><dd>{d.attach_pdf ? t("Attached") : t("Not attached")}</dd>
        <dt className="nx-sub">{t("State")}</dt><dd><Chip tone={d.enabled ? "good" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</Chip></dd>
        <dt className="nx-sub">{t("Last sent")}</dt><dd>{d.last_sent_at ? formatDate(d.last_sent_at, "datetime") : t("Never")}</dd>
        <dt className="nx-sub">{t("Next send")}</dt><dd>{d.next_run_at ? formatDate(d.next_run_at, "datetime") : d.enabled ? t("Not scheduled") : t("Paused")}</dd>
      </dl>
      <div className="nx-row nx-row-wrap">
        <Button variant="primary" loading={busy} loadingLabel={t("Sending…")} onClick={() => void send()}>{t("Send now")}</Button>
        <Button aria-pressed={pane === "preview"} onClick={() => setPane(pane === "preview" ? "none" : "preview")}>{t("Preview")}</Button>
        <Button disabled={busy} onClick={() => void act(async () => { await updateDigest(d.id, { enabled: !d.enabled }); toast({ text: d.enabled ? t("Digest paused") : t("Digest turned on"), tone: "good" }); })}>{d.enabled ? t("Pause") : t("Turn on")}</Button>
        <Button aria-expanded={pane === "edit"} onClick={() => setPane(pane === "edit" ? "none" : "edit")}>{t("Edit")}</Button>
        <Button variant="danger" onClick={() => setRemoving(true)}>{t("Delete")}</Button>
      </div>
      {pane === "edit" ? <DigestForm key={d.updated_at} initial={d} onSaved={() => setPane("none")} /> : null}
      {pane === "preview" ? <Preview d={d} /> : null}
      <DataTable caption={t("Delivery log")} rows={log.data?.deliveries ?? []} columns={DELIVERY_COLUMNS} rowKey={(x) => x.id} rowLabel={(x) => formatDate(x.created_at, "datetime")} loading={log.isPending} error={log.isError ? { sentence: t("The delivery log could not be read."), onRetry: () => void log.refetch() } : undefined} empty={{ heading: t("Delivery log"), text: t("Nothing has been sent yet. Send it now, or wait for its next slot.") }} />
      <Confirm
        open={removing}
        title={t("Delete {name}", { name: d.name })}
        consequence={t("It is not sent again and its delivery log goes with it.")}
        confirmLabel={t("Delete the digest")}
        danger
        onCancel={() => setRemoving(false)}
        onConfirm={() =>
          void act(async () => {
            await deleteDigest(d.id);
            setRemoving(false);
            toast({ text: t("Digest deleted"), tone: "good" });
            ctx.open({ kind: "digests", id: "" });
          })
        }
      />
    </div>
  );
}

export function DigestsSheet({ ctx }: { ctx: SheetCtx }) {
  const session = useV2Session();
  const allowed = session.can("manage_settings") || session.can("manage_digests");
  const q = useDigests(allowed);
  const id = ctx.id;
  const d = id && id !== "new" ? q.data?.digests.find((x) => x.id === id) : undefined;
  const rows = q.data?.digests ?? [];
  const title = id === "new" ? t("Add a digest") : d ? d.name : t("Digests");
  return (
    <Sheet open onClose={ctx.close} title={title} meta={id === "new" ? t("By role or by wave") : d ? (d.enabled ? t("On") : t("Paused")) : undefined} size="large" under={ctx.under}
      secondary={id ? <Button variant="secondary" onClick={() => ctx.open({ kind: "digests", id: "" })}>{t("Digests")}</Button> : <Button variant="secondary" onClick={ctx.close}>{t("Done")}</Button>}>
      {!allowed ? (
        <Denied what={t("Managing digests")} />
      ) : id === "new" ? (
        <DigestForm initial={null} onSaved={(x) => ctx.open({ kind: "digests", id: x.id })} />
      ) : id ? (
        <QueryView loading={q.isPending} error={q.isError ? t("The digest could not be read.") : null} onRetry={() => void q.refetch()} empty={!d} emptyHeading={t("This digest does not exist. It may have been deleted.")} label={t("Digest")}>
          {d ? <DigestView d={d} ctx={ctx} /> : null}
        </QueryView>
      ) : (
        <div className="nx-form">
          <p className="nx-sub">{t("{n} {n, plural, one {digest} other {digests}}. Each one sends the landscape sentence, the score moves, the waves and their gates, the approvals waiting, SLA breaches and the top value at risk, by email, to an alert channel or as a webhook event. Numbers only, never SAP values.", { n: rows.length })}</p>
          <div className="nx-row"><Button variant="primary" onClick={() => ctx.open({ kind: "digests", id: "new" })}>{t("Add a digest")}</Button></div>
          <QueryView loading={q.isPending} error={q.isError ? t("The digest could not be read.") : null} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("No digest yet. Add one for a role, such as the programme lead every Monday, or for a migration wave.")} label={t("Digests")}>
            <ul className="nx-pick" data-testid="digests-list">
              {rows.map((x) => (
                <li key={x.id} className="nx-row">
                  <div className="nx-row-main">
                    <Button variant="quiet" size={32} onClick={() => ctx.open({ kind: "digests", id: x.id })}>{x.name}</Button>
                    <div className="nx-sub">{`${audienceWords(x, roleName, () => null)}, ${describeCron(x.cron)}, ${CHANNEL_WORD[x.channel] ?? x.channel}`}</div>
                  </div>
                  <Chip tone={x.enabled ? "good" : "neutral"}>{x.enabled ? t("On") : t("Paused")}</Chip>
                </li>
              ))}
            </ul>
          </QueryView>
        </div>
      )}
    </Sheet>
  );
}

"use client";
/* Admin notify: Digests. Native port of DigestsSection (design/v2/admin/step10.tsx) and DigestInspector (design/v2/inspector/step10.tsx). */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDigest, deleteDigest, sendDigestNow, updateDigest, type Digest, type DigestBody, type DigestChannel } from "@/lib/api/v2/step10";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useChannels, useUsers, useWaves } from "@/lib/v2/admin-queries";
import { cronError, CUSTOM, describeCron, isPreset, PRESETS } from "@/lib/v2/cron";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { audienceWords, CHANNEL_WORD, deliveryTone, deliveryWord, emailOk, emailsFrom, zoneOk } from "@/lib/v2/step10";
import { refreshStep10, useDigestDeliveries, useDigestHtml, useDigestNumbers, useDigests } from "@/lib/v2/step10-queries";
import { ROLE_NAMES } from "@/lib/v2/view-as";
import { Button, Chip, Confirm, DataTable, EmptyState, ErrorState, SegmentedControl, Sheet, Skeleton, useToast } from "../kit";
import { Denied } from "../more/states";
import { Bad, Kv, NotifyBlock, NotifyPage, TONE } from "./notify-kit";

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

const Err = ({ text }: { text?: string }) => (text ? <span className="nx-notify-bad" role="alert">{text}</span> : null);

function DigestForm({ initial, onSaved }: { initial: Digest | null; onSaved: (d: Digest) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const waves = useWaves();
  const channels = useChannels();
  const users = useUsers();
  const [x, setX] = useState<Draft>(() => draftOf(initial));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setX((cur) => ({ ...cur, [k]: v }));
  const errs = problems(x);
  const ok = Object.keys(errs).length === 0;
  const people = (users.data?.users ?? []).filter((u) => u.is_active);
  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      const body = bodyOf(x);
      let saved: Digest;
      if (initial) {
        const before = bodyOf(draftOf(initial));
        const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof DigestBody]))) as Partial<DigestBody>;
        if (Object.keys(changed).length === 0) {
          toast({ text: t("Nothing to save") });
          return;
        }
        saved = await updateDigest(initial.id, changed);
      } else saved = await createDigest(body);
      await refreshStep10(qc, "digests");
      const next = saved.next_run_at ? t("Next send {when}.", { when: formatDate(saved.next_run_at, "datetime") }) : t("Paused: it is not sent until it is turned on.");
      toast({ tone: "good", text: `${initial ? t("Digest saved") : t("Digest added")}. ${next}` });
      onSaved(saved);
    } catch (e) {
      setFailed(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="nx-notify" data-testid="digest-form">
      <div className="nx-notify-form">
        <label className="nx-field nx-notify-wide">
          <span>{t("Name")}</span>
          <input className="nx-input" value={x.name} maxLength={200} onChange={(e) => set("name", e.target.value)} />
          <Err text={x.name ? errs.name : undefined} />
        </label>
        <div className="nx-notify-wide">
          <SegmentedControl label={t("For")} value={x.audience} onChange={(v) => set("audience", v)} items={[{ value: "role", label: t("A role") }, { value: "wave", label: t("A migration wave") }]} />
        </div>
        {x.audience === "role" ? (
          <label className="nx-field">
            <span>{t("Role")}</span>
            <select className="nx-input" value={x.role} onChange={(e) => set("role", e.target.value)}>
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>{roleName(r)}</option>
              ))}
            </select>
            <span className="nx-sub">{t("Without recipients, an email digest goes to every active user holding the role.")}</span>
          </label>
        ) : (
          <label className="nx-field">
            <span>{t("Wave")}</span>
            <select className="nx-input" value={x.wave_id} onChange={(e) => set("wave_id", e.target.value)}>
              <option value="">{t("Choose the wave")}</option>
              {(waves.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <Err text={errs.target} />
          </label>
        )}
        <label className="nx-field">
          <span>{t("Cadence")}</span>
          <select className="nx-input" value={x.custom ? CUSTOM : x.cron} onChange={(e) => (e.target.value === CUSTOM ? set("custom", true) : setX((cur) => ({ ...cur, custom: false, cron: e.target.value })))}>
            {PRESETS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {x.custom ? null : <span className="nx-sub">{describeCron(x.cron)}</span>}
        </label>
        {x.custom ? (
          <label className="nx-field">
            <span>{t("Cron expression")}</span>
            <input className="nx-input nx-mono" value={x.cron} onChange={(e) => set("cron", e.target.value)} placeholder="0 7 * * 1" />
            {errs.cron ? <Err text={errs.cron} /> : <span className="nx-sub">{t("Minute hour day month weekday, in the time zone below.")}</span>}
          </label>
        ) : null}
        <label className="nx-field">
          <span>{t("Time zone")}</span>
          <input className="nx-input" value={x.timezone} maxLength={64} onChange={(e) => set("timezone", e.target.value)} placeholder="Africa/Johannesburg" />
          <Err text={errs.timezone} />
        </label>
        <label className="nx-field">
          <span>{t("Channel")}</span>
          <select className="nx-input" value={x.channel} onChange={(e) => set("channel", e.target.value as DigestChannel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_WORD[c]}</option>
            ))}
          </select>
          <Err text={errs.channel} />
        </label>
        {x.channel === "alert_channel" ? (
          <label className="nx-field">
            <span>{t("Alert channel")}</span>
            <select className="nx-input" value={x.alert_channel_id} onChange={(e) => set("alert_channel_id", e.target.value)}>
              <option value="">{t("Choose the alert channel")}</option>
              {(channels.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{`${c.kind}: ${c.target}`}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {x.channel === "webhook" ? <p className="nx-note">{t("Posted as the digest.sent event to every active webhook that subscribes to it, under Administration, Webhooks. The event carries the numbers only.")}</p> : null}
      {x.channel === "email" ? (
        <>
          <label className="nx-field">
            <span>{t("Email addresses")}</span>
            <textarea className="nx-input" rows={3} value={x.recipients} onChange={(e) => set("recipients", e.target.value)} />
            {errs.recipients ? <Err text={errs.recipients} /> : <span className="nx-sub">{t("One per line or separated by commas.")}</span>}
          </label>
          <fieldset className="nx-field">
            <legend>{t("People")}</legend>
            {users.isPending ? (
              <Skeleton lines={2} label={t("People")} />
            ) : people.length === 0 ? (
              <p className="nx-sub">{t("No active user to choose.")}</p>
            ) : (
              <ul className="nx-notify-picks" aria-label={t("People to send to")}>
                {people.map((u) => (
                  <li key={u.id}>
                    <label className="nx-row">
                      <input type="checkbox" checked={x.users.includes(u.id)} onChange={() => set("users", x.users.includes(u.id) ? x.users.filter((y) => y !== u.id) : [...x.users, u.id])} />
                      <span>{u.name || u.email}</span>
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
        <input type="checkbox" checked={x.attach_pdf} disabled={x.channel === "webhook"} onChange={(e) => set("attach_pdf", e.target.checked)} />
        {t("Attach the digest as a PDF")}
      </label>
      <label className="nx-row">
        <input type="checkbox" checked={x.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        {t("Send on its schedule")}
      </label>
      {failed ? <Bad>{failed}</Bad> : null}
      <div className="nx-notify-actions">
        <Button variant="primary" disabled={!ok} loading={saving} loadingLabel={t("Saving…")} onClick={() => void save()}>
          {initial ? t("Save changes") : t("Add the digest")}
        </Button>
      </div>
    </div>
  );
}

function PreviewSheet({ d, onClose }: { d: Digest; onClose: () => void }) {
  const [view, setView] = useState<"email" | "numbers">("email");
  const htmlQ = useDigestHtml(d.id, view === "email");
  const num = useDigestNumbers(d.id, view === "numbers");
  return (
    <Sheet open onClose={onClose} title={t("Preview of {name}", { name: d.name })} size="large" secondary={<Button variant="secondary" onClick={onClose}>{t("Close")}</Button>}>
      <p className="nx-sub">{t("As it would be sent now. Nothing is sent from here.")}</p>
      <SegmentedControl label={t("Show")} value={view} onChange={setView} items={[{ value: "email", label: t("The email") }, { value: "numbers", label: t("The numbers") }]} />
      {view === "email" ? (
        htmlQ.isPending ? (
          <Skeleton lines={6} label={t("Preview")} />
        ) : htmlQ.isError ? (
          <ErrorState sentence={t("The preview could not be read.")} onRetry={() => void htmlQ.refetch()} />
        ) : (
          <iframe className="nx-notify-frame" title={t("Email preview of {name}", { name: d.name })} sandbox="" srcDoc={htmlQ.data} data-testid="digest-iframe" />
        )
      ) : num.isPending ? (
        <Skeleton lines={6} label={t("The numbers")} />
      ) : num.isError ? (
        <ErrorState sentence={t("The numbers could not be read.")} onRetry={() => void num.refetch()} />
      ) : (
        <div className="nx-notify" data-testid="digest-numbers">
          <p>{num.data.landscape.text}</p>
          <Kv
            rows={[
              [t("Objects"), int(num.data.landscape.objects)],
              [t("Held under 85"), int(num.data.landscape.held_under_85)],
              [t("Approvals waiting"), int(num.data.approvals_waiting)],
              [t("SLA breaches"), int(num.data.sla_breaches)],
              [t("Value at risk"), num.data.value_at_risk.total == null ? t("Not priced: no cost model") : `${num.data.currency} ${int(num.data.value_at_risk.total)}`],
              [t("Waves"), num.data.waves.length ? num.data.waves.map((w) => `${w.name}: ${w.gate_open ? t("gate open") : t("gate closed")}`).join("; ") : "—"],
            ]}
          />
          {num.data.score_moves.length ? (
            <DataTable
              caption={t("Score moves")}
              rows={num.data.score_moves}
              rowKey={(m) => `${m.system}:${m.module}`}
              rowLabel={(m) => `${m.system}, ${m.module}`}
              columns={[
                { id: "object", label: t("Object"), cell: (m) => `${m.system}, ${m.module}` },
                { id: "before", label: t("Before"), align: "end", cell: (m) => m.before.toFixed(1) },
                { id: "after", label: t("After"), align: "end", cell: (m) => m.after.toFixed(1) },
                { id: "delta", label: t("Change"), align: "end", cell: (m) => `${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)}` },
              ]}
            />
          ) : null}
          <p className="nx-sub">{t("Built {when}", { when: formatDate(num.data.generated_at, "datetime") })}</p>
        </div>
      )}
    </Sheet>
  );
}

function DeliveryLog({ d }: { d: Digest }) {
  const q = useDigestDeliveries(d.id);
  const rows = q.data?.deliveries ?? [];
  return (
    <>
      <h3 className="nx-notify-h3">{t("Delivery log")}</h3>
      <div data-testid="digest-deliveries">
        <DataTable
          caption={t("Deliveries of {name}", { name: d.name })}
          rows={rows}
          rowKey={(x) => x.id}
          rowLabel={(x) => formatDate(x.finished_at ?? x.created_at, "datetime")}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The delivery log could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("Nothing has been sent yet. Send it now, or wait for its next slot.") }}
          columns={[
            { id: "when", label: t("When"), cell: (x) => `${formatDate(x.finished_at ?? x.created_at, "datetime")}${x.manual ? ` ${t("sent by hand")}` : ""}` },
            {
              id: "state",
              label: t("State"),
              cell: (x) => {
                const tone = deliveryTone(x.status);
                return <Chip tone={tone ? TONE[tone] : "neutral"}>{deliveryWord(x.status)}</Chip>;
              },
            },
            { id: "delivered", label: t("Delivered"), align: "end", cell: (x) => int(x.delivered) },
            { id: "failed", label: t("Failed"), align: "end", cell: (x) => int(x.failed) },
            { id: "why", label: t("Why"), cell: (x) => (x.reason === "sandbox" ? t("Sandbox mode: nothing leaves the deployment") : (x.reason ?? t("No note"))) },
          ]}
        />
      </div>
    </>
  );
}

function DigestSheet({ d, onClose }: { d: Digest; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const waves = useWaves();
  const users = useUsers();
  const [preview, setPreview] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<"send" | "enabled" | "delete" | null>(null);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  const waveName = (id: string) => waves.data?.find((w) => w.id === id)?.name ?? null;
  const names = d.recipient_user_ids.map((id) => users.data?.users.find((u) => u.id === id)?.name ?? id);
  const recipients = [...d.recipients, ...names];
  const run = async (k: "send" | "enabled" | "delete", fn: () => Promise<void>) => {
    setPending(k);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ bad: true, text: apiErrorMessage(e) });
    } finally {
      setPending(null);
    }
  };
  const send = () =>
    run("send", async () => {
      const r = await sendDigestNow(d.id);
      await refreshStep10(qc, "digests");
      if (r.status === "skipped") {
        setNote({ bad: false, text: [t("Held back"), r.reason === "sandbox" ? t("Sandbox mode is on: nothing leaves the deployment. The delivery is logged as held back.") : r.reason].filter(Boolean).join(". ") });
        return;
      }
      const detail = [t("{delivered} delivered, {failed} failed.", { delivered: r.delivered, failed: r.failed }), r.reason].filter(Boolean).join(" ");
      setNote({ bad: r.status !== "sent", text: `${r.status === "sent" ? t("Digest sent") : t("Digest not sent")}. ${detail}` });
    });
  const toggle = () =>
    run("enabled", async () => {
      await updateDigest(d.id, { enabled: !d.enabled });
      await refreshStep10(qc, "digests");
      toast({ tone: "good", text: d.enabled ? t("Digest paused") : t("Digest turned on") });
    });
  const remove = () =>
    run("delete", async () => {
      await deleteDigest(d.id);
      await refreshStep10(qc, "digests");
      setRemoving(false);
      toast({ tone: "good", text: t("Digest deleted") });
      onClose();
    });
  const recipientText = d.channel !== "email" ? t("This channel has no recipients of its own") : recipients.length ? recipients.join(", ") : d.audience === "role" ? t("Every active user holding the role") : t("No recipient");
  return (
    <>
      <Sheet
        open
        onClose={onClose}
        under={preview}
        title={d.name}
        meta={<Chip tone={d.enabled ? "good" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</Chip>}
        size="large"
        primary={<Button variant="primary" disabled={pending !== null} loading={pending === "send"} loadingLabel={t("Sending…")} onClick={() => void send()}>{t("Send now")}</Button>}
        secondary={<Button variant="secondary" onClick={() => setPreview(true)}>{t("Preview")}</Button>}
      >
        <Kv
          rows={[
            [t("For"), audienceWords(d, roleName, waveName)],
            [t("Cadence"), t("{cadence}, {zone}", { cadence: describeCron(d.cron), zone: d.timezone })],
            [t("Channel"), CHANNEL_WORD[d.channel] ?? d.channel],
            [t("Recipients"), recipientText],
            [t("PDF"), d.attach_pdf ? t("Attached") : t("Not attached")],
            [t("State"), <Chip key="s" tone={d.enabled ? "good" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</Chip>],
            [t("Last sent"), d.last_sent_at ? formatDate(d.last_sent_at, "datetime") : t("Never")],
            [t("Next send"), d.next_run_at ? formatDate(d.next_run_at, "datetime") : d.enabled ? t("Not scheduled") : t("Paused")],
          ]}
        />
        {note ? (note.bad ? <Bad>{note.text}</Bad> : <p className="nx-note" role="status">{note.text}</p>) : null}
        <div className="nx-notify-actions">
          <Button variant="secondary" disabled={pending !== null} loading={pending === "enabled"} onClick={() => void toggle()}>{d.enabled ? t("Pause") : t("Turn on")}</Button>
          <Button variant="secondary" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>{t("Edit")}</Button>
          <Button variant="danger" onClick={() => setRemoving(true)}>{t("Delete")}</Button>
        </div>
        {editing ? <DigestForm key={d.updated_at} initial={d} onSaved={() => setEditing(false)} /> : null}
        <DeliveryLog d={d} />
        <Confirm
          open={removing}
          title={t("Delete {name}", { name: d.name })}
          consequence={t("It is not sent again and its delivery log goes with it.")}
          confirmLabel={t("Delete the digest")}
          danger
          onCancel={() => setRemoving(false)}
          onConfirm={() => void remove()}
        />
      </Sheet>
      {preview ? <PreviewSheet d={d} onClose={() => setPreview(false)} /> : null}
    </>
  );
}

/** Admin, Digests: the scheduled summaries by role or wave, their cadence, channel and last send. */
export function DigestsSection() {
  const can = useV2Session().can;
  const allowed = can("manage_settings") || can("manage_digests");
  const q = useDigests(allowed);
  const waves = useWaves(allowed);
  const [open, setOpen] = useState<string | null>(null);
  if (!allowed) return <Denied what={t("Managing digests")} />;
  const waveName = (id: string) => waves.data?.find((w) => w.id === id)?.name ?? null;
  const rows = q.data?.digests ?? [];
  const opened = open && open !== "new" ? rows.find((d) => d.id === open) : undefined;
  return (
    <NotifyPage
      lead={t("{n} {n, plural, one {digest} other {digests}}. Each one sends the landscape sentence, the score moves, the waves and their gates, the approvals waiting, SLA breaches and the top value at risk, by email, to an alert channel or as a webhook event. Numbers only, never SAP values.", { n: rows.length })}
      actions={<Button variant="primary" onClick={() => setOpen("new")}>{t("Add a digest")}</Button>}
    >
      <NotifyBlock title={t("Digests")}>
        {q.isError ? (
          <ErrorState sentence={t("The digests could not be read. {detail}", { detail: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <Skeleton lines={4} label={t("Digests")} />
        ) : rows.length === 0 ? (
          <EmptyState heading={t("No digest yet. Add one for a role, such as the programme lead every Monday, or for a migration wave.")} action={<Button variant="secondary" onClick={() => setOpen("new")}>{t("Add a digest")}</Button>}>{null}</EmptyState>
        ) : (
          <DataTable
            caption={t("Digests")}
            rows={rows}
            rowKey={(d) => d.id}
            rowLabel={(d) => d.name}
            onOpenRow={(d) => setOpen(d.id)}
            columns={[
              { id: "name", label: t("Name"), cell: (d) => <span>{d.name}<span className="nx-sub"> {audienceWords(d, roleName, waveName)}</span></span> },
              { id: "cadence", label: t("Cadence"), cell: (d) => t("{cadence}, {zone}", { cadence: describeCron(d.cron), zone: d.timezone }) },
              { id: "channel", label: t("Channel"), cell: (d) => CHANNEL_WORD[d.channel] ?? d.channel },
              { id: "sent", label: t("Last sent"), cell: (d) => `${d.last_sent_at ? t("Sent {when}", { when: formatDate(d.last_sent_at, "datetime") }) : t("Never sent")}${d.next_run_at ? `, ${t("next {when}", { when: formatDate(d.next_run_at, "datetime") })}` : ""}` },
              { id: "state", label: t("State"), cell: (d) => <Chip tone={d.enabled ? "good" : "neutral"}>{d.enabled ? t("On") : t("Paused")}</Chip> },
            ]}
          />
        )}
      </NotifyBlock>
      {open === "new" ? (
        <Sheet open onClose={() => setOpen(null)} title={t("Add a digest")} meta={<Chip>{t("By role or by wave")}</Chip>} size="large">
          <DigestForm initial={null} onSaved={(d) => setOpen(d.id)} />
        </Sheet>
      ) : null}
      {opened ? <DigestSheet key={opened.id} d={opened} onClose={() => setOpen(null)} /> : null}
    </NotifyPage>
  );
}

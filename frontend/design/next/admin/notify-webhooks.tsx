"use client";
/* Admin notify: Webhooks. Native port of WebhooksSection (design/v2/admin/webhooks.tsx) and the webhook and delivery inspectors (design/v2/inspector/webhook.tsx). */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWebhook, deleteWebhook, putAutomation, putChatAlerts, testChatAlerts, testWebhook, updateWebhook, type AutomationSettings, type ChatAlerts, type ChatEvent, type Webhook, type WebhookCreated, type WebhookDelivery, type WebhookEvent } from "@/lib/api/v2/step9";
import { writeClipboard } from "@/lib/browser";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { lc, t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { eventsWords, eventWord, WEBHOOK_PRESETS, type WebhookPreset } from "@/lib/v2/step9";
import { refreshStep9, useAutomation, useChatAlerts, useDeliveries, useWebhookEvents, useWebhooks } from "@/lib/v2/step9-queries";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, SegmentedControl, Sheet, Skeleton } from "../kit";
import { Denied } from "../more/states";
import { Bad, Kv, NotifyBlock, NotifyLoaded, NotifyPage } from "./notify-kit";

const MAX_ATTEMPTS = 5;
type DStatus = WebhookDelivery["status"];
const statusWord = (s: DStatus): string => (s === "pending" ? t("Waiting") : s === "retrying" ? t("Retrying") : s === "delivered" ? t("Delivered") : t("Failed"));
const STATUS_TONE: Record<DStatus, "good" | "warn" | "bad" | "neutral"> = { pending: "neutral", retrying: "warn", delivered: "good", failed: "bad" };
const attemptsWords = (n: number): string => t("{n} of {max}", { n, max: MAX_ATTEMPTS });
const urlOk = (u: string): boolean => /^https:\/\/\S{4,}$/.test(u.trim()); // i18n-ignore
const URL_ERROR = (): string => t("The URL must start with https://.");

type Outcome = { bad: boolean; title: string; detail?: string } | null;
function OutcomeNote({ o }: { o: Outcome }) {
  if (!o) return null;
  const text = o.detail ? `${o.title}. ${o.detail}` : o.title;
  return o.bad ? <Bad>{text}</Bad> : <p className="nx-note" role="status">{text}</p>;
}
/** Runs one action at a time; an API failure becomes the outcome sentence. */
function useRun() {
  const [pending, setPending] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const run = async (k: string, fn: () => Promise<Outcome>) => {
    setPending(k);
    setOutcome(null);
    try {
      setOutcome(await fn());
    } catch (e) {
      setOutcome({ bad: true, title: apiErrorMessage(e) });
    } finally {
      setPending(null);
    }
  };
  return { pending, outcome, run };
}

const Status = ({ s }: { s: DStatus }) => <Chip tone={STATUS_TONE[s]}>{statusWord(s)}</Chip>;

function Toggle({ checked, disabled, onChange, label, hint }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="nx-row">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <span className="nx-sub"> {hint}</span> : null}
      </span>
    </label>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      {children}
      {error ? <span className="nx-notify-bad" role="alert">{error}</span> : hint ? <span className="nx-sub">{hint}</span> : null}
    </label>
  );
}

/** The events a webhook can subscribe to, as checkboxes. "Every event" stands alone. */
function EventPicker({ events, chosen, set }: { events: readonly WebhookEvent[]; chosen: readonly WebhookEvent[]; set: (next: WebhookEvent[]) => void }) {
  const every = chosen.includes("*");
  const toggle = (e: WebhookEvent) => set(chosen.includes(e) ? chosen.filter((x) => x !== e) : [...chosen.filter((x) => x !== "*"), e]);
  return (
    <fieldset className="nx-field">
      <legend>{t("Events")}</legend>
      <ul className="nx-notify-picks">
        <li>
          <label className="nx-row">
            <input type="checkbox" checked={every} onChange={() => set(every ? [] : ["*"])} />
            {eventWord("*")}
          </label>
        </li>
        {events
          .filter((e) => e !== "*")
          .map((e) => (
            <li key={e}>
              <label className="nx-row">
                <input type="checkbox" checked={every || chosen.includes(e)} disabled={every} onChange={() => toggle(e)} />
                <Code code={e} text={eventWord(e)} />
              </label>
            </li>
          ))}
      </ul>
    </fieldset>
  );
}

function NewWebhookSheet({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const events = useWebhookEvents().data?.events ?? [];
  const [preset, setPreset] = useState<WebhookPreset["id"]>("slack");
  const p = WEBHOOK_PRESETS.find((x) => x.id === preset) ?? WEBHOOK_PRESETS[0];
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<WebhookEvent[]>([...WEBHOOK_PRESETS[0].events]);
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const { outcome, pending, run } = useRun();
  const urlBad = url.trim() !== "" && !urlOk(url);
  const choose = (id: WebhookPreset["id"]) => {
    const next = WEBHOOK_PRESETS.find((x) => x.id === id) ?? WEBHOOK_PRESETS[0];
    setPreset(id);
    setChosen([...next.events]);
    if (!description.trim() || WEBHOOK_PRESETS.some((x) => x.label === description)) setDescription(next.id === "custom" ? "" : next.label);
  };
  if (created) {
    // The secret lives only in this component state: shown once, never logged, gone when the sheet closes.
    return (
      <Sheet open onClose={onClose} title={t("Webhook added")} meta={created.url}>
        <p className="nx-note">{t("The signing secret is shown this once. Keep it where the receiver checks the X-Meridian-Signature header; Meridian never shows it again.")}</p>
        <p className="nx-mono nx-notify-pre" data-testid="webhook-secret">{created.secret}</p>
        <div className="nx-notify-actions">
          <Button variant="secondary" onClick={() => void writeClipboard(created.secret).then(setCopied)}>{copied ? t("Copied") : t("Copy the secret")}</Button>
          <Button variant="primary" onClick={() => onOpen(created.id)}>{t("Open the webhook")}</Button>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("Add a webhook")}
      meta={t("Signed JSON events")}
      dirty={url.trim() !== ""}
      primary={
        <Button
          variant="primary"
          disabled={!url.trim() || urlBad || chosen.length === 0 || pending !== null}
          loading={pending === "create"}
          loadingLabel={t("Adding…")}
          onClick={() =>
            void run("create", async () => {
              const r = await createWebhook({ url: url.trim(), events: chosen, description: description.trim() || null, active: true });
              await refreshStep9(qc, "webhooks");
              setCreated(r);
              return { bad: false, title: t("Webhook added") };
            })
          }
        >
          {t("Add the webhook")}
        </Button>
      }
    >
      <SegmentedControl label={t("Preset")} value={preset} onChange={choose} items={WEBHOOK_PRESETS.map((x) => ({ value: x.id, label: x.label }))} />
      <p className="nx-note">{p.hint}</p>
      <div className="nx-notify-form">
        <Field label={t("URL")} error={urlBad ? URL_ERROR() : null}>
          <input className="nx-input" type="url" value={url} placeholder={p.placeholder} onChange={(e) => setUrl(e.target.value)} aria-invalid={urlBad || undefined} />
        </Field>
        <Field label={t("Description (optional)")}>
          <input className="nx-input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      <EventPicker events={events} chosen={chosen} set={setChosen} />
      <OutcomeNote o={outcome} />
    </Sheet>
  );
}

function DeliveryLog({ w, onOpen }: { w: Webhook; onOpen: (d: WebhookDelivery) => void }) {
  const [status, setStatus] = useState<DStatus | "all">("all");
  const q = useDeliveries(w.id, status === "all" ? null : status);
  const filters: (DStatus | "all")[] = ["all", "delivered", "retrying", "failed", "pending"];
  const rows = q.data?.deliveries ?? [];
  return (
    <>
      <h3 className="nx-notify-h3">{t("Delivery log")}</h3>
      <SegmentedControl label={t("Show deliveries")} value={status} onChange={setStatus} items={filters.map((f) => ({ value: f, label: f === "all" ? t("All") : statusWord(f) }))} />
      {q.data && q.data.total > rows.length ? <p className="nx-sub" data-testid="delivery-log-cap">{t("The first {n} of {total}", { n: int(rows.length), total: int(q.data.total) })}</p> : null}
      <div data-testid="delivery-log">
        <DataTable
          caption={t("Deliveries to {host}", { host: w.url })}
          rows={rows}
          rowKey={(d) => d.id}
          rowLabel={(d) => eventWord(d.event)}
          onOpenRow={onOpen}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The delivery log could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: status !== "all" ? t("No {state} delivery.", { state: lc(statusWord(status)) }) : t("Nothing has been sent yet. Send a test event, or wait for the first event this webhook subscribes to.") }}
          columns={[
            { id: "event", label: t("Event"), cell: (d) => <Code code={d.event} text={eventWord(d.event)} /> },
            { id: "state", label: t("State"), cell: (d) => <Status s={d.status} /> },
            { id: "attempts", label: t("Attempts"), align: "end", cell: (d) => attemptsWords(d.attempts) },
            { id: "answer", label: t("Answer"), align: "end", cell: (d) => d.response_code ?? <span title={t("No answer was received")}>—</span> },
            { id: "when", label: t("When"), cell: (d) => formatDate(d.last_attempt_at ?? d.created_at, "datetime") },
          ]}
        />
      </div>
    </>
  );
}

function DeliverySheet({ w, d, onClose }: { w: Webhook; d: WebhookDelivery; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={eventWord(d.event)} meta={<Status s={d.status} />}>
      <Kv
        rows={[
          [t("Webhook"), <span key="w" className="nx-mono">{w.url}</span>],
          [t("Event"), <Code key="e" code={d.event} text={eventWord(d.event)} />],
          [t("State"), <Status key="s" s={d.status} />],
          [t("Attempts"), attemptsWords(d.attempts)],
          [t("Answer"), d.response_code ?? t("No answer was received")],
          [t("Error"), d.error ?? t("No error")],
          [t("Queued"), formatDate(d.created_at, "datetime")],
          [t("Last attempt"), d.last_attempt_at ? formatDate(d.last_attempt_at, "datetime") : t("Not attempted yet")],
          [t("Next attempt"), d.next_attempt_at ? formatDate(d.next_attempt_at, "datetime") : d.status === "retrying" || d.status === "pending" ? t("Not scheduled") : t("No more attempts")],
          [t("Delivered"), d.delivered_at ? formatDate(d.delivered_at, "datetime") : t("Not delivered")],
        ]}
      />
      <p className="nx-note">{t("A 2xx answer delivers an event. Anything else is retried 1, 2, 4 and 8 minutes after attempts 1 to 4 and marked failed after the fifth. The body carries ids, names and numbers only.")}</p>
    </Sheet>
  );
}

function WebhookSheet({ w, onClose }: { w: Webhook; onClose: () => void }) {
  const qc = useQueryClient();
  const events = useWebhookEvents().data?.events ?? [];
  const [chosen, setChosen] = useState<WebhookEvent[]>(w.events);
  const [description, setDescription] = useState(w.description ?? "");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [removing, setRemoving] = useState(false);
  const [delivery, setDelivery] = useState<WebhookDelivery | null>(null);
  const { outcome, pending, run } = useRun();
  const sameEvents = chosen.length === w.events.length && chosen.every((e) => w.events.includes(e));
  const urlBad = url.trim() !== "" && !urlOk(url);
  const secretBad = secret !== "" && secret.length < 16;
  const dirty = !sameEvents || description !== (w.description ?? "") || url.trim() !== "" || secret !== "";
  const save = () =>
    void run("save", async () => {
      await updateWebhook(w.id, { ...(sameEvents ? {} : { events: chosen }), ...(description !== (w.description ?? "") ? { description } : {}), ...(url.trim() ? { url: url.trim() } : {}), ...(secret ? { secret } : {}) });
      await refreshStep9(qc, "webhooks");
      const rotated = secret !== "";
      setUrl("");
      setSecret("");
      return { bad: false, title: t("Webhook saved"), detail: rotated ? t("The new secret signs every delivery from now on.") : undefined };
    });
  return (
    <>
      <Sheet open onClose={onClose} under={delivery !== null} title={t("Webhook to {host}", { host: w.url })} meta={<Chip tone={w.active ? "good" : "neutral"}>{w.active ? t("Active") : t("Paused")}</Chip>} size="large" dirty={dirty}>
        <Kv
          rows={[
            [t("Sends to"), <span key="u" className="nx-mono">{w.url}</span>],
            [t("State"), <Chip key="s" tone={w.active ? "good" : "neutral"}>{w.active ? t("Active") : t("Paused")}</Chip>],
            [t("Events"), eventsWords(w.events)],
            [t("Added"), formatDate(w.created_at, "datetime")],
            [t("Changed"), w.updated_at ? formatDate(w.updated_at, "datetime") : t("Not changed since it was added")],
          ]}
        />
        <OutcomeNote o={outcome} />
        <div className="nx-notify-actions">
          <Button
            variant="primary"
            disabled={pending !== null}
            loading={pending === "test"}
            loadingLabel={t("Sending…")}
            onClick={() =>
              void run("test", async () => {
                const r = await testWebhook(w.id);
                await refreshStep9(qc, "webhooks");
                return { bad: r.status !== "delivered", title: r.status === "delivered" ? t("Test event delivered") : t("Test event {state}", { state: lc(statusWord(r.status)) }), detail: r.response_code ? t("The endpoint answered {code}.", { code: r.response_code }) : (r.error ?? undefined) };
              })
            }
          >
            {t("Send a test event")}
          </Button>
          <Button
            variant="secondary"
            disabled={pending !== null}
            loading={pending === "active"}
            onClick={() =>
              void run("active", async () => {
                await updateWebhook(w.id, { active: !w.active });
                await refreshStep9(qc, "webhooks");
                return { bad: false, title: w.active ? t("Webhook paused") : t("Webhook enabled"), detail: w.active ? t("Events are not sent while it is paused.") : undefined };
              })
            }
          >
            {w.active ? t("Pause") : t("Enable")}
          </Button>
          <Button variant="quiet" onClick={() => setRemoving(true)}>{t("Delete")}</Button>
        </div>
        <h3 className="nx-notify-h3">{t("Edit")}</h3>
        <div className="nx-notify-form">
          <Field label={t("New URL (optional)")} error={urlBad ? URL_ERROR() : null}>
            <input className="nx-input" type="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} aria-invalid={urlBad || undefined} />
          </Field>
          <Field label={t("Description")}>
            <input className="nx-input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label={t("New signing secret (optional, 16 characters or more)")}>
            <input className="nx-input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} aria-invalid={secretBad || undefined} />
          </Field>
        </div>
        <EventPicker events={events} chosen={chosen} set={setChosen} />
        <div className="nx-notify-actions">
          <Button variant="secondary" disabled={!dirty || urlBad || secretBad || chosen.length === 0 || pending !== null} loading={pending === "save"} loadingLabel={t("Saving…")} onClick={save}>
            {t("Save changes")}
          </Button>
        </div>
        <DeliveryLog w={w} onOpen={setDelivery} />
        <Confirm
          open={removing}
          title={t("Delete the webhook to {host}", { host: w.url })}
          consequence={t("No event is sent to it again and its delivery log goes with it.")}
          confirmLabel={t("Delete the webhook")}
          danger
          onCancel={() => setRemoving(false)}
          onConfirm={() =>
            void run("delete", async () => {
              await deleteWebhook(w.id);
              await refreshStep9(qc, "webhooks");
              setRemoving(false);
              onClose();
              return { bad: false, title: t("Webhook deleted") };
            })
          }
        />
      </Sheet>
      {delivery ? <DeliverySheet w={w} d={delivery} onClose={() => setDelivery(null)} /> : null}
    </>
  );
}

/** The tenant's automation: drift alerts on or off, how many repeated fixes make a learned rule, the score drop alert. */
function Automation({ a, can }: { a: AutomationSettings; can: boolean }) {
  const qc = useQueryClient();
  const [drift, setDrift] = useState(a.drift_alerts.enabled);
  const [min, setMin] = useState(String(a.rule_mining.min_records));
  const [points, setPoints] = useState(a.score_drop.points == null ? "" : String(a.score_drop.points));
  const [below, setBelow] = useState(a.score_drop.below == null ? "" : String(a.score_drop.below));
  const { outcome, pending, run } = useRun();
  const minN = Number(min);
  const minBad = !Number.isInteger(minN) || minN < 2 || minN > 100000;
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const badScore = (v: string) => v.trim() !== "" && !(Number(v) >= 0 && Number(v) <= 100);
  const dirty = drift !== a.drift_alerts.enabled || min !== String(a.rule_mining.min_records) || points !== (a.score_drop.points == null ? "" : String(a.score_drop.points)) || below !== (a.score_drop.below == null ? "" : String(a.score_drop.below));
  return (
    <>
      <Toggle checked={drift} disabled={!can} onChange={setDrift} label={t("Config drift alerts")} hint={t("After a configuration load or sync, tell the owners of the objects whose rules read a changed table, and re-score them.")} />
      <div className="nx-notify-form">
        <Field label={t("Repeated fixes that make a learned rule")} hint={t("The same fix in this many records proposes a rule. From 2.")} error={minBad ? t("A whole number from 2 to 100,000.") : null}>
          <input className="nx-input" type="number" min={2} value={min} disabled={!can} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <Field label={t("Alert when a score drops by points")} hint={t("Empty: no alert on the size of a drop.")} error={badScore(points) ? t("From 0 to 100.") : null}>
          <input className="nx-input" type="number" min={0} max={100} value={points} disabled={!can} onChange={(e) => setPoints(e.target.value)} />
        </Field>
        <Field label={t("Alert when a score falls below")} hint={t("Empty: no alert on a floor.")} error={badScore(below) ? t("From 0 to 100.") : null}>
          <input className="nx-input" type="number" min={0} max={100} value={below} disabled={!can} onChange={(e) => setBelow(e.target.value)} />
        </Field>
      </div>
      <OutcomeNote o={outcome} />
      {can ? (
        <div className="nx-notify-actions">
          <Button
            variant="primary"
            disabled={!dirty || minBad || badScore(points) || badScore(below) || pending !== null}
            loading={pending === "save"}
            loadingLabel={t("Saving…")}
            onClick={() =>
              void run("save", async () => {
                await putAutomation({ drift_alerts: { enabled: drift }, rule_mining: { min_records: minN }, score_drop: { points: num(points), below: num(below) } });
                await refreshStep9(qc, "automation");
                return { bad: false, title: t("Automation saved") };
              })
            }
          >
            {t("Save automation")}
          </Button>
        </div>
      ) : (
        <p className="nx-note">{t("Changing these needs the manage settings permission.")}</p>
      )}
    </>
  );
}

const chatEventWords = (): Record<ChatEvent, [string, string]> => ({
  dqs_drop: [t("Score drops"), t("An object's score falls past the automation thresholds below.")],
  threshold_breach: [t("New threshold breaches"), t("A run breaks a contract or rule threshold it did not break before.")],
  run_failed: [t("Failed runs"), t("A run ends in error.")],
  sla_breach: [t("SLA breaches"), t("The SLA sweep finds work past its acknowledge or resolve time.")],
  firewall_rejections: [t("Firewall rejections"), t("The data quality firewall blocks records at entry. At most one message per object every 15 minutes.")],
});

/** Chat alerts: the Slack and Teams URLs live in the server environment only, so this shows whether each is set, which events go to chat, and sends a test. */
function ChatAlertsBlock({ c, can }: { c: ChatAlerts; can: boolean }) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<ChatEvent[]>(c.events);
  const { outcome, pending, run } = useRun();
  const words = chatEventWords();
  const any = c.channels.slack || c.channels.teams;
  const dirty = events.join() !== c.events.join();
  const toggle = (e: ChatEvent, on: boolean) => setEvents(c.available.filter((x) => (x === e ? on : events.includes(x))));
  const configured = (on: boolean) => <Chip tone={on ? "good" : "neutral"}>{on ? t("Configured") : t("Not configured")}</Chip>;
  return (
    <>
      <Kv rows={[[t("Slack"), configured(c.channels.slack)], [t("Microsoft Teams"), configured(c.channels.teams)]]} />
      {any ? null : <p className="nx-note">{t("Set MERIDIAN_SLACK_WEBHOOK_URL or MERIDIAN_TEAMS_WEBHOOK_URL in the server environment and restart Meridian. The address is a secret and is never shown here.")}</p>}
      <ul className="nx-notify-list">
        {c.available.map((e) => (
          <li key={e}>
            <Toggle checked={events.includes(e)} disabled={!can} onChange={(on) => toggle(e, on)} label={words[e]?.[0] ?? e} hint={words[e]?.[1]} />
          </li>
        ))}
      </ul>
      <OutcomeNote o={outcome} />
      {can ? (
        <div className="nx-notify-actions">
          <Button
            variant="primary"
            disabled={!dirty || pending !== null}
            loading={pending === "save"}
            loadingLabel={t("Saving…")}
            onClick={() =>
              void run("save", async () => {
                await putChatAlerts(events);
                await refreshStep9(qc, "automation");
                return { bad: false, title: t("Chat alerts saved") };
              })
            }
          >
            {t("Save chat alerts")}
          </Button>
          <Button
            variant="secondary"
            disabled={!any || pending !== null}
            loading={pending === "test"}
            loadingLabel={t("Sending…")}
            onClick={() =>
              void run("test", async () => {
                const r = await testChatAlerts();
                const sent = (["slack", "teams"] as const).filter((k) => r.channels[k].delivered);
                const failed = (["slack", "teams"] as const).filter((k) => r.channels[k].configured && !r.channels[k].delivered);
                return failed.length
                  ? { bad: true, title: t("The test did not reach every channel"), detail: failed.map((k) => `${k}: ${r.channels[k].error ?? "—"}`).join("; ") }
                  : { bad: false, title: t("Test sent to {n, plural, one {# channel} other {# channels}}", { n: sent.length }) };
              })
            }
          >
            {t("Send a test message")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/** Admin, Webhooks: where Meridian posts its events, the delivery log behind each, chat alerts and the tenant's automation. */
export function WebhooksSection() {
  const can = useV2Session().can;
  const allowed = can("manage_settings");
  const q = useWebhooks(allowed);
  const auto = useAutomation();
  const chat = useChatAlerts();
  const [open, setOpen] = useState<string | null>(null);
  if (!allowed) return <Denied what={t("Managing webhooks")} />;
  const rows = q.data?.webhooks ?? [];
  const active = rows.filter((w) => w.active).length;
  const opened = open && open !== "new" ? rows.find((w) => w.id === open) : undefined;
  const add = <Button variant="primary" onClick={() => setOpen("new")}>{t("Add a webhook")}</Button>;
  return (
    <NotifyPage
      lead={t("{n} active {n, plural, one {webhook} other {webhooks}}. Meridian posts a signed JSON event to each when it happens: ids, names and numbers, never SAP values. A failed post is retried 1, 2, 4 and 8 minutes later and marked failed after 5 attempts.", { n: active })}
      actions={add}
    >
      <NotifyBlock title={t("Webhooks")}>
        {q.isError ? (
          <ErrorState sentence={t("The webhooks could not be read. {detail}", { detail: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />
        ) : q.isPending ? (
          <Skeleton lines={4} label={t("Webhooks")} />
        ) : rows.length === 0 ? (
          <EmptyState heading={t("Webhooks")} action={<Button variant="secondary" onClick={() => setOpen("new")}>{t("Add a webhook")}</Button>}>
            {t("No webhook yet. Add one with the URL of a Slack or Teams workflow, or any https endpoint, and the events it should receive.")}
          </EmptyState>
        ) : (
          <DataTable
            caption={t("Webhooks")}
            rows={rows}
            rowKey={(w) => w.id}
            rowLabel={(w) => w.url}
            onOpenRow={(w) => setOpen(w.id)}
            columns={[
              { id: "host", label: t("Sends to"), cell: (w) => <span className="nx-mono">{w.url}</span> },
              { id: "events", label: t("Events"), cell: (w) => eventsWords(w.events) },
              { id: "state", label: t("State"), cell: (w) => <Chip tone={w.active ? "good" : "neutral"}>{w.active ? t("Active") : t("Paused")}</Chip> },
              { id: "about", label: t("Description"), cell: (w) => w.description ?? "—" },
              { id: "added", label: t("Added"), cell: (w) => formatDate(w.created_at, "date") },
            ]}
          />
        )}
      </NotifyBlock>
      <NotifyBlock title={t("Chat alerts")} hint={t("Counts and a link into Meridian go to a Slack or Teams channel, never record values.")}>
        <NotifyLoaded q={chat} what={t("The chat alert settings")}>{(c) => <ChatAlertsBlock key={JSON.stringify(c)} c={c} can={allowed} />}</NotifyLoaded>
      </NotifyBlock>
      <NotifyBlock title={t("Automation")} hint={t("What Meridian does by itself after a configuration change, from stewards' fixes and when a score drops.")}>
        <NotifyLoaded q={auto} what={t("The automation settings")}>{(a) => <Automation key={JSON.stringify(a)} a={a} can={allowed} />}</NotifyLoaded>
      </NotifyBlock>
      {open === "new" ? <NewWebhookSheet onClose={() => setOpen(null)} onOpen={setOpen} /> : null}
      {opened ? <WebhookSheet key={`${opened.id}:${opened.updated_at ?? ""}:${opened.active}`} w={opened} onClose={() => setOpen(null)} /> : null}
    </NotifyPage>
  );
}

"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWebhook, deleteWebhook, testWebhook, updateWebhook, type Webhook, type WebhookCreated, type WebhookDelivery, type WebhookEvent } from "@/lib/api/v2/step9";
import { writeClipboard } from "@/lib/browser";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { lc, t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { eventsWords, eventWord, WEBHOOK_PRESETS, type WebhookPreset } from "@/lib/v2/step9";
import { refreshStep9, useDeliveries, useWebhookEvents, useWebhooks } from "@/lib/v2/step9-queries";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton, type Column } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Field, NeedsPermission, Result, useOutcome } from "./reports-kit";

const MAX_ATTEMPTS = 5;
type Status = WebhookDelivery["status"];
const statusWord = (s: Status): string => (s === "pending" ? t("Waiting") : s === "retrying" ? t("Retrying") : s === "delivered" ? t("Delivered") : t("Failed"));
const STATUS_TONE: Record<Status, "good" | "warn" | "bad" | "neutral"> = { pending: "neutral", retrying: "warn", delivered: "good", failed: "bad" };
const attemptsWords = (n: number): string => t("{n} of {max}", { n, max: MAX_ATTEMPTS });
const urlOk = (u: string): boolean => /^https:\/\/\S{4,}$/.test(u.trim()); // i18n-ignore
const URL_ERROR = (): string => t("The URL must start with https://.");

function DeliveryStatus({ d }: { d: Pick<WebhookDelivery, "status"> }) {
  return <Chip tone={STATUS_TONE[d.status]}>{statusWord(d.status)}</Chip>;
}

/** The events a webhook can subscribe to, as checkboxes. "Every event" stands alone. */
function EventPicker({ events, chosen, set, disabled }: { events: readonly WebhookEvent[]; chosen: readonly WebhookEvent[]; set: (next: WebhookEvent[]) => void; disabled?: boolean }) {
  const every = chosen.includes("*");
  const toggle = (e: WebhookEvent) => set(chosen.includes(e) ? chosen.filter((x) => x !== e) : [...chosen.filter((x) => x !== "*"), e]);
  return (
    <fieldset className="nx-rp-set">
      <legend className="nx-rp-h">{t("Events")}</legend>
      <ul className="nx-rp-pick">
        <li>
          <label>
            <input type="checkbox" className="nx-check" checked={every} disabled={disabled} onChange={() => set(every ? [] : ["*"])} />
            <span>{eventWord("*")}</span>
          </label>
        </li>
        {events
          .filter((e) => e !== "*")
          .map((e) => (
            <li key={e}>
              <label>
                <input type="checkbox" className="nx-check" checked={every || chosen.includes(e)} disabled={disabled || every} onChange={() => toggle(e)} />
                <Code code={e} text={eventWord(e)} />
              </label>
            </li>
          ))}
      </ul>
    </fieldset>
  );
}

/** `?open=webhook:new`: the URL, the events and the description; a preset fills the events for Slack or Teams. */
function NewWebhook({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const ev = useWebhookEvents();
  const events = ev.data?.events ?? [];
  const [preset, setPreset] = useState<WebhookPreset["id"]>("slack");
  const p = WEBHOOK_PRESETS.find((x) => x.id === preset) ?? WEBHOOK_PRESETS[0];
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<WebhookEvent[]>([...WEBHOOK_PRESETS[0].events]);
  // The secret lives in component state only: shown once, never logged or stored.
  const [created, setCreated] = useState<WebhookCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const urlBad = url.trim() !== "" && !urlOk(url);
  const choose = (id: WebhookPreset["id"]) => {
    const next = WEBHOOK_PRESETS.find((x) => x.id === id) ?? WEBHOOK_PRESETS[0];
    setPreset(id);
    setChosen([...next.events]);
    if (!description.trim() || WEBHOOK_PRESETS.some((x) => x.label === description)) setDescription(next.id === "custom" ? "" : next.label);
  };
  if (created) {
    return (
      <InspectorFrame title={t("Webhook added")} status={created.url} onClose={onClose}>
        <p className="nx-rp-sub">{t("The signing secret is shown this once. Keep it where the receiver checks the X-Meridian-Signature header; Meridian never shows it again.")}</p>
        <p className="nx-rp-secret" data-testid="webhook-secret">
          {created.secret}
        </p>
        <Actions>
          <Button onClick={() => void writeClipboard(created.secret).then(setCopied)}>{copied ? t("Copied") : t("Copy the secret")}</Button>
          <Button variant="primary" onClick={() => openItem({ kind: "webhook", id: created.id })}>
            {t("Open the webhook")}
          </Button>
        </Actions>
      </InspectorFrame>
    );
  }
  return (
    <InspectorFrame title={t("Add a webhook")} status={t("Signed JSON events")} onClose={onClose}>
      <SegmentedControl label={t("Preset")} items={WEBHOOK_PRESETS.map((x) => ({ value: x.id, label: x.label }))} value={preset} onChange={choose} />
      <p className="nx-rp-sub">{p.hint}</p>
      <div className="nx-rp-form">
        <Field label={t("URL")} error={urlBad ? URL_ERROR() : undefined}>
          <input className="nx-input" type="url" value={url} placeholder={p.placeholder} onChange={(e) => setUrl(e.target.value)} aria-invalid={urlBad || undefined} />
        </Field>
        <Field label={t("Description (optional)")}>
          <input className="nx-input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      {ev.isPending ? <Skeleton lines={3} /> : ev.isError ? <ErrorState error={ev.error} onRetry={() => void ev.refetch()} /> : <EventPicker events={events} chosen={chosen} set={setChosen} />}
      <Result outcome={outcome} />
      <Actions>
        <Button
          variant="primary"
          loading={pending === "create"}
          loadingLabel={t("Adding…")}
          disabled={!url.trim() || urlBad || chosen.length === 0 || pending !== null}
          onClick={() =>
            void run("create", async () => {
              const r = await createWebhook({ url: url.trim(), events: chosen, description: description.trim() || null, active: true });
              await refreshStep9(qc, "webhooks");
              setCreated(r);
              return { tone: "ok", title: t("Webhook added") };
            })
          }
        >
          {t("Add the webhook")}
        </Button>
      </Actions>
    </InspectorFrame>
  );
}

type Filter = Status | "all";

function DeliveryLog({ w }: { w: Webhook }) {
  const [filter, setFilter] = useState<Filter>("all");
  const status = filter === "all" ? null : filter;
  const q = useDeliveries(w.id, status);
  const { openItem } = useOpenItem();
  const filters: Filter[] = ["all", "delivered", "retrying", "failed", "pending"];
  const columns: Column<WebhookDelivery>[] = [
    { id: "event", label: t("Event"), cell: (d) => <Code code={d.event} text={eventWord(d.event)} /> },
    { id: "state", label: t("State"), cell: (d) => <DeliveryStatus d={d} /> },
    { id: "attempts", label: t("Attempts"), align: "end", cell: (d) => attemptsWords(d.attempts) },
    { id: "answer", label: t("Answer"), align: "end", cell: (d) => d.response_code ?? <Dash why={t("No answer was received")} /> },
    { id: "when", label: t("When"), cell: (d) => formatDate(d.last_attempt_at ?? d.created_at, "datetime") },
  ];
  return (
    <>
      <h3 className="nx-rp-h">{t("Delivery log")}</h3>
      <SegmentedControl label={t("Show deliveries")} items={filters.map((f) => ({ value: f, label: f === "all" ? t("All") : statusWord(f) }))} value={filter} onChange={setFilter} />
      {q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The delivery log could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.deliveries.length === 0 ? (
        <EmptyState heading={status ? t("No {state} delivery.", { state: lc(statusWord(status)) }) : t("Nothing has been sent yet. Send a test event, or wait for the first event this webhook subscribes to.")} />
      ) : (
        <div data-testid="delivery-log">
          {q.data.total > q.data.deliveries.length ? (
            <p className="nx-rp-sub" data-testid="delivery-log-cap">
              {t("The first {n} of {total}", { n: int(q.data.deliveries.length), total: int(q.data.total) })}
            </p>
          ) : null}
          <DataTable
            rows={q.data.deliveries}
            columns={columns}
            rowKey={(d) => d.id}
            rowLabel={(d) => eventWord(d.event)}
            caption={t("Deliveries to {host}", { host: w.url })}
            total={q.data.total}
            density="compact"
            onOpenRow={(d) => openItem({ kind: "delivery", id: `${w.id}:${d.id}` })}
          />
        </div>
      )}
    </>
  );
}

function WebhookBody({ w, onClose }: { w: Webhook; onClose: () => void }) {
  const qc = useQueryClient();
  const events = useWebhookEvents().data?.events ?? [];
  const [chosen, setChosen] = useState<WebhookEvent[]>(w.events);
  const [description, setDescription] = useState(w.description ?? "");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [removing, setRemoving] = useState(false);
  const { outcome, pending, run } = useOutcome(`webhook:${w.id}`);
  const sameEvents = chosen.length === w.events.length && chosen.every((e) => w.events.includes(e));
  const urlBad = url.trim() !== "" && !urlOk(url);
  const secretBad = secret !== "" && secret.length < 16;
  const dirty = !sameEvents || description !== (w.description ?? "") || url.trim() !== "" || secret !== "";
  const save = () =>
    void run("save", async () => {
      await updateWebhook(w.id, { ...(sameEvents ? {} : { events: chosen }), ...(description !== (w.description ?? "") ? { description } : {}), ...(url.trim() ? { url: url.trim() } : {}), ...(secret ? { secret } : {}) });
      await refreshStep9(qc, "webhooks");
      setUrl("");
      setSecret("");
      return { tone: "ok", title: t("Webhook saved"), detail: secret ? t("The new secret signs every delivery from now on.") : undefined };
    });
  return (
    <>
      <Facts>
        <Fact label={t("Sends to")}>
          <code>{w.url}</code>
        </Fact>
        <Fact label={t("State")}>
          <Chip tone={w.active ? "good" : "neutral"}>{w.active ? t("Active") : t("Paused")}</Chip>
        </Fact>
        <Fact label={t("Events")}>{eventsWords(w.events)}</Fact>
        <Fact label={t("Added")}>{formatDate(w.created_at, "datetime")}</Fact>
        <Fact label={t("Changed")}>{w.updated_at ? formatDate(w.updated_at, "datetime") : <Dash why={t("Not changed since it was added")} />}</Fact>
      </Facts>
      <Result outcome={outcome} />
      <Actions>
        <Button
          variant="primary"
          loading={pending === "test"}
          loadingLabel={t("Sending…")}
          disabled={pending !== null}
          onClick={() =>
            void run("test", async () => {
              const r = await testWebhook(w.id);
              await refreshStep9(qc, "webhooks");
              return {
                tone: r.status === "delivered" ? "ok" : "fail",
                title: r.status === "delivered" ? t("Test event delivered") : t("Test event {state}", { state: lc(statusWord(r.status)) }),
                detail: r.response_code ? t("The endpoint answered {code}.", { code: r.response_code }) : (r.error ?? undefined),
              };
            })
          }
        >
          {t("Send a test event")}
        </Button>
        <Button
          disabled={pending !== null}
          onClick={() =>
            void run("active", async () => {
              await updateWebhook(w.id, { active: !w.active });
              await refreshStep9(qc, "webhooks");
              return { tone: "ok", title: w.active ? t("Webhook paused") : t("Webhook enabled"), detail: w.active ? t("Events are not sent while it is paused.") : undefined };
            })
          }
        >
          {w.active ? t("Pause") : t("Enable")}
        </Button>
        <Button variant="danger" onClick={() => setRemoving(true)}>
          {t("Delete")}
        </Button>
      </Actions>
      <h3 className="nx-rp-h">{t("Edit")}</h3>
      <div className="nx-rp-form">
        <Field label={t("New URL (optional)")} error={urlBad ? URL_ERROR() : undefined}>
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
      <Actions>
        <Button loading={pending === "save"} loadingLabel={t("Saving…")} disabled={!dirty || urlBad || secretBad || chosen.length === 0 || pending !== null} onClick={save}>
          {t("Save changes")}
        </Button>
      </Actions>
      <DeliveryLog w={w} />
      <Confirm
        open={removing}
        title={t("Delete the webhook to {host}", { host: w.url })}
        consequence={t("No event is sent to it again and its delivery log goes with it.")}
        confirmLabel={t("Delete the webhook")}
        danger
        blocked={pending === "delete" ? t("Working…") : undefined}
        onCancel={() => setRemoving(false)}
        onConfirm={() =>
          void run("delete", async () => {
            await deleteWebhook(w.id);
            await refreshStep9(qc, "webhooks");
            setRemoving(false);
            onClose();
            return { tone: "ok", title: t("Webhook deleted") };
          })
        }
      />
    </>
  );
}

/** `?open=webhook:<id>`: one webhook, its test send, its edits and its delivery log. `webhook:new` adds one. */
export function WebhookInspector({ id, onClose }: BodyProps) {
  const session = useV2Session();
  const allowed = session.can("manage_settings");
  const q = useWebhooks(allowed && id !== "new");
  if (!allowed) {
    return (
      <InspectorFrame title={t("Webhook")} onClose={onClose}>
        <NeedsPermission what={t("Managing webhooks")} permission="manage_settings" />
      </InspectorFrame>
    );
  }
  if (id === "new") return <NewWebhook onClose={onClose} />;
  const w = q.data?.webhooks.find((x) => x.id === id);
  return (
    <InspectorFrame title={w ? t("Webhook to {host}", { host: w.url }) : t("Webhook")} status={w ? (w.active ? t("Active") : t("Paused")) : undefined} onClose={onClose}>
      {w ? (
        <WebhookBody key={`${w.id}:${w.updated_at ?? ""}:${w.active}`} w={w} onClose={onClose} />
      ) : q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The webhook could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This webhook does not exist. It may have been deleted.")} />
      )}
    </InspectorFrame>
  );
}

/** `?open=delivery:<webhook id>:<delivery id>`: one delivery, its attempts and what the endpoint answered. */
export function DeliveryInspector({ id, onClose }: BodyProps) {
  const at = id.indexOf(":");
  const webhookId = at > 0 ? id.slice(0, at) : id;
  const deliveryId = at > 0 ? id.slice(at + 1) : "";
  const session = useV2Session();
  const allowed = session.can("manage_settings");
  const q = useDeliveries(webhookId, null, allowed);
  const hooks = useWebhooks(allowed);
  const { hrefFor } = useOpenItem();
  const d = q.data?.deliveries.find((x) => x.id === deliveryId);
  const w = hooks.data?.webhooks.find((x) => x.id === webhookId);
  return (
    <InspectorFrame title={d ? eventWord(d.event) : t("Delivery")} status={d ? <DeliveryStatus d={d} /> : undefined} onClose={onClose}>
      {!allowed ? (
        <NeedsPermission what={t("Reading the delivery log")} permission="manage_settings" />
      ) : d ? (
        <>
          <Facts>
            <Fact label={t("Webhook")}>{w ? <V2Link href={hrefFor({ kind: "webhook", id: w.id })}>{w.url}</V2Link> : <code>{webhookId}</code>}</Fact>
            <Fact label={t("Event")}>
              <Code code={d.event} text={eventWord(d.event)} />
            </Fact>
            <Fact label={t("State")}>
              <DeliveryStatus d={d} />
            </Fact>
            <Fact label={t("Attempts")}>{attemptsWords(d.attempts)}</Fact>
            <Fact label={t("Answer")}>{d.response_code ?? <Dash why={t("No answer was received")} />}</Fact>
            <Fact label={t("Error")}>{d.error ?? <Dash why={t("No error")} />}</Fact>
            <Fact label={t("Queued")}>{formatDate(d.created_at, "datetime")}</Fact>
            <Fact label={t("Last attempt")}>{d.last_attempt_at ? formatDate(d.last_attempt_at, "datetime") : <Dash why={t("Not attempted yet")} />}</Fact>
            <Fact label={t("Next attempt")}>{d.next_attempt_at ? formatDate(d.next_attempt_at, "datetime") : <Dash why={d.status === "retrying" || d.status === "pending" ? t("Not scheduled") : t("No more attempts")} />}</Fact>
            <Fact label={t("Delivered")}>{d.delivered_at ? formatDate(d.delivered_at, "datetime") : <Dash why={t("Not delivered")} />}</Fact>
          </Facts>
          <p className="nx-rp-sub">{t("A 2xx answer delivers an event. Anything else is retried 1, 2, 4 and 8 minutes after attempts 1 to 4 and marked failed after the fifth. The body carries ids, names and numbers only.")}</p>
        </>
      ) : q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={t("The delivery could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState heading={t("This delivery is not in the log of the webhook. The log keeps the newest 100.")} />
      )}
    </InspectorFrame>
  );
}

"use client";

import "../step9.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createWebhook, deleteWebhook, testWebhook, updateWebhook, type Webhook, type WebhookCreated, type WebhookDelivery, type WebhookEvent } from "@/lib/api/v2/step9";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { lc, t } from "@/lib/v2/i18n";
import { eventsWords, eventWord, WEBHOOK_PRESETS, type WebhookPreset } from "@/lib/v2/step9";
import { refreshStep9, useDeliveries, useWebhookEvents, useWebhooks } from "@/lib/v2/step9-queries";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { Confirm, copyText, NeedsPermission } from "../admin/kit";
import { ResultFrame, useOutcome } from "./shared";

const MAX_ATTEMPTS = 5;
const statusWord = (s: WebhookDelivery["status"]): string => (s === "pending" ? t("Waiting") : s === "retrying" ? t("Retrying") : s === "delivered" ? t("Delivered") : t("Failed"));
const STATUS_TONE: Record<WebhookDelivery["status"], "go" | "at-risk" | "no-go" | null> = { pending: null, retrying: "at-risk", delivered: "go", failed: "no-go" };
const attemptsWords = (n: number): string => t("{n} of {max}", { n, max: MAX_ATTEMPTS });
const urlOk = (u: string): boolean => /^https:\/\/\S{4,}$/.test(u.trim()); // i18n-ignore

function DeliveryStatus({ d }: { d: Pick<WebhookDelivery, "status"> }) {
  const tone = STATUS_TONE[d.status];
  return (
    <span className="m2-v">
      {tone ? <VerdictMark verdict={tone} /> : null}
      {statusWord(d.status)}
    </span>
  );
}

/** The events a webhook can subscribe to, as checkboxes. "Every event" stands alone. */
function EventPicker({ events, chosen, set, disabled }: { events: readonly WebhookEvent[]; chosen: readonly WebhookEvent[]; set: (next: WebhookEvent[]) => void; disabled?: boolean }) {
  const every = chosen.includes("*");
  const toggle = (e: WebhookEvent) => set(chosen.includes(e) ? chosen.filter((x) => x !== e) : [...chosen.filter((x) => x !== "*"), e]);
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="m2-lbl">{t("Events")}</legend>
      <ul className="m2-wh-events">
        <li>
          <label>
            <input type="checkbox" checked={every} disabled={disabled} onChange={() => set(every ? [] : ["*"])} />
            {eventWord("*")}
          </label>
        </li>
        {events
          .filter((e) => e !== "*")
          .map((e) => (
            <li key={e}>
              <label>
                <input type="checkbox" checked={every || chosen.includes(e)} disabled={disabled || every} onChange={() => toggle(e)} />
                <span>
                  {eventWord(e)} <span className="m2-meta m2-mono">{e}</span>
                </span>
              </label>
            </li>
          ))}
      </ul>
    </fieldset>
  );
}

const URL_ERROR = (): string => t("The URL must start with https://.");

/** `?open=webhook:new`: the URL, the events and the description; a preset fills the events for Slack or Teams. */
function NewWebhook({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const events = useWebhookEvents().data?.events ?? [];
  const [preset, setPreset] = useState<WebhookPreset["id"]>("slack");
  const p = WEBHOOK_PRESETS.find((x) => x.id === preset) ?? WEBHOOK_PRESETS[0];
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<WebhookEvent[]>([...WEBHOOK_PRESETS[0].events]);
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
        <p className="m2-prov">{t("The signing secret is shown this once. Keep it where the receiver checks the X-Meridian-Signature header; Meridian never shows it again.")}</p>
        <p className="m2-wh-secret" data-testid="webhook-secret">
          {created.secret}
        </p>
        <Actions>
          <button type="button" className="m2-btn" onClick={() => void copyText(created.secret).then(setCopied)}>
            {copied ? t("Copied") : t("Copy the secret")}
          </button>
          <button type="button" className="m2-btn m2-strong" onClick={() => openItem({ kind: "webhook", id: created.id })}>
            {t("Open the webhook")}
          </button>
        </Actions>
      </InspectorFrame>
    );
  }
  return (
    <InspectorFrame title={t("Add a webhook")} status={t("Signed JSON events")} onClose={onClose}>
      <div className="m2-wh-presets" role="group" aria-label={t("Preset")}>
        {WEBHOOK_PRESETS.map((x) => (
          <button key={x.id} type="button" className="m2-seg" aria-pressed={preset === x.id} onClick={() => choose(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <p className="m2-prov">{p.hint}</p>
      <div className="m2-aform">
        <label>
          {t("URL")}
          <input type="url" value={url} placeholder={p.placeholder} onChange={(e) => setUrl(e.target.value)} aria-invalid={urlBad || undefined} />
        </label>
        {urlBad ? (
          <span className="m2-s9-err" role="alert">
            {URL_ERROR()}
          </span>
        ) : null}
        <label>
          {t("Description (optional)")}
          <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      <EventPicker events={events} chosen={chosen} set={setChosen} />
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-strong"
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
          {pending === "create" ? t("Adding…") : t("Add the webhook")}
        </button>
      </Actions>
    </InspectorFrame>
  );
}

function DeliveryLog({ w }: { w: Webhook }) {
  const [status, setStatus] = useState<WebhookDelivery["status"] | null>(null);
  const q = useDeliveries(w.id, status);
  const { hrefFor } = useOpenItem();
  const filters: (WebhookDelivery["status"] | null)[] = [null, "delivered", "retrying", "failed", "pending"];
  return (
    <>
      <h3>{t("Delivery log")}</h3>
      <div className="m2-segs" role="group" aria-label={t("Show deliveries")}>
        {filters.map((f) => (
          <button key={f ?? "all"} type="button" className="m2-seg" aria-pressed={status === f} onClick={() => setStatus(f)}>
            {f ? statusWord(f) : t("All")}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <Skeleton width="100%" height={80} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The delivery log could not be read.")}</ErrorFrame>
      ) : q.data.deliveries.length === 0 ? (
        <EmptyFrame>{status ? t("No {state} delivery.", { state: lc(statusWord(status)) }) : t("Nothing has been sent yet. Send a test event, or wait for the first event this webhook subscribes to.")}</EmptyFrame>
      ) : (
        <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Delivery log, scrollable")}>
          <table className="m2-tbl" aria-label={t("Deliveries to {host}", { host: w.url })} data-testid="delivery-log">
            <thead>
              <tr>
                <th scope="col">{t("Event")}</th>
                <th scope="col">{t("State")}</th>
                <th scope="col" className="m2-r">{t("Attempts")}</th>
                <th scope="col" className="m2-r">{t("Answer")}</th>
                <th scope="col">{t("When")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.deliveries.map((d) => (
                <tr key={d.id}>
                  <th scope="row">
                    <V2Link href={hrefFor({ kind: "delivery", id: `${w.id}:${d.id}` })}>{eventWord(d.event)}</V2Link>
                  </th>
                  <td>
                    <DeliveryStatus d={d} />
                  </td>
                  <td className="m2-r">{attemptsWords(d.attempts)}</td>
                  <td className="m2-r">{d.response_code ?? <Dash why={t("No answer was received")} />}</td>
                  <td>{formatDate(d.last_attempt_at ?? d.created_at, "datetime")}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <Mono>{w.url}</Mono>
        </Fact>
        <Fact label={t("State")}>
          <span className="m2-v">
            {w.active ? <VerdictMark verdict="go" /> : null}
            {w.active ? t("Active") : t("Paused")}
          </span>
        </Fact>
        <Fact label={t("Events")}>{eventsWords(w.events)}</Fact>
        <Fact label={t("Added")}>{formatDate(w.created_at, "datetime")}</Fact>
        <Fact label={t("Changed")}>{w.updated_at ? formatDate(w.updated_at, "datetime") : <Dash why={t("Not changed since it was added")} />}</Fact>
      </Facts>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Actions>
        <button
          type="button"
          className="m2-btn m2-strong"
          disabled={pending !== null}
          onClick={() =>
            void run("test", async () => {
              const r = await testWebhook(w.id);
              await refreshStep9(qc, "webhooks");
              return { tone: r.status === "delivered" ? "ok" : "fail", title: r.status === "delivered" ? t("Test event delivered") : t("Test event {state}", { state: lc(statusWord(r.status)) }), detail: r.response_code ? t("The endpoint answered {code}.", { code: r.response_code }) : (r.error ?? undefined) };
            })
          }
        >
          {pending === "test" ? t("Sending…") : t("Send a test event")}
        </button>
        <button
          type="button"
          className="m2-btn"
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
        </button>
        <button type="button" className="m2-btn m2-ghost" onClick={() => setRemoving(true)}>
          {t("Delete")}
        </button>
      </Actions>
      <h3>{t("Edit")}</h3>
      <div className="m2-aform">
        <label>
          {t("New URL (optional)")}
          <input type="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} aria-invalid={urlBad || undefined} />
        </label>
        {urlBad ? (
          <span className="m2-s9-err" role="alert">
            {URL_ERROR()}
          </span>
        ) : null}
        <label>
          {t("Description")}
          <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          {t("New signing secret (optional, 16 characters or more)")}
          <input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} aria-invalid={secretBad || undefined} />
        </label>
      </div>
      <EventPicker events={events} chosen={chosen} set={setChosen} />
      <Actions>
        <button type="button" className="m2-btn" disabled={!dirty || urlBad || secretBad || chosen.length === 0 || pending !== null} onClick={save}>
          {pending === "save" ? t("Saving…") : t("Save changes")}
        </button>
      </Actions>
      <DeliveryLog w={w} />
      {removing ? (
        <Confirm
          title={t("Delete the webhook to {host}", { host: w.url })}
          body={t("No event is sent to it again and its delivery log goes with it.")}
          confirm={t("Delete the webhook")}
          cancel={t("Keep")}
          danger
          pending={pending === "delete"}
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
      ) : null}
    </>
  );
}

/** `?open=webhook:<id>`: one webhook, its test send, its edits and its delivery log. `webhook:new` adds one. */
export function WebhookInspector({ id, onClose }: { id: string; onClose: () => void }) {
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
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The webhook could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("This webhook does not exist. It may have been deleted.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}

/** `?open=delivery:<webhook id>:<delivery id>`: one delivery, its attempts and what the endpoint answered. */
export function DeliveryInspector({ id, onClose }: { id: string; onClose: () => void }) {
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
            <Fact label={t("Webhook")}>{w ? <V2Link href={hrefFor({ kind: "webhook", id: w.id })}>{w.url}</V2Link> : <Mono>{webhookId}</Mono>}</Fact>
            <Fact label={t("Event")}>
              <Mono>{d.event}</Mono>
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
          <p className="m2-prov">{t("A 2xx answer delivers an event. Anything else is retried 1, 2, 4 and 8 minutes after attempts 1 to 4 and marked failed after the fifth. The body carries ids, names and numbers only.")}</p>
        </>
      ) : q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The delivery could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("This delivery is not in the log of the webhook. The log keeps the newest 100.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}

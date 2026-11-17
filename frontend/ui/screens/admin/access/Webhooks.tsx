"use client";

import { useState } from "react";
import { Button, Card, Chip, Code, Confirm, DataTable, EmptyState, Field, Input, SeverityPill, Toggle, type Column } from "@/ui/kit";
import { Frame, day, useAct, useSectionChat } from "../common";
import { useDeliveries, useWebhookEvents, useWebhooks } from "@/lib/v2/step9-queries";
import { createWebhook, deleteWebhook, testWebhook, updateWebhook, type Webhook, type WebhookDelivery, type WebhookEvent } from "@/lib/api/v2/step9";
import { t, tx } from "@/lib/v2/i18n";

const DSEV = { delivered: "info", pending: "low", retrying: "medium", failed: "critical" } as const;
const FILTERS: (WebhookDelivery["status"] | null)[] = [null, "delivered", "retrying", "failed"];

export function Webhooks() {
  const hooks = useWebhooks();
  const evs = useWebhookEvents();
  const { run, busy } = useAct();
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [chosen, setChosen] = useState<WebhookEvent[]>(["*"]);
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [open, setOpen] = useState<string>("");
  const [filter, setFilter] = useState<WebhookDelivery["status"] | null>(null);
  const [ask, setAsk] = useState<Webhook | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const list = hooks.data?.webhooks ?? [];
  const events = evs.data?.events ?? [];
  const sel = open || list[0]?.id || "";
  const dl = useDeliveries(sel, filter);
  useSectionChat("webhooks", t("Webhooks"), [t("{n} webhooks are set up.", { n: list.length }), ...list.slice(0, 5).map((w) => `${w.url}: ${w.active ? t("on") : t("off")}`)], [t("Which webhooks are active?"), t("Which deliveries failed?")]);

  const toggle = (e: WebhookEvent) => setChosen((c) => (c.includes(e) ? c.filter((x) => x !== e) : [...c, e]));
  const create = async () => {
    const r = await run(() => createWebhook({ url: url.trim(), events: chosen, description: desc.trim() || undefined }), t("Webhook created."), ["webhooks"]);
    if (r) { setSecretShown(r.secret); setUrl(""); setDesc(""); setChosen(["*"]); }
  };
  const test = async (w: Webhook) => {
    const r = await run(() => testWebhook(w.id), t("Test event sent."), ["webhooks"]);
    if (r) setTestMsg(r.status === "delivered" ? t("Delivered with code {code}.", { code: String(r.response_code ?? "") }) : t("Not delivered: {reason}", { reason: r.error ? tx(r.error) : tx(r.status) }));
  };

  const cols: Column<Webhook>[] = [
    { key: "url", label: t("Address"), sort: (w) => w.url, render: (w) => <Code code={w.url} description={w.description ?? t("No description")} /> },
    { key: "events", label: t("Events"), render: (w) => w.events.join(", ") },
    { key: "active", label: t("Active"), render: (w) => <Toggle label={t("Active")} checked={w.active} onChange={(v: boolean) => run(() => updateWebhook(w.id, { active: v }), t("Webhook updated."), ["webhooks"])} /> },
    { key: "act", label: "", render: (w) => (
      <span className="mx-links">
        <Button variant="ghost" type="button" onClick={() => setOpen(w.id)}>{t("Deliveries")}</Button>
        <Button variant="ghost" type="button" onClick={() => void test(w)}>{t("Send test")}</Button>
        <Button variant="ghost" type="button" onClick={() => setAsk(w)}>{t("Delete")}</Button>
      </span>
    ) },
  ];
  const dcols: Column<WebhookDelivery>[] = [
    { key: "event", label: t("Event"), render: (d) => <Code code={d.event} description={d.event_id ?? ""} /> },
    { key: "status", label: t("Status"), render: (d) => <SeverityPill sev={DSEV[d.status]} label={tx(d.status)} /> },
    { key: "attempts", label: t("Attempts"), align: "end", sort: (d) => d.attempts, render: (d) => String(d.attempts) },
    { key: "code", label: t("Response"), render: (d) => (d.response_code ? String(d.response_code) : d.error ? tx(d.error) : t("None")) },
    { key: "at", label: t("Sent"), sort: (d) => d.created_at, render: (d) => day(d.created_at) },
  ];

  return (
    <Frame slug="webhooks" title={t("Webhooks")} lead={t("Send Meridian events to your own systems, signed with a secret.")} loading={hooks.isLoading} error={hooks.isError}>
      {secretShown && (
        <Card title={t("Copy the signing secret now")} sub={t("It is shown once and cannot be read again.")}>
          <p><code className="mx-code">{secretShown}</code></p>
          <Button variant="secondary" type="button" onClick={() => setSecretShown(null)}>{t("I have copied it")}</Button>
        </Card>
      )}
      <Card title={t("New webhook")}>
        <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <Field label={t("Address")} hint={t("Must start with https.")}><Input value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          <Field label={t("Description")}><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Field label={t("Events")}>
            <div className="mx-chips">
              {events.map((e) => <Chip key={e} selected={chosen.includes(e)} onClick={() => toggle(e)}>{e}</Chip>)}
            </div>
          </Field>
          <div><Button variant="primary" type="submit" disabled={busy || !url.trim().startsWith("https://") || chosen.length === 0}>{t("Create webhook")}</Button></div>
        </form>
      </Card>
      <Card title={t("Webhooks")} sub={t("{n} webhooks", { n: list.length })}>
        {list.length === 0 ? <EmptyState heading={t("No webhooks yet")} body={t("Create one above to receive events.")} /> : <DataTable columns={cols} rows={list} rowKey={(w) => w.id} label={t("Webhooks")} />}
        {testMsg && <p role="status" className="mx-muted">{testMsg}</p>}
      </Card>
      {sel && (
        <Card title={t("Deliveries")} sub={list.find((w) => w.id === sel)?.url}>
          <div className="mx-chips">
            {FILTERS.map((f) => <Chip key={f ?? "all"} selected={filter === f} onClick={() => setFilter(f)}>{f ? tx(f) : t("All")}</Chip>)}
          </div>
          {(dl.data?.deliveries.length ?? 0) === 0 ? <EmptyState heading={t("No deliveries yet")} /> : <DataTable columns={dcols} rows={dl.data?.deliveries ?? []} rowKey={(d) => d.id} label={t("Deliveries")} />}
        </Card>
      )}
      <Confirm open={!!ask} danger title={t("Delete this webhook?")} confirmLabel={t("Delete")} cancelLabel={t("Cancel")} onCancel={() => setAsk(null)}
        onConfirm={() => { const w = ask; setAsk(null); if (w) void run(() => deleteWebhook(w.id), t("Webhook deleted."), ["webhooks"]); }}>
        <p>{t("Events stop going to {url}.", { url: ask?.url ?? "" })}</p>
      </Confirm>
    </Frame>
  );
}

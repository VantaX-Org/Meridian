"use client";

import "../step9.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { putAutomation, putChatAlerts, testChatAlerts, type AutomationSettings, type ChatAlerts, type ChatEvent, type Webhook } from "@/lib/api/v2/step9";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { eventsWords } from "@/lib/v2/step9";
import { refreshStep9, useAutomation, useChatAlerts, useWebhooks } from "@/lib/v2/step9-queries";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { EmptyFrame, ErrorFrame, Mono } from "../parts";
import { AdminPage, Block, Fld, Loaded, NeedsPermission, StatusWord, Sw, useCan } from "./kit";

const columns = (): GridColumn<Webhook>[] => [
  { id: "host", header: t("Sends to"), width: 240, pin: true, locked: true, cell: (w) => <Mono>{w.url}</Mono> },
  { id: "events", header: t("Events"), width: 360, cell: (w) => eventsWords(w.events) },
  { id: "state", header: t("State"), width: 110, cell: (w) => <StatusWord tone={w.active ? "go" : "neutral"}>{w.active ? t("Active") : t("Paused")}</StatusWord> },
  { id: "about", header: t("Description"), width: 260, cell: (w) => w.description ?? "—" },
  { id: "added", header: t("Added"), width: 130, cell: (w) => formatDate(w.created_at, "date") },
];

/** The tenant's automation: drift alerts on or off, how many repeated fixes make a learned rule, the score drop alert. */
function Automation({ a, can }: { a: AutomationSettings; can: boolean }) {
  const qc = useQueryClient();
  const [drift, setDrift] = useState(a.drift_alerts.enabled);
  const [min, setMin] = useState(String(a.rule_mining.min_records));
  const [points, setPoints] = useState(a.score_drop.points == null ? "" : String(a.score_drop.points));
  const [below, setBelow] = useState(a.score_drop.below == null ? "" : String(a.score_drop.below));
  const { outcome, pending, run } = useOutcome("automation");
  const minN = Number(min);
  const minBad = !Number.isInteger(minN) || minN < 2 || minN > 100000;
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const badScore = (v: string) => v.trim() !== "" && !(Number(v) >= 0 && Number(v) <= 100);
  const dirty = drift !== a.drift_alerts.enabled || min !== String(a.rule_mining.min_records) || points !== (a.score_drop.points == null ? "" : String(a.score_drop.points)) || below !== (a.score_drop.below == null ? "" : String(a.score_drop.below));
  return (
    <>
      <div className="m2-fgrid">
        <Sw checked={drift} disabled={!can} onChange={setDrift} label={t("Config drift alerts")} hint={t("After a configuration load or sync, tell the owners of the objects whose rules read a changed table, and re-score them.")} />
        <Fld label={t("Repeated fixes that make a learned rule")} hint={t("The same fix in this many records proposes a rule. From 2.")} error={minBad ? t("A whole number from 2 to 100,000.") : null}>
          <input type="number" min={2} value={min} disabled={!can} onChange={(e) => setMin(e.target.value)} />
        </Fld>
        <Fld label={t("Alert when a score drops by points")} hint={t("Empty: no alert on the size of a drop.")} error={badScore(points) ? t("From 0 to 100.") : null}>
          <input type="number" min={0} max={100} value={points} disabled={!can} onChange={(e) => setPoints(e.target.value)} />
        </Fld>
        <Fld label={t("Alert when a score falls below")} hint={t("Empty: no alert on a floor.")} error={badScore(below) ? t("From 0 to 100.") : null}>
          <input type="number" min={0} max={100} value={below} disabled={!can} onChange={(e) => setBelow(e.target.value)} />
        </Fld>
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {can ? (
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn m2-strong"
            disabled={!dirty || minBad || badScore(points) || badScore(below) || pending !== null}
            onClick={() =>
              void run("save", async () => {
                await putAutomation({ drift_alerts: { enabled: drift }, rule_mining: { min_records: minN }, score_drop: { points: num(points), below: num(below) } });
                await refreshStep9(qc, "automation");
                return { tone: "ok", title: t("Automation saved") };
              })
            }
          >
            {pending === "save" ? t("Saving…") : t("Save automation")}
          </button>
        </div>
      ) : (
        <p className="m2-prov">{t("Changing these needs the manage settings permission.")}</p>
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

/** Chat alerts: the Slack and Teams URLs live in the server environment only, so this block shows whether each is set, which events go to chat, and sends a test. */
function ChatAlertsBlock({ c, can }: { c: ChatAlerts; can: boolean }) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<ChatEvent[]>(c.events);
  const { outcome, pending, run } = useOutcome("chat-alerts");
  const words = chatEventWords();
  const any = c.channels.slack || c.channels.teams;
  const dirty = events.join() !== c.events.join();
  const toggle = (e: ChatEvent, on: boolean) => setEvents(c.available.filter((x) => (x === e ? on : events.includes(x))));
  return (
    <>
      <div className="m2-fgrid">
        <Fld label={t("Slack")}>
          <StatusWord tone={c.channels.slack ? "go" : "neutral"}>{c.channels.slack ? t("Configured") : t("Not configured")}</StatusWord>
        </Fld>
        <Fld label={t("Microsoft Teams")}>
          <StatusWord tone={c.channels.teams ? "go" : "neutral"}>{c.channels.teams ? t("Configured") : t("Not configured")}</StatusWord>
        </Fld>
      </div>
      {any ? null : <p className="m2-prov">{t("Set MERIDIAN_SLACK_WEBHOOK_URL or MERIDIAN_TEAMS_WEBHOOK_URL in the server environment and restart Meridian. The address is a secret and is never shown here.")}</p>}
      <div className="m2-fgrid">
        {c.available.map((e) => (
          <Sw key={e} checked={events.includes(e)} disabled={!can} onChange={(on) => toggle(e, on)} label={words[e][0]} hint={words[e][1]} />
        ))}
      </div>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {can ? (
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn m2-strong"
            disabled={!dirty || pending !== null}
            onClick={() =>
              void run("save", async () => {
                await putChatAlerts(events);
                await refreshStep9(qc, "automation");
                return { tone: "ok", title: t("Chat alerts saved") };
              })
            }
          >
            {pending === "save" ? t("Saving…") : t("Save chat alerts")}
          </button>
          <button
            type="button"
            className="m2-btn"
            disabled={!any || pending !== null}
            onClick={() =>
              void run("test", async () => {
                const r = await testChatAlerts();
                const sent = (["slack", "teams"] as const).filter((k) => r.channels[k].delivered);
                const failed = (["slack", "teams"] as const).filter((k) => r.channels[k].configured && !r.channels[k].delivered);
                return failed.length
                  ? { tone: "fail", title: t("The test did not reach every channel"), detail: failed.map((k) => `${k}: ${r.channels[k].error ?? "—"}`).join("; ") }
                  : { tone: "ok", title: t("Test sent to {n, plural, one {# channel} other {# channels}}", { n: sent.length }) };
              })
            }
          >
            {pending === "test" ? t("Sending…") : t("Send a test message")}
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Admin › Webhooks: where Meridian posts its events, the delivery log behind each, and the tenant's automation. */
export function WebhooksSection() {
  const can = useCan();
  const allowed = can("manage_settings");
  const { openItem, open } = useOpenItem();
  const q = useWebhooks(allowed);
  const auto = useAutomation();
  const chat = useChatAlerts();
  if (!allowed) {
    return (
      <AdminPage title={t("Webhooks")}>
        <NeedsPermission what={t("Managing webhooks")} permission="manage_settings" />
      </AdminPage>
    );
  }
  const rows = q.data?.webhooks ?? [];
  const active = rows.filter((w) => w.active).length;
  return (
    <AdminPage
      title={t("Webhooks")}
      lead={t("{n} active {n, plural, one {webhook} other {webhooks}}. Meridian posts a signed JSON event to each when it happens: ids, names and numbers, never SAP values. A failed post is retried 1, 2, 4 and 8 minutes later and marked failed after 5 attempts.", { n: active })}
      actions={
        <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "webhook", id: "new" })}>
          {t("Add a webhook")}
        </button>
      }
    >
      <Block>
        <ToolGrid<Webhook>
          toolsTitle={t("Webhooks")}
          id="admin-webhooks"
          ariaLabel={t("Webhooks")}
          columns={columns()}
          rows={rows}
          rowId={(w) => w.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The webhooks could not be read. {detail}", { detail: apiErrorMessage(q.error) })}</ErrorFrame> : undefined}
          emptyFrame={
            <EmptyFrame
              action={
                <button type="button" className="m2-btn" onClick={() => openItem({ kind: "webhook", id: "new" })}>
                  {t("Add a webhook")}
                </button>
              }
            >
              {t("No webhook yet. Add one with the URL of a Slack or Teams workflow, or any https endpoint, and the events it should receive.")}
            </EmptyFrame>
          }
          onOpen={(w) => openItem({ kind: "webhook", id: w.id })}
          openRowId={open?.kind === "webhook" ? open.id : null}
        />
      </Block>
      <Block title={t("Chat alerts")} hint={t("Counts and a link into Meridian go to a Slack or Teams channel, never record values.")}>
        <Loaded q={chat} what={t("The chat alert settings")}>
          {(c) => <ChatAlertsBlock key={JSON.stringify(c)} c={c} can={allowed} />}
        </Loaded>
      </Block>
      <Block title={t("Automation")} hint={t("What Meridian does by itself after a configuration change, from stewards' fixes and when a score drops.")}>
        <Loaded q={auto} what={t("The automation settings")}>
          {(a) => <Automation key={JSON.stringify(a)} a={a} can={allowed} />}
        </Loaded>
      </Block>
    </AdminPage>
  );
}

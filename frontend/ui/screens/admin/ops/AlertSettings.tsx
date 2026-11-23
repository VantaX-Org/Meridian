"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { putAutomation, putChatAlerts, testChatAlerts, type AutomationSettings, type ChatAlerts, type ChatEvent, type ChatTest } from "@/lib/api/v2/step9";
import { s9Keys, useAutomation, useChatAlerts } from "@/lib/v2/step9-queries";
import { t, tx } from "@/lib/v2/i18n";
import { Button, Card, EmptyState, ErrorState, Field, Input, Skeleton, Toggle } from "@/ui/kit";
import { Row, useAct } from "./shared";

/** useAct, then the step-9 reads (a different key family from the admin reads) refresh too. */
function useS9Act() {
  const qc = useQueryClient();
  const { run, busy } = useAct();
  return { busy, run: async <T,>(fn: () => Promise<T>, done: string) => { const r = await run(fn, done); if (r !== undefined) await qc.invalidateQueries({ queryKey: s9Keys.all }); return r; } };
}

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

function AutomationForm({ a }: { a: AutomationSettings }) {
  const { run, busy } = useS9Act();
  const [on, setOn] = useState(a.drift_alerts.enabled);
  const [min, setMin] = useState(String(a.rule_mining.min_records));
  const [below, setBelow] = useState(a.score_drop.below == null ? "" : String(a.score_drop.below));
  const [pts, setPts] = useState(a.score_drop.points == null ? "" : String(a.score_drop.points));
  const bad = !Number.isInteger(Number(min)) || Number(min) < 1 || [below, pts].some((v) => v.trim() !== "" && !Number.isFinite(Number(v)));
  return (
    <>
      <Toggle label={t("Tell owners when a config sync changes what rules depend on")} checked={on} onChange={setOn} />
      <Row>
        <Field label={t("Records a fix must repeat in before a rule is proposed")}><Input inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <Field label={t("Score drop: alert below")} hint={t("Empty switches it off.")}><Input inputMode="decimal" value={below} onChange={(e) => setBelow(e.target.value)} /></Field>
        <Field label={t("Score drop: alert after a fall of points")}><Input inputMode="decimal" value={pts} onChange={(e) => setPts(e.target.value)} /></Field>
        <Button variant="primary" disabled={busy || bad} onClick={() => void run(() => putAutomation({ drift_alerts: { enabled: on }, rule_mining: { min_records: Number(min) }, score_drop: { below: num(below), points: num(pts) } }), t("Automation saved"))}>{t("Save automation")}</Button>
      </Row>
    </>
  );
}

function ChatForm({ c }: { c: ChatAlerts }) {
  const { run, busy } = useS9Act();
  const [events, setEvents] = useState<ChatEvent[]>(c.events);
  const [result, setResult] = useState<ChatTest | null>(null);
  const kinds = (["slack", "teams"] as const).filter((k) => c.channels[k]);
  const flip = (e: ChatEvent, v: boolean) => setEvents(v ? [...events, e] : events.filter((x) => x !== e));
  return (
    <>
      <p className="mx-muted">{kinds.length ? t("Sending to {channels}.", { channels: kinds.map((k) => tx(k)).join(", ") }) : t("No chat channel is configured on the server, so nothing is sent.")}</p>
      {c.available.map((e) => <Toggle key={e} label={tx(e)} checked={events.includes(e)} onChange={(v: boolean) => flip(e, v)} />)}
      <Row>
        <Button variant="primary" disabled={busy} onClick={() => void run(() => putChatAlerts(c.available.filter((e) => events.includes(e))), t("Chat alerts saved"))}>{t("Save chat alerts")}</Button>
        <Button variant="secondary" disabled={busy || kinds.length === 0} onClick={() => void run(testChatAlerts, t("Test message sent")).then((r) => r && setResult(r))}>{t("Send a test message")}</Button>
      </Row>
      {result ? <ul>{kinds.map((k) => <li key={k}>{tx(k)}: {result.channels[k].delivered ? t("Delivered") : (result.channels[k].error ?? t("Not delivered"))}</li>)}</ul> : null}
    </>
  );
}

/** Tenant automation (drift alerts, rule mining, score drop) and which events go to Slack or Teams. Admins only. */
export function AlertSettings() {
  const auto = useAutomation();
  const chat = useChatAlerts();
  const failed = auto.isError || chat.isError;
  const retry = () => { void auto.refetch(); void chat.refetch(); };
  return (
    <>
      <Card title={t("Automation")} sub={t("What the platform does on its own.")}>
        {failed ? <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={retry} />
          : auto.isLoading || !auto.data ? <Skeleton lines={4} label={t("Loading {screen}", { screen: t("Automation") })} />
          : <AutomationForm a={auto.data} />}
      </Card>
      <Card title={t("Chat alerts")} sub={t("Which events go to Slack or Teams.")}>
        {failed ? <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={retry} />
          : chat.isLoading || !chat.data ? <Skeleton lines={4} label={t("Loading {screen}", { screen: t("Chat alerts") })} />
          : chat.data.available.length === 0 ? <EmptyState heading={t("No chat events")} body={t("The server offers no events for chat.")} />
          : <ChatForm key={chat.data.events.join()} c={chat.data} />}
      </Card>
    </>
  );
}

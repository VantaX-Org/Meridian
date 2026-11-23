"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Code, Confirm, DataTable, EmptyState, Field, Input, Select, SeverityPill, Toggle, type Column } from "@/ui/kit";
import { Frame, day, useAct, useCan, useSectionChat, useSync } from "../common";
import { useChannels, useMyPreferences, useTenantSettings } from "@/lib/v2/admin-queries";
import { useFixture } from "@/lib/api/v2/fixture";
import { createChannel, deleteChannel, getMyDeliveries, patchMyPreferences, saveDefaultDigest, sendTestNotification, testChannel, updateChannel, type AlertChannel } from "@/lib/api/v2/admin";
import { t, tx } from "@/lib/v2/i18n";
import { AlertSettings } from "../ops/AlertSettings";

const KINDS = ["webhook", "slack", "teams", "email"] as const;
const DIGESTS = ["off", "daily", "weekly"] as const;
const DSEV = { sent: "info", failed: "critical", no_backend: "medium", skipped: "low" } as const;

export function Notify() {
  const fx = useFixture();
  const can = useCan();
  const admin = can("manage_settings");
  const channels = useChannels(admin);
  const prefs = useMyPreferences();
  const tenant = useTenantSettings(admin);
  const deliveries = useQuery({ queryKey: ["v2", "admin", fx, "me", "deliveries"], queryFn: () => getMyDeliveries(20), retry: false });
  const { run, busy } = useAct();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("email");
  const [target, setTarget] = useState("");
  const [digest, setDigest] = useState<(typeof DIGESTS)[number]>("daily");
  const [crit, setCrit] = useState(true);
  const [ask, setAsk] = useState<AlertChannel | null>(null);
  const [mail, setMail] = useState({ email: "", teams_webhook: "", daily_digest: false, weekly_summary: false, monthly_report: false });
  const list = channels.data ?? [];
  const n = tenant.data?.notification_config;
  useSync(n, (n) => setMail({ email: n.email ?? "", teams_webhook: n.teams_webhook ?? "", daily_digest: !!n.daily_digest, weekly_summary: !!n.weekly_summary, monthly_report: !!n.monthly_report }));
  useSectionChat("notify", t("Notifications"), [t("{n} alert channels are set up.", { n: list.length }), prefs.data?.notifications?.digest ? t("Your digest is {digest}.", { digest: tx(prefs.data.notifications.digest) }) : t("You have no digest set.")], [t("Where do critical alerts go?"), t("What is my digest?")]);

  const cols: Column<AlertChannel>[] = [
    { key: "kind", label: t("Kind"), render: (c) => tx(c.kind) },
    { key: "target", label: t("Target"), render: (c) => <Code code={c.target} description={tx(c.kind)} /> },
    { key: "digest", label: t("Digest"), render: (c) => tx(c.digest) },
    { key: "crit", label: t("Critical now"), render: (c) => (c.immediate_critical ? t("Yes") : t("No")) },
    { key: "on", label: t("Active"), render: (c) => <Toggle label={t("Active")} checked={c.enabled} onChange={(v: boolean) => run(() => updateChannel(c.id, { enabled: v }), t("Channel updated."), ["channels"])} /> },
    { key: "act", label: "", render: (c) => (
      <span className="mx-links">
        <Button variant="ghost" type="button" onClick={() => void run(() => testChannel(c.id), t("Test sent."), [])}>{t("Send test")}</Button>
        <Button variant="ghost" type="button" onClick={() => setAsk(c)}>{t("Delete")}</Button>
      </span>
    ) },
  ];
  const dcols: Column<NonNullable<typeof deliveries.data>["items"][number]>[] = [
    { key: "kind", label: t("Kind"), render: (d) => tx(d.kind) },
    { key: "channel", label: t("Channel"), render: (d) => tx(d.channel) },
    { key: "status", label: t("Status"), render: (d) => <SeverityPill sev={DSEV[d.status]} label={tx(d.status)} /> },
    { key: "at", label: t("Sent"), sort: (d) => d.created_at, render: (d) => day(d.created_at) },
  ];
  const p = prefs.data?.notifications;

  return (
    <Frame slug="notify" title={t("Notifications")} lead={t("Where alerts and digests go, for you and for the tenant.")} loading={prefs.isLoading} error={prefs.isError}>
      <Card title={t("Your preferences")}>
        <div className="mx-col">
          <Field label={t("Digest")}>
            <Select value={p?.digest ?? "off"} onChange={(e) => void run(() => patchMyPreferences({ notifications: { digest: e.target.value as (typeof DIGESTS)[number] } }), t("Preferences saved."), ["me"])} options={DIGESTS.map((d) => ({ value: d, label: tx(d) }))} />
          </Field>
          <Toggle label={t("Tell me at once about critical findings")} checked={!!p?.immediate_critical} onChange={(v: boolean) => run(() => patchMyPreferences({ notifications: { immediate_critical: v } }), t("Preferences saved."), ["me"])} />
          <div><Button variant="secondary" type="button" onClick={() => void run(() => sendTestNotification(), t("Test notification sent."), [])}>{t("Send me a test")}</Button></div>
        </div>
      </Card>
      <Card title={t("Recent notifications to you")}>
        {(deliveries.data?.items.length ?? 0) === 0 ? <EmptyState heading={t("Nothing sent yet")} body={t("A message appears here after the first notification is sent.")} /> : <DataTable columns={dcols} rows={deliveries.data?.items ?? []} rowKey={(d) => d.id} label={t("Notifications")} />}
      </Card>
      {admin && (
        <>
          <Card title={t("Alert channels")} sub={t("{n} channels", { n: list.length })}>
            {list.length === 0 ? <EmptyState heading={t("No alert channels yet")} body={t("Add one below to send alerts to email, Slack or Teams.")} /> : <DataTable columns={cols} rows={list} rowKey={(c) => c.id} label={t("Alert channels")} />}
          </Card>
          <Card title={t("New alert channel")}>
            <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => createChannel({ kind, target: target.trim(), digest, immediate_critical: crit }), t("Channel created."), ["channels"]).then(() => setTarget("")); }}>
              <Field label={t("Kind")}><Select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} options={KINDS.map((k) => ({ value: k, label: tx(k) }))} /></Field>
              <Field label={t("Target")} hint={kind === "email" ? t("An email address.") : t("A web address that starts with https.")}><Input value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
              <Field label={t("Digest")}><Select value={digest} onChange={(e) => setDigest(e.target.value as (typeof DIGESTS)[number])} options={DIGESTS.map((d) => ({ value: d, label: tx(d) }))} /></Field>
              <Toggle label={t("Send critical findings at once")} checked={crit} onChange={setCrit} />
              <div><Button variant="primary" type="submit" disabled={busy || !target.trim()}>{t("Add channel")}</Button></div>
            </form>
          </Card>
          <Card title={t("Default digest for new users")}>
            <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void run(() => saveDefaultDigest(mail), t("Default digest saved."), ["settings"]); }}>
              <Field label={t("Email")}><Input value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} /></Field>
              <Field label={t("Teams webhook")}><Input value={mail.teams_webhook} onChange={(e) => setMail({ ...mail, teams_webhook: e.target.value })} /></Field>
              <Toggle label={t("Daily digest")} checked={mail.daily_digest} onChange={(v: boolean) => setMail({ ...mail, daily_digest: v })} />
              <Toggle label={t("Weekly summary")} checked={mail.weekly_summary} onChange={(v: boolean) => setMail({ ...mail, weekly_summary: v })} />
              <Toggle label={t("Monthly report")} checked={mail.monthly_report} onChange={(v: boolean) => setMail({ ...mail, monthly_report: v })} />
              <div><Button variant="primary" type="submit" disabled={busy}>{t("Save")}</Button></div>
            </form>
          </Card>
          <AlertSettings />
        </>
      )}
      <Confirm open={!!ask} danger title={t("Delete this channel?")} confirmLabel={t("Delete")} cancelLabel={t("Cancel")} onCancel={() => setAsk(null)}
        onConfirm={() => { const c = ask; setAsk(null); if (c) void run(() => deleteChannel(c.id), t("Channel deleted."), ["channels"]); }}>
        <p>{t("Alerts stop going to {target}.", { target: ask?.target ?? "" })}</p>
      </Confirm>
    </Frame>
  );
}

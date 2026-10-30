"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AlertChannel } from "@/lib/api/notifications";
import type { NotificationConfig } from "@/lib/api/settings";
import type { AlertThresholds, TenantSettings } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";

import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useChannels, useTenantSettings } from "@/lib/v2/admin-queries";
import { type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Fld, Loaded, Note, StatusWord, Sw, useCan, useDone } from "./kit";
import { ToolGrid } from "../GridTools";
import { t as tr } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";

export const KIND_LABEL: Record<AlertChannel["kind"], string> = { get email() { return tr("Email"); }, get slack() { return tr("Slack"); }, get teams() { return tr("Microsoft Teams"); }, get webhook() { return tr("Webhook (signed)"); } };
export const DIGEST_LABEL: Record<AlertChannel["digest"], string> = { get daily() { return tr("Daily digest"); }, get weekly() { return tr("Weekly digest"); }, get off() { return tr("No digest"); } };
export const PACK_LABEL = { get off() { return tr("Off"); }, get weekly() { return tr("Weekly"); }, get monthly() { return tr("Monthly"); } } as const;

const DEFAULT_THRESHOLDS: AlertThresholds = { critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {}, readiness_dqs_threshold: 75, readiness_waves: {} };
const DEFAULT_DIGEST: NotificationConfig = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };

const CHANNEL_COLUMNS: GridColumn<AlertChannel>[] = [
  { id: "kind", get header() { return tr("Type"); }, width: 150, pin: true, locked: true, cell: (c) => KIND_LABEL[c.kind] },
  { id: "target", get header() { return tr("Sends to"); }, width: 260, cell: (c) => c.target },
  { id: "digest", get header() { return tr("Digest"); }, width: 140, cell: (c) => DIGEST_LABEL[c.digest] },
  { id: "pack", get header() { return tr("Board pack"); }, width: 120, cell: (c) => (c.kind === "email" ? PACK_LABEL[c.report_pack ?? "off"] : <span className="m2-meta">{tr("Email only")}</span>) },
  { id: "crit", get header() { return tr("Critical alerts"); }, width: 140, cell: (c) => (c.immediate_critical ? tr("Sent at once") : tr("In the digest")) },
  { id: "on", get header() { return tr("Status"); }, width: 100, cell: (c) => (c.enabled ? <StatusWord tone="go">{tr("On")}</StatusWord> : <StatusWord tone="at-risk">{tr("Off")}</StatusWord>) },
];

function Thresholds({ initial, licensed }: { initial: AlertThresholds | null; licensed: string[] }) {
  const qc = useQueryClient();
  const done = useDone();
  const write = useCan()("manage_settings");
  const base = { ...DEFAULT_THRESHOLDS, ...initial };
  const [t, setT] = useState({ critical: String(base.critical_threshold), high: String(base.high_threshold), drop: String(base.dqs_drop_threshold) });
  const [floors, setFloors] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(base.module_floors ?? {}).map(([k, v]) => [k, String(v)])));
  const [add, setAdd] = useState("");
  const { outcome, pending, run } = useOutcome("alert-thresholds");
  const valid = [t.critical, t.high, t.drop].every((v) => v.trim() !== "" && Number(v) >= 0) && Object.values(floors).every((v) => v.trim() !== "" && Number(v) >= 0 && Number(v) <= 100);
  const unfloored = licensed.filter((m) => !(m in floors));
  return (
    <Block title={tr("When to alert")} hint={tr("Alert when a run has at least this many critical or high failing rules, or an object's score falls by more than the drop against the previous run.")}>
      <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Fld label={tr("Critical failing rules")}>
          <input type="number" min={0} value={t.critical} disabled={!write} onChange={(e) => setT({ ...t, critical: e.target.value })} />
        </Fld>
        <Fld label={tr("High failing rules")}>
          <input type="number" min={0} value={t.high} disabled={!write} onChange={(e) => setT({ ...t, high: e.target.value })} />
        </Fld>
        <Fld label={tr("Score drop, points")}>
          <input type="number" min={0} step={0.5} value={t.drop} disabled={!write} onChange={(e) => setT({ ...t, drop: e.target.value })} />
        </Fld>
      </div>
      <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>{tr("Score floors per object")}</h3>
      <p className="m2-prov" style={{ marginTop: 0 }}>{tr("An analysis that scores an object below its floor raises an in-app alert and a message on each channel that takes alerts.")}</p>
      {Object.keys(floors).length === 0 ? (
        <p className="m2-prov">{tr("No floors set.")}</p>
      ) : (
        <div className="m2-frame" tabIndex={0} style={{ maxWidth: 480 }}>
          <table className="m2-tbl" aria-label={tr("Score floors")}>
            <thead>
              <tr>
                <th scope="col">{tr("Object")}</th>
                <th scope="col">{tr("Floor")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {Object.keys(floors).sort().map((m) => (
                <tr key={m}>
                  <th scope="row">{moduleText(m)}</th>
                  <td>
                    <input className="m2-inp" type="number" min={0} max={100} aria-label={tr("{moduleText} floor", { moduleText: moduleText(m) })} value={floors[m]} disabled={!write} onChange={(e) => setFloors({ ...floors, [m]: e.target.value })} />
                  </td>
                  <td className="m2-r">
                    {write ? (
                      <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => setFloors(Object.fromEntries(Object.entries(floors).filter(([k]) => k !== m)))}>
                        {tr("Remove")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {write && unfloored.length ? (
        <div className="m2-fbar" style={{ marginTop: 8 }}>
          <Fld label={tr("Add a floor for")}>
            <select value={add} onChange={(e) => setAdd(e.target.value)}>
              <option value="">{tr("Choose an object")}</option>
              {unfloored.map((m) => (
                <option key={m} value={m}>
                  {moduleText(m)}
                </option>
              ))}
            </select>
          </Fld>
          <button type="button" className="m2-btn" disabled={!add} onClick={() => (setFloors({ ...floors, [add]: "80" }), setAdd(""))}>
            {tr("Add")}
          </button>
        </div>
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {write ? (
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn"
            disabled={!valid || pending !== null}
            onClick={() =>
              void run("thresholds", async () => {
                const next: AlertThresholds = { ...base, critical_threshold: Number(t.critical), high_threshold: Number(t.high), dqs_drop_threshold: Number(t.drop), module_floors: Object.fromEntries(Object.entries(floors).map(([k, v]) => [k, Number(v)])) };
                await api.saveAlertThresholds(next);
                await refreshAdmin(qc, "settings");
                done(tr("Alert thresholds saved"), async () => {
                  await api.saveAlertThresholds(base);
                  await refreshAdmin(qc, "settings");
                });
                return { tone: "ok", title: tr("Alert thresholds saved") };
              })
            }
          >
            {pending === "thresholds" ? tr("Saving…") : tr("Save thresholds")}
          </button>
        </div>
      ) : null}
    </Block>
  );
}

/** Admin › Alerts: when an alert fires, and the channels that carry it outside the app. */
export function AlertsSection() {
  const can = useCan();
  const { openItem, open } = useOpenItem();
  const write = can("manage_settings");
  const settings = useTenantSettings();
  const channels = useChannels();
  const none = channels.isSuccess && (channels.data ?? []).length === 0;
  return (
    <AdminPage
      title={tr("Alerts")}
      lead={tr("Who is told about what, and when: the thresholds that raise an alert and the channels that carry it. Alerts carry counts, rule ids and links, never record values.")}
      actions={
        write ? (
          <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "channel", id: "new" })}>
            {tr("Add a channel")}
          </button>
        ) : undefined
      }
    >
      {!write ? <Note>{tr("These settings are read only for your role.")}</Note> : null}
      {none ? <Note tone="warn">{tr("Alerts stay in the app: no channel is set up. Nobody is emailed or messaged when an alert fires or a digest is due. Add email, Slack, Teams or a webhook to send them out.")}</Note> : null}
      <Block title={tr("Channels")} hint={tr("Where alerts and digests go outside the app. A board pack channel gets the board pack and the analyst workbook for the latest finished run, weekly on Monday mornings or monthly on the 1st.")}>
        <ToolGrid<AlertChannel>
          toolsTitle={tr("Alert channels")}
          id="admin-channels"
          ariaLabel={tr("Alert channels")}
          columns={CHANNEL_COLUMNS}
          rows={channels.data ?? []}
          rowId={(c) => c.id}
          loading={channels.isPending}
          error={channels.isError ? <ErrorFrame onRetry={() => void channels.refetch()}>{tr("The channels could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(channels.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{tr("No alert channels. Add email, Slack, Teams or a webhook to send critical alerts and digests.")}</EmptyFrame>}
          onOpen={(c) => openItem({ kind: "channel", id: c.id })}
          openRowId={open?.kind === "channel" ? open.id : null}
          fixedColumns
        />
      </Block>
      <Loaded q={settings} what={tr("The alert settings")} rows={3}>
        {(s: TenantSettings) => <Thresholds key={JSON.stringify(s.alert_thresholds)} initial={s.alert_thresholds} licensed={s.licensed_modules ?? []} />}
      </Loaded>
    </AdminPage>
  );
}

function DigestForm({ initial }: { initial: NotificationConfig | null }) {
  const qc = useQueryClient();
  const done = useDone();
  const write = useCan()("manage_settings");
  const base = { ...DEFAULT_DIGEST, ...initial };
  const [d, setD] = useState<NotificationConfig>(base);
  const { outcome, pending, run } = useOutcome("default-digest");
  const emailOk = d.email.trim() === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim());
  const urlOk = d.teams_webhook.trim() === "" || /^https:\/\//i.test(d.teams_webhook.trim());
  return (
    <Block title={tr("Default digest")} hint={tr("The summary the tenant gets by default, by email and Teams. Each person sets their own digest of open items under Preferences.")}>
      <div className="m2-fgrid">
        <Fld label={tr("Email")} error={emailOk ? null : tr("Enter an email address")}>
          <input type="email" value={d.email} placeholder={tr("dq-team@company.com")} disabled={!write} onChange={(e) => setD({ ...d, email: e.target.value })} />
        </Fld>
        <Fld label={tr("Teams webhook")} error={urlOk ? null : tr("Enter an https:// address")}>
          <input type="url" value={d.teams_webhook} disabled={!write} onChange={(e) => setD({ ...d, teams_webhook: e.target.value })} />
        </Fld>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
        <legend className="m2-sr">{tr("Scheduled reports")}</legend>
        <Sw checked={d.daily_digest} disabled={!write} onChange={(v) => setD({ ...d, daily_digest: v })} label={tr("Daily digest")} />
        <Sw checked={d.weekly_summary} disabled={!write} onChange={(v) => setD({ ...d, weekly_summary: v })} label={tr("Weekly summary")} />
        <Sw checked={d.monthly_report} disabled={!write} onChange={(v) => setD({ ...d, monthly_report: v })} label={tr("Monthly report")} />
      </fieldset>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {write ? (
        <div className="m2-adm-acts">
          <button
            type="button"
            className="m2-btn"
            disabled={!emailOk || !urlOk || pending !== null}
            onClick={() =>
              void run("digest", async () => {
                await api.saveDefaultDigest(d);
                await refreshAdmin(qc, "settings");
                done(tr("Default digest saved"), async () => {
                  await api.saveDefaultDigest(base);
                  await refreshAdmin(qc, "settings");
                });
                return { tone: "ok", title: tr("Default digest saved") };
              })
            }
          >
            {pending === "digest" ? tr("Saving…") : tr("Save digest")}
          </button>
        </div>
      ) : null}
    </Block>
  );
}

/** Admin › Notifications: the tenant's default digest. */
export function NotificationsSection() {
  const settings = useTenantSettings();
  return (
    <AdminPage title={tr("Notifications")} lead={tr("What the whole tenant is sent by default. Alerts and their channels are under Alerts.")}>
      <Loaded q={settings} what={tr("The notification settings")} rows={3}>
        {(s: TenantSettings) => <DigestForm key={JSON.stringify(s.notification_config)} initial={s.notification_config} />}
      </Loaded>
    </AdminPage>
  );
}

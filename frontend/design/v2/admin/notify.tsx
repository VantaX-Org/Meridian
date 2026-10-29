"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AlertChannel } from "@/lib/api/notifications";
import type { NotificationConfig } from "@/lib/api/settings";
import type { AlertThresholds, TenantSettings } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useChannels, useTenantSettings } from "@/lib/v2/admin-queries";
import { Grid, type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Fld, Loaded, Note, StatusWord, Sw, useCan, useDone } from "./kit";

export const KIND_LABEL: Record<AlertChannel["kind"], string> = { email: "Email", slack: "Slack", teams: "Microsoft Teams", webhook: "Webhook (signed)" };
export const DIGEST_LABEL: Record<AlertChannel["digest"], string> = { daily: "Daily digest", weekly: "Weekly digest", off: "No digest" };
export const PACK_LABEL = { off: "Off", weekly: "Weekly", monthly: "Monthly" } as const;

const DEFAULT_THRESHOLDS: AlertThresholds = { critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {}, readiness_dqs_threshold: 75, readiness_waves: {} };
const DEFAULT_DIGEST: NotificationConfig = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };

const CHANNEL_COLUMNS: GridColumn<AlertChannel>[] = [
  { id: "kind", header: "Type", width: 150, pin: true, locked: true, cell: (c) => KIND_LABEL[c.kind] },
  { id: "target", header: "Sends to", width: 260, cell: (c) => c.target },
  { id: "digest", header: "Digest", width: 140, cell: (c) => DIGEST_LABEL[c.digest] },
  { id: "pack", header: "Board pack", width: 120, cell: (c) => (c.kind === "email" ? PACK_LABEL[c.report_pack ?? "off"] : <span className="m2-meta">Email only</span>) },
  { id: "crit", header: "Critical alerts", width: 140, cell: (c) => (c.immediate_critical ? "Sent at once" : "In the digest") },
  { id: "on", header: "Status", width: 100, cell: (c) => (c.enabled ? <StatusWord tone="go">On</StatusWord> : <StatusWord tone="at-risk">Off</StatusWord>) },
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
    <Block title="When to alert" hint="Alert when a run has at least this many critical or high failing rules, or an object's score falls by more than the drop against the previous run.">
      <div className="m2-fgrid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Fld label="Critical failing rules">
          <input type="number" min={0} value={t.critical} disabled={!write} onChange={(e) => setT({ ...t, critical: e.target.value })} />
        </Fld>
        <Fld label="High failing rules">
          <input type="number" min={0} value={t.high} disabled={!write} onChange={(e) => setT({ ...t, high: e.target.value })} />
        </Fld>
        <Fld label="Score drop, points">
          <input type="number" min={0} step={0.5} value={t.drop} disabled={!write} onChange={(e) => setT({ ...t, drop: e.target.value })} />
        </Fld>
      </div>
      <h3 className="m2-h2" style={{ margin: "16px 0 4px" }}>Score floors per object</h3>
      <p className="m2-prov" style={{ marginTop: 0 }}>An analysis that scores an object below its floor raises an in-app alert and a message on each channel that takes alerts.</p>
      {Object.keys(floors).length === 0 ? (
        <p className="m2-prov">No floors set.</p>
      ) : (
        <div className="m2-frame" tabIndex={0} style={{ maxWidth: 480 }}>
          <table className="m2-tbl" aria-label="Score floors">
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">Floor</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {Object.keys(floors).sort().map((m) => (
                <tr key={m}>
                  <th scope="row">{formatModuleName(m)}</th>
                  <td>
                    <input className="m2-inp" type="number" min={0} max={100} aria-label={`${formatModuleName(m)} floor`} value={floors[m]} disabled={!write} onChange={(e) => setFloors({ ...floors, [m]: e.target.value })} />
                  </td>
                  <td className="m2-r">
                    {write ? (
                      <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => setFloors(Object.fromEntries(Object.entries(floors).filter(([k]) => k !== m)))}>
                        Remove
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
          <Fld label="Add a floor for">
            <select value={add} onChange={(e) => setAdd(e.target.value)}>
              <option value="">Choose an object</option>
              {unfloored.map((m) => (
                <option key={m} value={m}>
                  {formatModuleName(m)}
                </option>
              ))}
            </select>
          </Fld>
          <button type="button" className="m2-btn" disabled={!add} onClick={() => (setFloors({ ...floors, [add]: "80" }), setAdd(""))}>
            Add
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
                done("Alert thresholds saved", async () => {
                  await api.saveAlertThresholds(base);
                  await refreshAdmin(qc, "settings");
                });
                return { tone: "ok", title: "Alert thresholds saved" };
              })
            }
          >
            {pending === "thresholds" ? "Saving…" : "Save thresholds"}
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
      title="Alerts"
      lead="Who is told about what, and when: the thresholds that raise an alert and the channels that carry it. Alerts carry counts, rule ids and links, never record values."
      actions={
        write ? (
          <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "channel", id: "new" })}>
            Add a channel
          </button>
        ) : undefined
      }
    >
      {!write ? <Note>These settings are read only for your role.</Note> : null}
      {none ? <Note tone="warn">Alerts stay in the app: no channel is set up. Nobody is emailed or messaged when an alert fires or a digest is due. Add email, Slack, Teams or a webhook to send them out.</Note> : null}
      <Block title="Channels" hint="Where alerts and digests go outside the app. A board pack channel gets the board pack and the analyst workbook for the latest finished run, weekly on Monday mornings or monthly on the 1st.">
        <Grid<AlertChannel>
          id="admin-channels"
          ariaLabel="Alert channels"
          columns={CHANNEL_COLUMNS}
          rows={channels.data ?? []}
          rowId={(c) => c.id}
          loading={channels.isPending}
          error={channels.isError ? <ErrorFrame onRetry={() => void channels.refetch()}>{`The channels could not be read. ${apiErrorMessage(channels.error)}`}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>No alert channels. Add email, Slack, Teams or a webhook to send critical alerts and digests.</EmptyFrame>}
          onOpen={(c) => openItem({ kind: "channel", id: c.id })}
          openRowId={open?.kind === "channel" ? open.id : null}
          fixedColumns
        />
      </Block>
      <Loaded q={settings} what="The alert settings" rows={3}>
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
    <Block title="Default digest" hint="The summary the tenant gets by default, by email and Teams. Each person sets their own digest of open items under Preferences.">
      <div className="m2-fgrid">
        <Fld label="Email" error={emailOk ? null : "Enter an email address"}>
          <input type="email" value={d.email} placeholder="dq-team@company.com" disabled={!write} onChange={(e) => setD({ ...d, email: e.target.value })} />
        </Fld>
        <Fld label="Teams webhook" error={urlOk ? null : "Enter an https:// address"}>
          <input type="url" value={d.teams_webhook} disabled={!write} onChange={(e) => setD({ ...d, teams_webhook: e.target.value })} />
        </Fld>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0", display: "grid", gap: 8 }}>
        <legend className="m2-sr">Scheduled reports</legend>
        <Sw checked={d.daily_digest} disabled={!write} onChange={(v) => setD({ ...d, daily_digest: v })} label="Daily digest" />
        <Sw checked={d.weekly_summary} disabled={!write} onChange={(v) => setD({ ...d, weekly_summary: v })} label="Weekly summary" />
        <Sw checked={d.monthly_report} disabled={!write} onChange={(v) => setD({ ...d, monthly_report: v })} label="Monthly report" />
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
                done("Default digest saved", async () => {
                  await api.saveDefaultDigest(base);
                  await refreshAdmin(qc, "settings");
                });
                return { tone: "ok", title: "Default digest saved" };
              })
            }
          >
            {pending === "digest" ? "Saving…" : "Save digest"}
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
    <AdminPage title="Notifications" lead="What the whole tenant is sent by default. Alerts and their channels are under Alerts.">
      <Loaded q={settings} what="The notification settings" rows={3}>
        {(s: TenantSettings) => <DigestForm key={JSON.stringify(s.notification_config)} initial={s.notification_config} />}
      </Loaded>
    </AdminPage>
  );
}

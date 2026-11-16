"use client";
/* Admin notify: Alerts (thresholds, floors, channels) and the tenant default digest. Native port of design/v2/admin/notify.tsx
   and the channel inspector in design/v2/inspector/records.tsx. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AlertChannel, AlertChannelCreate, AlertChannelKind, AlertDigest, AlertReportPack } from "@/lib/api/notifications";
import type { NotificationConfig } from "@/lib/api/settings";
import type { AlertThresholds, TenantSettings } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useChannels, useTenantSettings } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { Button, Chip, Confirm, DataTable, Sheet, useToast, type Column } from "../kit";
import { Bad, Kv, NotifyBlock, NotifyLoaded, NotifyPage } from "./notify-kit";

export const KIND_LABEL: Record<AlertChannelKind, () => string> = { email: () => t("Email"), slack: () => t("Slack"), teams: () => t("Microsoft Teams"), webhook: () => t("Webhook (signed)") };
export const DIGEST_LABEL: Record<AlertDigest, () => string> = { daily: () => t("Daily digest"), weekly: () => t("Weekly digest"), off: () => t("No digest") };
const PACK_LABEL: Record<AlertReportPack, () => string> = { off: () => t("Off"), weekly: () => t("Weekly"), monthly: () => t("Monthly") };
const KINDS: AlertChannelKind[] = ["email", "slack", "teams", "webhook"];
const DIGESTS: AlertDigest[] = ["daily", "weekly", "off"];
const PACKS: AlertReportPack[] = ["off", "weekly", "monthly"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HTTPS_RE = /^https:\/\//i;

const DEFAULT_THRESHOLDS: AlertThresholds = { critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {}, readiness_dqs_threshold: 75 };
const DEFAULT_DIGEST: NotificationConfig = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };

const channelColumns = (): Column<AlertChannel>[] => [
  { id: "kind", label: t("Type"), cell: (c) => KIND_LABEL[c.kind]() },
  { id: "target", label: t("Sends to"), cell: (c) => c.target },
  { id: "digest", label: t("Digest"), cell: (c) => DIGEST_LABEL[c.digest]() },
  { id: "pack", label: t("Board pack"), cell: (c) => (c.kind === "email" ? PACK_LABEL[c.report_pack ?? "off"]() : t("Email only")) },
  { id: "crit", label: t("Critical alerts"), cell: (c) => (c.immediate_critical ? t("Sent at once") : t("In the digest")) },
  { id: "on", label: t("Status"), cell: (c) => (c.enabled ? <Chip tone="good">{t("On")}</Chip> : <Chip tone="warn">{t("Off")}</Chip>) },
];

function Select<V extends string>({ label, value, options, text, disabled, onChange }: { label: string; value: V; options: V[]; text: (v: V) => string; disabled?: boolean; onChange: (v: V) => void }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      <select className="nx-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as V)}>
        {options.map((o) => (
          <option key={o} value={o}>{text(o)}</option>
        ))}
      </select>
    </label>
  );
}

function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: string }) {
  return (
    <label className="nx-row">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function NewChannelSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<AlertChannelKind>("email");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [digest, setDigest] = useState<AlertDigest>("daily");
  const [pack, setPack] = useState<AlertReportPack>("off");
  const [immediate, setImmediate] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const targetOk = kind === "email" ? EMAIL_RE.test(target.trim()) : HTTPS_RE.test(target.trim());
  const secretOk = kind !== "webhook" || secret === "" || (secret.length >= 16 && secret.length <= 256);
  const reachable = digest !== "off" || immediate;
  const add = async () => {
    setSaving(true);
    setFailed(null);
    try {
      const body: AlertChannelCreate = { kind, target: target.trim(), digest, immediate_critical: immediate, ...(kind === "email" && pack !== "off" ? { report_pack: pack } : {}), ...(kind === "webhook" && secret ? { secret } : {}) };
      await api.createChannel(body);
      await refreshAdmin(qc, "channels");
      toast({ tone: "good", text: t("Channel added") });
      onClose();
    } catch (e) {
      setFailed(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("Add a channel")}
      meta={<Chip>{t("New channel")}</Chip>}
      size="medium"
      dirty={target !== "" || secret !== ""}
      secondary={<Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>}
      primary={<Button variant="primary" disabled={!targetOk || !secretOk || !reachable} loading={saving} loadingLabel={t("Adding…")} onClick={() => void add()}>{t("Add the channel")}</Button>}
    >
      <div className="nx-notify-form">
        <Select label={t("Type")} value={kind} options={KINDS} text={(k) => KIND_LABEL[k]()} onChange={setKind} />
        <label className="nx-field">
          <span>{kind === "email" ? t("Address") : t("URL")}</span>
          <input className="nx-input" type={kind === "email" ? "email" : "url"} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === "email" ? t("dq-team@company.com") : t("https://")} />
        </label>
        {kind === "webhook" ? (
          <label className="nx-field">
            <span>{t("Signing secret (16 to 256 characters)")}</span>
            <input className="nx-input" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
          </label>
        ) : null}
        <Select label={t("Digest")} value={digest} options={DIGESTS} text={(d) => DIGEST_LABEL[d]()} onChange={setDigest} />
        {kind === "email" ? <Select label={t("Board pack")} value={pack} options={PACKS} text={(p) => PACK_LABEL[p]()} onChange={setPack} /> : null}
        <Check checked={immediate} onChange={setImmediate}>{t("Send new critical findings at once")}</Check>
      </div>
      {!reachable ? <Bad>{t("Choose a digest or immediate delivery, or the channel never fires.")}</Bad> : null}
      {failed ? <Bad>{failed}</Bad> : null}
    </Sheet>
  );
}

function ChannelSheet({ c, onClose }: { c: AlertChannel; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const edit = useV2Session().can("manage_settings");
  const [digest, setDigest] = useState(c.digest);
  const [pack, setPack] = useState<AlertReportPack>(c.report_pack ?? "off");
  const [immediate, setImmediate] = useState(c.immediate_critical);
  const [enabled, setEnabled] = useState(c.enabled);
  const [ask, setAsk] = useState(false);
  const [pending, setPending] = useState<"save" | "test" | "remove" | null>(null);
  const [note, setNote] = useState<{ bad: boolean; text: string } | null>(null);
  const dirty = digest !== c.digest || pack !== (c.report_pack ?? "off") || immediate !== c.immediate_critical || enabled !== c.enabled;
  const act = async (k: "save" | "test" | "remove", fn: () => Promise<void>) => {
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
  const save = () =>
    act("save", async () => {
      const prev = { digest: c.digest, immediate_critical: c.immediate_critical, enabled: c.enabled, ...(c.kind === "email" ? { report_pack: c.report_pack ?? "off" } : {}) };
      await api.updateChannel(c.id, { digest, immediate_critical: immediate, enabled, ...(c.kind === "email" ? { report_pack: pack } : {}) });
      await refreshAdmin(qc, "channels");
      toast({
        tone: "good",
        text: t("Channel saved"),
        onUndo: () => void api.updateChannel(c.id, prev).then(() => refreshAdmin(qc, "channels")),
      });
    });
  const test = () =>
    act("test", async () => {
      const r = await api.testChannel(c.id);
      setNote(r.delivered ? { bad: false, text: t("Test message delivered") } : { bad: true, text: `${t("The channel did not accept the test message")}. ${t("Check the address, and that the channel is on.")}` });
    });
  const remove = () =>
    act("remove", async () => {
      await api.deleteChannel(c.id);
      await refreshAdmin(qc, "channels");
      setAsk(false);
      toast({ tone: "good", text: t("Channel removed") });
      onClose();
    });
  return (
    <Sheet
      open
      onClose={onClose}
      title={`${KIND_LABEL[c.kind]()}: ${c.target}`}
      meta={c.enabled ? <Chip tone="good">{t("On")}</Chip> : <Chip tone="warn">{t("Off")}</Chip>}
      size="medium"
      dirty={dirty}
      secondary={<Button variant="secondary" disabled={!edit || pending !== null} loading={pending === "test"} loadingLabel={t("Sending…")} onClick={() => void test()}>{t("Send a test message")}</Button>}
      primary={<Button variant="primary" disabled={!edit || !dirty || pending !== null} loading={pending === "save"} loadingLabel={t("Saving…")} onClick={() => void save()}>{t("Save")}</Button>}
    >
      <Kv
        rows={[
          [t("Type"), KIND_LABEL[c.kind]()],
          [t("Sends to"), c.target],
          [t("Added"), formatDate(c.created_at)],
          ...(c.kind === "webhook" ? ([[t("Signing secret"), c.has_secret ? t("Stored") : t("None")]] as [string, string][]) : []),
        ]}
      />
      <h3 className="nx-notify-h3">{t("Settings")}</h3>
      <div className="nx-notify-form">
        <Select label={t("Digest")} value={digest} options={DIGESTS} text={(d) => DIGEST_LABEL[d]()} disabled={!edit} onChange={setDigest} />
        {c.kind === "email" ? <Select label={t("Board pack")} value={pack} options={PACKS} text={(p) => PACK_LABEL[p]()} disabled={!edit} onChange={setPack} /> : null}
        <Check checked={immediate} disabled={!edit} onChange={setImmediate}>{t("Send new critical findings at once")}</Check>
        <Check checked={enabled} disabled={!edit} onChange={setEnabled}>{t("Channel is on")}</Check>
      </div>
      {note ? (note.bad ? <Bad>{note.text}</Bad> : <p className="nx-note" role="status">{note.text}</p>) : null}
      <div className="nx-notify-actions">
        <Button variant="danger" disabled={!edit || pending !== null} onClick={() => setAsk(true)}>{t("Remove the channel")}</Button>
      </div>
      <Confirm
        open={ask}
        title={t("Remove the {KIND_LABEL} channel", { KIND_LABEL: KIND_LABEL[c.kind]() })}
        consequence={t("{target} stops receiving alerts and digests at once.", { target: c.target })}
        confirmLabel={t("Remove the channel")}
        danger
        onCancel={() => setAsk(false)}
        onConfirm={() => void remove()}
      />
    </Sheet>
  );
}

function Thresholds({ initial, licensed }: { initial: AlertThresholds | null; licensed: string[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const write = useV2Session().can("manage_settings");
  const base = { ...DEFAULT_THRESHOLDS, ...initial };
  const [v, setV] = useState({ critical: String(base.critical_threshold), high: String(base.high_threshold), drop: String(base.dqs_drop_threshold) });
  const [floors, setFloors] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(base.module_floors ?? {}).map(([k, x]) => [k, String(x)])));
  const [add, setAdd] = useState("");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const valid = [v.critical, v.high, v.drop].every((x) => x.trim() !== "" && Number(x) >= 0) && Object.values(floors).every((x) => x.trim() !== "" && Number(x) >= 0 && Number(x) <= 100);
  const unfloored = licensed.filter((m) => !(m in floors));
  const floorRows = Object.keys(floors).sort();
  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      const next: AlertThresholds = { ...base, critical_threshold: Number(v.critical), high_threshold: Number(v.high), dqs_drop_threshold: Number(v.drop), module_floors: Object.fromEntries(Object.entries(floors).map(([k, x]) => [k, Number(x)])) };
      await api.saveAlertThresholds(next);
      await refreshAdmin(qc, "settings");
      toast({ tone: "good", text: t("Alert thresholds saved"), onUndo: () => void api.saveAlertThresholds(base).then(() => refreshAdmin(qc, "settings")) });
    } catch (e) {
      setFailed(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const num = (label: string, key: keyof typeof v, step?: number) => (
    <label className="nx-field">
      <span>{label}</span>
      <input className="nx-input" type="number" min={0} step={step} value={v[key]} disabled={!write} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
    </label>
  );
  return (
    <NotifyBlock title={t("When to alert")} hint={t("Alert when a run has at least this many critical or high failing rules, or an object's score falls by more than the drop against the previous run.")}>
      <div className="nx-notify-form">
        {num(t("Critical failing rules"), "critical")}
        {num(t("High failing rules"), "high")}
        {num(t("Score drop, points"), "drop", 0.5)}
      </div>
      <h3 className="nx-notify-h3">{t("Score floors per object")}</h3>
      <p className="nx-sub">{t("An analysis that scores an object below its floor raises an in-app alert and a message on each channel that takes alerts.")}</p>
      {floorRows.length === 0 ? (
        <p className="nx-sub">{t("No floors set.")}</p>
      ) : (
        <DataTable
          caption={t("Score floors")}
          rows={floorRows}
          rowKey={(m) => m}
          rowLabel={(m) => moduleText(m)}
          columns={[
            { id: "object", label: t("Object"), cell: (m) => moduleText(m) },
            {
              id: "floor",
              label: t("Floor"),
              cell: (m) => <input className="nx-input" type="number" min={0} max={100} aria-label={t("{moduleText} floor", { moduleText: moduleText(m) })} value={floors[m]} disabled={!write} onChange={(e) => setFloors({ ...floors, [m]: e.target.value })} />,
            },
            {
              id: "remove",
              label: t("Remove"),
              align: "end",
              cell: (m) => (write ? <Button variant="quiet" size={32} onClick={() => setFloors(Object.fromEntries(Object.entries(floors).filter(([k]) => k !== m)))}>{t("Remove")}</Button> : null),
            },
          ]}
        />
      )}
      {write && unfloored.length ? (
        <div className="nx-notify-actions">
          <label className="nx-field">
            <span>{t("Add a floor for")}</span>
            <select className="nx-input" value={add} onChange={(e) => setAdd(e.target.value)}>
              <option value="">{t("Choose an object")}</option>
              {unfloored.map((m) => (
                <option key={m} value={m}>{moduleText(m)}</option>
              ))}
            </select>
          </label>
          <Button variant="secondary" disabled={!add} onClick={() => (setFloors({ ...floors, [add]: "80" }), setAdd(""))}>{t("Add")}</Button>
        </div>
      ) : null}
      {failed ? <Bad>{failed}</Bad> : null}
      {write ? (
        <div className="nx-notify-actions">
          <Button variant="primary" disabled={!valid} loading={saving} loadingLabel={t("Saving…")} onClick={() => void save()}>{t("Save thresholds")}</Button>
        </div>
      ) : null}
    </NotifyBlock>
  );
}

/** Admin, Alerts: when an alert fires, and the channels that carry it outside the app. */
export function AlertsSection() {
  const write = useV2Session().can("manage_settings");
  const settings = useTenantSettings();
  const channels = useChannels();
  const [open, setOpen] = useState<string | null>(null);
  const none = channels.isSuccess && (channels.data ?? []).length === 0;
  const opened = open && open !== "new" ? channels.data?.find((c) => c.id === open) : undefined;
  return (
    <NotifyPage
      lead={t("Who is told about what, and when: the thresholds that raise an alert and the channels that carry it. Alerts carry counts, rule ids and links, never record values.")}
      actions={write ? <Button variant="primary" onClick={() => setOpen("new")}>{t("Add a channel")}</Button> : undefined}
    >
      {!write ? <p className="nx-note">{t("These settings are read only for your role.")}</p> : null}
      {none ? <p className="nx-note nx-notify-warn" role="status">{t("Alerts stay in the app: no channel is set up. Nobody is emailed or messaged when an alert fires or a digest is due. Add email, Slack, Teams or a webhook to send them out.")}</p> : null}
      <NotifyBlock title={t("Channels")} hint={t("Where alerts and digests go outside the app. A board pack channel gets the board pack and the analyst workbook for the latest finished run, weekly on Monday mornings or monthly on the 1st.")}>
        <DataTable
          caption={t("Alert channels")}
          rows={channels.data ?? []}
          columns={channelColumns()}
          rowKey={(c) => c.id}
          rowLabel={(c) => `${KIND_LABEL[c.kind]()}: ${c.target}`}
          loading={channels.isPending}
          error={channels.isError ? { sentence: t("The channels could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(channels.error) }), onRetry: () => void channels.refetch() } : undefined}
          empty={{ heading: t("No alert channels. Add email, Slack, Teams or a webhook to send critical alerts and digests.") }}
          onOpenRow={(c) => setOpen(c.id)}
        />
      </NotifyBlock>
      <NotifyLoaded q={settings} what={t("The alert settings")} rows={3}>
        {(s: TenantSettings) => <Thresholds key={JSON.stringify(s.alert_thresholds)} initial={s.alert_thresholds} licensed={s.licensed_modules ?? []} />}
      </NotifyLoaded>
      {open === "new" ? <NewChannelSheet onClose={() => setOpen(null)} /> : null}
      {opened ? <ChannelSheet key={opened.id} c={opened} onClose={() => setOpen(null)} /> : null}
    </NotifyPage>
  );
}

function DigestForm({ initial }: { initial: NotificationConfig | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const write = useV2Session().can("manage_settings");
  const base = { ...DEFAULT_DIGEST, ...initial };
  const [d, setD] = useState<NotificationConfig>(base);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const emailOk = d.email.trim() === "" || EMAIL_RE.test(d.email.trim());
  const urlOk = d.teams_webhook.trim() === "" || HTTPS_RE.test(d.teams_webhook.trim());
  const save = async () => {
    setSaving(true);
    setFailed(null);
    try {
      await api.saveDefaultDigest(d);
      await refreshAdmin(qc, "settings");
      toast({ tone: "good", text: t("Default digest saved"), onUndo: () => void api.saveDefaultDigest(base).then(() => refreshAdmin(qc, "settings")) });
    } catch (e) {
      setFailed(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <NotifyBlock title={t("Channels and frequency")} hint={t("The summary the tenant gets by default, by email and Teams. Each person sets their own digest of open work under Preferences.")}>
      <div className="nx-notify-form">
        <label className="nx-field">
          <span>{t("Email")}</span>
          <input className="nx-input" type="email" value={d.email} placeholder={t("dq-team@company.com")} disabled={!write} aria-invalid={!emailOk} onChange={(e) => setD({ ...d, email: e.target.value })} />
          {emailOk ? null : <span className="nx-notify-bad" role="alert">{t("Enter an email address")}</span>}
        </label>
        <label className="nx-field">
          <span>{t("Teams webhook")}</span>
          <input className="nx-input" type="url" value={d.teams_webhook} disabled={!write} aria-invalid={!urlOk} onChange={(e) => setD({ ...d, teams_webhook: e.target.value })} />
          {urlOk ? null : <span className="nx-notify-bad" role="alert">{t("Enter an https:// address")}</span>}
        </label>
      </div>
      <fieldset className="nx-field">
        <legend className="nx-sr">{t("Scheduled reports")}</legend>
        <Check checked={d.daily_digest} disabled={!write} onChange={(x) => setD({ ...d, daily_digest: x })}>{t("Daily digest")}</Check>
        <Check checked={d.weekly_summary} disabled={!write} onChange={(x) => setD({ ...d, weekly_summary: x })}>{t("Weekly summary")}</Check>
        <Check checked={d.monthly_report} disabled={!write} onChange={(x) => setD({ ...d, monthly_report: x })}>{t("Monthly report")}</Check>
      </fieldset>
      {failed ? <Bad>{failed}</Bad> : null}
      {write ? (
        <div className="nx-notify-actions">
          <Button variant="primary" disabled={!emailOk || !urlOk} loading={saving} loadingLabel={t("Saving…")} onClick={() => void save()}>{t("Save digest")}</Button>
        </div>
      ) : null}
    </NotifyBlock>
  );
}

/** Admin, Default digest: the tenant's default digest. Also rendered inside the notify flow sheet, so no page chrome. */
export function NotificationsSectionNative() {
  const settings = useTenantSettings();
  return (
    <NotifyPage lead={t("What the whole tenant is sent by default. Alerts and their channels are under Alerts.")}>
      <NotifyLoaded q={settings} what={t("The notification settings")} rows={3}>
        {(s: TenantSettings) => <DigestForm key={JSON.stringify(s.notification_config)} initial={s.notification_config} />}
      </NotifyLoaded>
    </NotifyPage>
  );
}

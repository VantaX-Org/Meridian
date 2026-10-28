"use client";

/**
 * Admin › Alerts: who is told about what, and when, in one place. When to alert (thresholds and score floors),
 * where alerts go (channels) and the digest everyone gets by default. Saving needs manage_settings; anyone else who
 * can open the page reads it. Score weights and bands are on Rules › Scoring; a person's own digest is in Preferences.
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Field, Input, Notice, PageFrame, PageHeader, Select, Skeleton, toast } from "@/design";
import { SettingsSection, SettingsSheet } from "@/components/mdm/ledger";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { useRole } from "@/hooks/use-role";
import { getSettings, saveNotificationSettings, updateAlertThresholds, type NotificationConfig } from "@/lib/api/settings";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { AlertThresholds, TenantSettings } from "@/types/api";
import { ChannelsSection } from "./channels-section";

const DEFAULT_THRESHOLDS: AlertThresholds = {
  critical_threshold: 1, high_threshold: 10, dqs_drop_threshold: 5, module_floors: {},
  readiness_dqs_threshold: 75, readiness_waves: {},
};
const DEFAULT_DIGEST: NotificationConfig = { email: "", teams_webhook: "", daily_digest: false, weekly_summary: true, monthly_report: true };
const DIGEST_FIELDS = [["daily_digest", "Daily digest"], ["weekly_summary", "Weekly summary"], ["monthly_report", "Monthly report"]] as const;

export default function AlertsPage() {
  const settings = useQuery({ queryKey: queryKeys.scoringSettings(), queryFn: getSettings });
  const header = (
    <PageHeader
      tabs={<SettingsTabs />}
      title="Alerts"
      meta="Who is told about what, and when: the thresholds that raise an alert, the channels that carry it and the default digest"
    />
  );
  if (!settings.data) {
    return (
      <PageFrame gap={4}>
        {header}
        {settings.isError ? (
          <ErrorState title="Settings could not be loaded." message={apiErrorMessage(settings.error)} onRetry={() => void settings.refetch()} />
        ) : (
          <div className="flex flex-col gap-2"><Skeleton height={32} /><Skeleton height={32} /><Skeleton height={32} /></div>
        )}
      </PageFrame>
    );
  }
  // keyed on the fetch so a saved value re-seeds the forms without a setState-in-effect
  return <AlertsForm key={settings.dataUpdatedAt} initial={settings.data} header={header} />;
}

function AlertsForm({ initial, header }: { initial: TenantSettings; header: React.ReactNode }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("manage_settings");
  const [thresholds, setThresholds] = useState<AlertThresholds>({ ...DEFAULT_THRESHOLDS, ...initial.alert_thresholds });
  const [digest, setDigest] = useState<NotificationConfig>({ ...DEFAULT_DIGEST, ...initial.notification_config });
  const floors = thresholds.module_floors ?? {};
  const unfloored = (initial.licensed_modules ?? []).filter((m) => !(m in floors));
  const setFloor = (module: string, value: number | null) => {
    const next = { ...floors };
    if (value == null) delete next[module];
    else next[module] = value;
    setThresholds({ ...thresholds, module_floors: next });
  };

  const saveThresholds = useMutation({
    mutationFn: () => updateAlertThresholds(thresholds),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.scoringSettings() }); toast.success("Alert thresholds saved"); },
    onError: (e) => toast.error(`Thresholds not saved. ${apiErrorMessage(e)}`),
  });
  const saveDigest = useMutation({
    mutationFn: () => saveNotificationSettings(digest),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.scoringSettings() }); toast.success("Default digest saved"); },
    onError: (e) => toast.error(`Digest not saved. ${apiErrorMessage(e)}`),
  });

  return (
    <PageFrame gap={4}>
      {header}
      {!write ? <Notice tone="info">These settings are read only for your role</Notice> : null}
      <SettingsSheet>
        <SettingsSection title="When to alert" hint="Alert when a run has at least this many critical or high failing rules, or an object's score falls by more than the drop against the previous run">
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveThresholds.mutate(); }}>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Critical failing rules">
                <Input type="number" min="0" value={thresholds.critical_threshold} disabled={!write}
                  onChange={(e) => setThresholds({ ...thresholds, critical_threshold: Number(e.target.value) })} />
              </Field>
              <Field label="High failing rules">
                <Input type="number" min="0" value={thresholds.high_threshold} disabled={!write}
                  onChange={(e) => setThresholds({ ...thresholds, high_threshold: Number(e.target.value) })} />
              </Field>
              <Field label="Score drop, points">
                <Input type="number" min="0" step="0.5" value={thresholds.dqs_drop_threshold} disabled={!write}
                  onChange={(e) => setThresholds({ ...thresholds, dqs_drop_threshold: Number(e.target.value) })} />
              </Field>
            </div>
            <div>
              <h3 className="m-text-body font-semibold mb-1">Score floors per object</h3>
              <p className="m-text-meta mb-2 m-ink-3">An analysis that scores an object below its floor raises an in-app alert, and a message on each channel below that takes alerts.</p>
              <table className="m-table [max-width:480px]">
                <thead><tr><th>Object</th><th>Floor</th><th /></tr></thead>
                <tbody>
                  {Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => (
                    <tr key={m}>
                      <td>{formatModuleName(m)}</td>
                      <td>
                        <Input type="number" min="0" max="100" step="1" value={v} disabled={!write} aria-label={`${formatModuleName(m)} floor`}
                          onChange={(e) => setFloor(m, Math.min(100, Math.max(0, Number(e.target.value))))} />
                      </td>
                      <td>{write ? <Button type="button" variant="ghost" onClick={() => setFloor(m, null)}>Remove</Button> : null}</td>
                    </tr>
                  ))}
                  {!Object.keys(floors).length ? <tr><td colSpan={3} className="m-text-meta m-ink-3">No floors set</td></tr> : null}
                </tbody>
              </table>
              {write && unfloored.length ? (
                <div className="mt-2 [max-width:260px]">
                  <Select
                    label="Add a floor for"
                    value="" placeholder="Add a floor for"
                    options={unfloored.map((m) => ({ value: m, label: formatModuleName(m) }))}
                    onValueChange={(m) => m && setFloor(m, 80)} />
                </div>
              ) : null}
            </div>
            {write ? <div><Button type="submit" pending={saveThresholds.isPending}>Save thresholds</Button></div> : null}
          </form>
        </SettingsSection>

        <SettingsSection title="Channels" hint="Where alerts and digests go outside the app. Alerts carry counts, rule ids and links, never record values. A board pack channel gets the board pack and the analyst workbook for the latest finished run: weekly on Monday mornings, or monthly on the 1st">
          <ChannelsSection canEdit={write} />
        </SettingsSection>

        <SettingsSection title="Default digest" hint="The summary the tenant gets by default, by email and Teams">
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); saveDigest.mutate(); }}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Email">
                <Input type="email" value={digest.email} disabled={!write} placeholder="dq-team@company.com"
                  onChange={(e) => setDigest({ ...digest, email: e.target.value })} />
              </Field>
              <Field label="Teams webhook">
                <Input type="url" value={digest.teams_webhook} disabled={!write}
                  onChange={(e) => setDigest({ ...digest, teams_webhook: e.target.value })} />
              </Field>
            </div>
            <fieldset className="flex gap-4 [border:0] [margin:0] [padding:0]">
              <legend className="sr-only">Scheduled reports</legend>
              {DIGEST_FIELDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 m-text-body">
                  <input type="checkbox" checked={digest[k]} disabled={!write} onChange={(e) => setDigest({ ...digest, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </fieldset>
            <p className="m-text-meta m-ink-3">
              This is the default for the tenant. Each person sets their own digest of open items in <Link className="underline" href="/me/preferences">Your own digest</Link>.
            </p>
            {write ? <div><Button type="submit" pending={saveDigest.isPending}>Save digest</Button></div> : null}
          </form>
        </SettingsSection>
      </SettingsSheet>
      <p className="m-text-body m-ink-3">
        How the score is weighted and banded is set in <Link className="underline" href="/rules/scoring">Scoring</Link>.
      </p>
    </PageFrame>
  );
}

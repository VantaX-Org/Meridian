// frontend/app/(app)/objects/[object]/_monitor.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Mono, Skeleton, Stat, toast } from "@/design";
import { GatedPrimary } from "@/components/gated-primary";
import { DrillCount } from "@/app/(app)/insights/_components/DrillCount";
import { CronPicker, presetLabel } from "@/app/(app)/systems/[systemId]/schedules-panel";
import { FreshnessPill } from "../_freshness";
import { useRole } from "@/hooks/use-role";
import { getObjectMonitor, recheckObject, type ObjectMonitor } from "@/lib/api/v1/objects";
import { updateSyncProfile } from "@/lib/api/systems";
import { pinBaseline } from "@/lib/api/versions";
import { apiErrorMessage } from "@/lib/error";
import { fixHref } from "@/lib/drill";
import { formatDate, formatModuleName, plural, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { TENANT_TIMEZONE_HREF, useTenantTimezone } from "@/lib/tenant-zone";

/** What the freshness pill means, in a line under it. */
function freshnessHint(m: ObjectMonitor): string {
  if (!m.last_run_at) return m.cadence.cron ? "Waiting for the first run" : "Nothing has run yet";
  switch (m.freshness) {
    case "fresh": return "On schedule";
    case "due": return "A check is due now";
    case "stale": return "Overdue for a check";
    case "failed": return "The last extraction failed";
    case "paused": return "The schedule is paused";
    default: return `Last checked ${relativeTime(m.last_run_at)}`;
  }
}

/** Who or what started the last run, as the Checked tile's hint. */
function startedHint(m: ObjectMonitor): string | undefined {
  switch (m.trigger) {
    case "scheduled": return "Started by the schedule";
    case "upload": return "Started by an upload";
    case "recheck": return m.requested_by_label ? `Re-check by ${m.requested_by_label}` : "Re-check";
    case "manual": return m.requested_by_label ? `Started by ${m.requested_by_label}` : "Started by hand";
    default: return undefined;
  }
}

/** The Cadence tile's value: the preset, "Manual only" or "Paused". */
export function cadenceText(m: ObjectMonitor): string {
  if (!m.cadence.cron) return "Manual only";
  return m.cadence.active === false ? "Paused" : presetLabel(m.cadence.cron);
}

/**
 * The object's monitor, one row of tiles under the page header: when it was checked and by what, how often, when
 * next, whether it is fresh, which run it is compared with and what changed since. Read from
 * `GET /objects/{module}/monitor`; it replaces the Fix Monitor tab, one object at a time.
 */
export function ObjectMonitorStrip({ object, run }: { object: string; run: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const tz = useTenantTimezone();
  const [editing, setEditing] = useState(false);
  const name = formatModuleName(object);
  const q = useQuery({
    queryKey: queryKeys.objectMonitor(object, run || "latest"),
    queryFn: () => getObjectMonitor(object, run || undefined),
    enabled: !!run,
    retry: false,
    meta: { ignoreError: true },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["object"] });
  const recheck = useMutation({
    mutationFn: () => recheckObject(object),
    onSuccess: (r) => {
      if (r.queued.length > 0) toast.success(`Checking ${name} again. The result appears here when the run finishes.`);
      else toast.error(`${name} is already being checked`);
      void refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const pin = useMutation({
    mutationFn: (versionId: string) => pinBaseline(versionId),
    onSuccess: () => { toast.success("Pinned as the baseline"); void refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const reschedule = useMutation({
    mutationFn: (v: { systemId: string; profileId: string; cron: string }) => updateSyncProfile(v.systemId, v.profileId, { schedule_cron: v.cron }),
    onSuccess: () => { toast.success("Schedule saved"); setEditing(false); void refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (q.isLoading) return <div aria-busy="true"><Skeleton height={84} /></div>;
  const m = q.data;
  // The API has no monitor for this object (never run, never scheduled) or could not be read: the page stands without it.
  if (!m) return null;

  const { cadence, baseline, drift } = m;
  const zone = tz.replace(/_/g, " ");
  const scheduled = Boolean(cadence.cron);
  const runId = m.last_version_id ?? run;
  const systemHref = m.system_id ? `/systems/${m.system_id}?tab=health` : undefined;
  const compareHref = m.last_version_id && baseline.version_id ? `/runs/${m.last_version_id}/vs/${baseline.version_id}` : undefined;
  const hasBaseline = baseline.kind != null;
  const pinned = baseline.kind === "pinned";
  const onlyRule = drift.newly_failing_rule_count === 1 ? drift.newly_failing_rules[0]?.check_id : undefined;
  const canPin = can("analyse") && !!m.last_version_id && !(pinned && baseline.version_id === m.last_version_id);
  const shownRules = drift.newly_failing_rules.slice(0, 2);
  const moreRules = drift.newly_failing_rule_count - shownRules.length;

  return (
    <section aria-label={`Monitor of ${name}`} className="flex flex-col gap-3" data-testid="object-monitor">
      <div className="m-stat-grid">
        {m.last_run_at ? (
          <Stat label="Checked" value={relativeTime(m.last_run_at)} hint={startedHint(m)} href={m.last_version_id ? `/runs/${m.last_version_id}` : undefined} />
        ) : (
          <Stat label="Checked" value="Not checked yet" hint={scheduled ? "Its schedule has not started a run yet" : undefined} />
        )}
        <Stat label="Cadence" value={cadenceText(m)} hint={scheduled ? zone : "Runs when someone starts one"} href={systemHref} />
        <Stat
          label="Next check"
          value={scheduled && cadence.active !== false && m.next_run_at ? formatDate(m.next_run_at, "datetime", tz) : "—"}
          hint={cadence.active === false ? "The schedule is paused" : scheduled ? undefined : "No schedule"}
        />
        <Stat label="Freshness" value={<FreshnessPill value={m.freshness} />} hint={freshnessHint(m)} />
        <Stat
          label="Baseline"
          value={pinned ? `Pinned run of ${formatDate(baseline.run_at, "date")}` : hasBaseline ? "Previous run" : "None yet"}
          hint={pinned ? undefined : hasBaseline ? `${formatDate(baseline.run_at, "date")}, chosen automatically` : m.last_run_at ? "Needs a second run" : undefined}
          href={baseline.version_id ? `/runs/${baseline.version_id}` : undefined}
        />
        {hasBaseline ? (
          <>
            <Stat
              label="Newly failing rules"
              value={drift.newly_failing_rule_count.toLocaleString()}
              tone={drift.newly_failing_rule_count > 0 ? "no-go" : "go"}
              hint={
                <>
                  <DrillCount
                    count={drift.new_failing}
                    href={fixHref({ run: runId, module: object, check: onlyRule, since: baseline.version_id ?? undefined })}
                    label={`Open the ${plural(drift.new_failing, "new failing record")} of ${name}`}
                  >
                    {plural(drift.new_failing, "new failing record")}
                  </DrillCount>
                  {shownRules.length > 0 ? (
                    <>
                      {", "}
                      {shownRules.map((r, i) => <span key={r.check_id}>{i > 0 ? ", " : ""}<Mono>{r.check_id}</Mono></span>)}
                      {moreRules > 0 ? ` and ${moreRules.toLocaleString()} more` : ""}
                    </>
                  ) : null}
                </>
              }
            />
            <Stat
              label="Recovered rules"
              value={drift.recovered_rule_count.toLocaleString()}
              tone={drift.recovered_rule_count > 0 ? "go" : undefined}
              hint={
                <DrillCount count={drift.recovered} href={compareHref} label={`Compare this run with its baseline: ${plural(drift.recovered, "recovered record")} of ${name}`}>
                  {plural(drift.recovered, "recovered record")}
                </DrillCount>
              }
            />
          </>
        ) : (
          <Stat label="Since baseline" value={m.last_run_at ? "First run" : "No run yet"} hint={m.last_run_at ? "Changes show from the second run" : undefined} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {m.system_id ? (
          <GatedPrimary
            kind="extract"
            allowed={can("trigger_sync")}
            systemId={m.system_id}
            scopeLabel={name}
            variant="secondary"
            pending={recheck.isPending}
            onClick={() => recheck.mutate()}
          >
            Re-check now
          </GatedPrimary>
        ) : (
          <Button variant="secondary" render={<Link href="/import">Upload a new file</Link>} />
        )}
        {!scheduled && systemHref && can("manage_systems") ? <Button variant="secondary" render={<Link href={systemHref}>Set schedule</Link>} /> : null}
        {scheduled && m.system_id && cadence.profile_id && can("manage_systems") ? (
          <Button variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>Change schedule</Button>
        ) : null}
        {canPin ? <Button variant="ghost" pending={pin.isPending} onClick={() => m.last_version_id && pin.mutate(m.last_version_id)}>Pin this run as baseline</Button> : null}
        <Link href={TENANT_TIMEZONE_HREF} className="m-text-meta m-ink-3 underline underline-offset-2">Times in {zone}</Link>
      </div>

      {editing && m.system_id && cadence.profile_id ? (
        <CronPicker
          value={cadence.cron ?? ""}
          disabled={reschedule.isPending}
          onChange={(cron) => reschedule.mutate({ systemId: m.system_id as string, profileId: cadence.profile_id as string, cron })}
        />
      ) : null}
    </section>
  );
}

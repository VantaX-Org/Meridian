"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, ConfirmDialog, ErrorState, Select, Skeleton, Status, toast } from "@/design";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { getSystemObjects } from "@/lib/api/system-objects";
import { getObjectsMonitor } from "@/lib/api/v1/objects";
import { FreshnessPill } from "@/app/(app)/objects/_freshness";
import { createSyncProfile, deleteSyncProfile, getSyncProfiles, updateSyncProfile } from "@/lib/api/systems";
import type { SyncProfile } from "@/types/api";
import { TENANT_TIMEZONE_HREF, useTenantTimezone } from "@/lib/tenant-zone";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { ProcessSchedules } from "@/app/(app)/process/_components/schedules-card";
import { useRole } from "@/hooks/use-role";
import { CronPicker, PRESETS, cronError, presetLabel } from "./cron-picker";

// The picker lives in cron-picker.tsx so the process schedules card can use it without importing this panel.
export { CronPicker, cronError, presetLabel };

const MODES = [
  { value: "full", label: "Full extraction" },
  { value: "delta", label: "Changes only" },
];
const modeLabel = (m: string | undefined) => MODES.find((x) => x.value === m)?.label ?? "Full extraction";

/** Extract schedules, then the process discovery schedules of the same system as a second section. */
export function SchedulesPanel({ id, canManage }: { id: string; canManage: boolean }) {
  const { can } = useRole();
  return (
    <div className="flex flex-col gap-4">
      <ExtractSchedules id={id} canManage={canManage} />
      <ProcessSchedules systemId={id} canManage={can("run_process_discovery")} title="Process discovery" />
    </div>
  );
}

function ExtractSchedules({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient();
  // Schedules run on the tenant's clock (Admin › Triage settings), so their times are shown in it.
  const tz = useTenantTimezone();
  const profilesQ = useQuery({ queryKey: queryKeys.syncProfiles(id), queryFn: () => getSyncProfiles(id) });
  const profiles = profilesQ.data ?? [];
  // How fresh each scheduled object is against its own cadence, joined to its schedule by profile; no row reads "—".
  const monitorQ = useQuery({ queryKey: queryKeys.objectsMonitor(), queryFn: getObjectsMonitor, retry: false, meta: { ignoreError: true } });
  const freshnessOf = (p: SyncProfile) => monitorQ.data?.find((m) => m.cadence.profile_id === p.id || (m.system_id === id && m.module === p.domain))?.freshness;
  const { data: catalogue } = useQuery({ queryKey: queryKeys.systemObjects(id), queryFn: () => getSystemObjects(id), enabled: canManage });
  const [adding, setAdding] = useState("");
  const [cron, setCron] = useState(PRESETS[1].value);
  const [mode, setMode] = useState<"full" | "delta">("full");
  const [removing, setRemoving] = useState<SyncProfile | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.syncProfiles(id) });
  const onError = (e: unknown) => toast.error(apiErrorMessage(e));

  const update = useMutation({
    mutationFn: ({ p, body }: { p: SyncProfile; body: { schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" } }) => updateSyncProfile(id, p.id, body),
    onSuccess: (saved) => { toast.success(saved.next_run_at ? `Schedule saved. Next run ${formatDate(saved.next_run_at, "datetime", tz)}` : "Schedule saved"); refresh(); },
    onError,
  });
  const create = useMutation({
    mutationFn: () => {
      const o = catalogue?.objects.find((x) => x.object === adding);
      return createSyncProfile(id, { system_id: id, domain: adding, tables: o?.tables ?? [], schedule_cron: cron, active: true, extraction_mode: mode });
    },
    onSuccess: (saved) => { toast.success(saved.next_run_at ? `Schedule added. Next run ${formatDate(saved.next_run_at, "datetime", tz)}` : "Schedule added"); setAdding(""); refresh(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (p: SyncProfile) => deleteSyncProfile(id, p.id),
    onSuccess: () => { toast.success("Schedule deleted"); setRemoving(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e) || "Could not delete the schedule"),
  });
  const scheduled = new Set(profiles.map((p) => p.domain));
  const addable = (catalogue?.objects ?? []).filter((o) => !scheduled.has(o.object));

  return (
    <Card title="Scheduled extracts" meta="Pull an object again on a timetable, so its score stays current without anyone pressing Extract" dataTour="schedules">
      <div className="flex flex-col gap-3">
        <p className="m-text-body m-ink-2">
          Each schedule downloads the object again and re-runs its checks, so trends and alerts see every run.
          Schedules run and times are shown in the tenant time zone,{" "}
          <Link href={TENANT_TIMEZONE_HREF} className="m-ink-accent underline underline-offset-2">{tz.replace(/_/g, " ")}</Link>; due runs start within 5 minutes.
          &ldquo;Changes only&rdquo; reads just the records SAP changed since the last download, with a full download at least once a week.
        </p>
        {profilesQ.isLoading ? <Skeleton height={120} /> : profilesQ.isError ? (
          <ErrorState {...apiErrorState(profilesQ.error)} onRetry={() => void profilesQ.refetch()} />
        ) : profiles.length ? (
          <table className="m-table">
            <thead><tr>
              <th>Object</th><th>Schedule</th>
              <th>Mode</th>
              <th>Last run</th><th>Next run</th>
              <th>Freshness</th><th>Status</th><th />
            </tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>{formatModuleName(p.domain)}</td>
                  <td>
                    {canManage
                      ? <CronPicker value={p.schedule_cron ?? ""} disabled={update.isPending}
                          onChange={(c) => update.mutate({ p, body: { schedule_cron: c } })} />
                      : <span>{presetLabel(p.schedule_cron)}</span>}
                    <span className="block m-text-meta m-ink-3">{tz.replace(/_/g, " ")}</span>
                  </td>
                  <td>
                    {canManage
                      ? <Select
                          label="Extraction mode"
                          value={p.extraction_mode ?? "full"} options={MODES}
                          onValueChange={(v) => update.mutate({ p, body: { extraction_mode: v === "delta" ? "delta" : "full" } })} />
                      : <span>{modeLabel(p.extraction_mode)}</span>}
                  </td>
                  <td>{p.last_run_at ? <span title={formatDate(p.last_run_at, "datetime", tz)}>{relativeTime(p.last_run_at)}</span> : "Never"}</td>
                  <td>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime", tz) : "—"}</td>
                  <td>{freshnessOf(p) ? <FreshnessPill value={freshnessOf(p) as string} /> : "—"}</td>
                  <td><Status kind="lifecycle" value={p.active ? "active" : "paused"} /></td>
                  <td>
                    {canManage && (
                      <div className="flex gap-1">
                        <Button variant="ghost" disabled={update.isPending}
                          onClick={() => update.mutate({ p, body: { active: !p.active } })}>
                          {p.active ? "Pause" : "Resume"}
                        </Button>
                        <Button variant="ghost" disabled={remove.isPending} onClick={() => setRemoving(p)}>Delete</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="m-text-body m-ink-2">
            No schedules yet. Objects are only checked again when someone presses Extract{canManage ? ". Pick an object below to schedule it" : ""}.
          </p>
        )}
        {canManage && addable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="[width:220px]">
              <Select
                label="Schedule an object"
                placeholder="Schedule an object…" value={adding}
                options={addable.map((o) => ({ value: o.object, label: formatModuleName(o.object) }))} onValueChange={setAdding} />
            </div>
            <CronPicker value={cron} onChange={setCron} />
            <div className="[width:160px]">
              <Select label="Extraction mode" value={mode} options={MODES} onValueChange={(v) => setMode(v === "delta" ? "delta" : "full")} />
            </div>
            <Button disabled={!adding || create.isPending || !!cronError(cron)} onClick={() => create.mutate()}>Add schedule</Button>
          </div>
        )}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(o) => { if (!o) setRemoving(null); }}
          title={`Delete the ${removing ? formatModuleName(removing.domain) : ""} schedule`}
          tone="danger"
          body={`${removing ? formatModuleName(removing.domain) : "This object"} is no longer extracted on a schedule (${presetLabel(removing?.schedule_cron ?? null).toLowerCase()}). Its extraction log goes with it; runs and findings already analysed stay.`}
          confirmLabel="Delete schedule"
          cancelLabel="Keep"
          pending={remove.isPending}
          onConfirm={() => { if (removing) remove.mutate(removing); }}
        />
      </div>
    </Card>
  );
}

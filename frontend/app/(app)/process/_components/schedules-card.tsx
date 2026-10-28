"use client";

/**
 * Process discovery schedules of one system: one row per process (L1) with its cadence, last and next run and
 * freshness. Creating, changing, pausing and deleting need `run_process_discovery`; everyone else reads. Shown on
 * Process › Discovery runs and, as its own section, on the system's schedules panel.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, ConfirmDialog, ErrorState, Select, Skeleton, Status, toast } from "@/design";
import { CronPicker, PRESETS, cronError, presetLabel } from "@/app/(app)/systems/[systemId]/cron-picker";
import { FreshnessPill } from "@/app/(app)/objects/_freshness";
import {
  createProcessSchedule, deleteProcessSchedule, getCatalogue, getProcessHealth, listProcessSchedules, processScheduleKeys,
  updateProcessSchedule, type ProcessHealth, type ProcessSchedule, type ProcessSchedulePatch,
} from "@/lib/api/process-discovery";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { TENANT_TIMEZONE_HREF, useTenantTimezone } from "@/lib/tenant-zone";
import Link from "next/link";

export function ProcessSchedules({ systemId, canManage, title = "Schedules" }: { systemId: string; canManage: boolean; title?: string }) {
  const qc = useQueryClient();
  const tz = useTenantTimezone();
  const schedulesQ = useQuery({ queryKey: processScheduleKeys.schedules(systemId), queryFn: () => listProcessSchedules(systemId) });
  const healthQ = useQuery({ queryKey: processScheduleKeys.health(systemId), queryFn: () => getProcessHealth(systemId), retry: false, meta: { ignoreError: true } });
  const catalogueQ = useQuery({ queryKey: queryKeys.processCatalogue(systemId), queryFn: () => getCatalogue(systemId), retry: false, meta: { ignoreError: true } });
  const [adding, setAdding] = useState("");
  const [cron, setCron] = useState(PRESETS[1].value);
  const [removing, setRemoving] = useState<ProcessSchedule | null>(null);

  const names = new Map((catalogueQ.data ?? []).map((r) => [r.l1, r.name]));
  const nameOf = (l1: string) => names.get(l1) ?? l1.toUpperCase();
  const schedules = schedulesQ.data ?? [];
  const bySchedule = new Map(schedules.map((s) => [s.l1, s]));
  const health = new Map<string, ProcessHealth>((healthQ.data ?? []).map((h) => [h.l1, h]));
  // The L1s the system can mine, then any L1 that already has a schedule.
  const l1s = [...new Set([...(healthQ.data ?? []).map((h) => h.l1), ...schedules.map((s) => s.l1)])];
  const addable = l1s.filter((l1) => !bySchedule.has(l1) && !catalogueQ.data?.find((r) => r.l1 === l1)?.reason);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: processScheduleKeys.schedules(systemId) });
    void qc.invalidateQueries({ queryKey: processScheduleKeys.health(systemId) });
  };
  const onError = (e: unknown) => toast.error(apiErrorMessage(e));
  const saved = (verb: string) => (s: ProcessSchedule) => {
    toast.success(s.active && s.next_run_at ? `${verb}. Next run ${formatDate(s.next_run_at, "datetime", tz)}` : verb);
    refresh();
  };

  const update = useMutation({
    mutationFn: ({ s, body }: { s: ProcessSchedule; body: ProcessSchedulePatch }) => updateProcessSchedule(systemId, s.id, body),
    onSuccess: saved("Schedule saved"), onError,
  });
  const create = useMutation({
    mutationFn: () => createProcessSchedule(systemId, { l1: adding, schedule_cron: cron, active: true }),
    onSuccess: (s) => { saved("Schedule added")(s); setAdding(""); }, onError,
  });
  const remove = useMutation({
    mutationFn: (s: ProcessSchedule) => deleteProcessSchedule(systemId, s.id),
    onSuccess: () => { toast.success("Schedule deleted"); setRemoving(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e) || "Could not delete the schedule"),
  });

  const rows = l1s.map((l1) => ({ l1, s: bySchedule.get(l1), h: health.get(l1) }));

  return (
    <Card title={title} meta="Mine a process again on a timetable, so its flow and fitness stay current" dataTour="process-schedules">
      <div className="flex flex-col gap-3">
        <p className="m-text-body m-ink-2">
          Each schedule reads the process again and compares it with the run before. Times are shown in the tenant time zone,{" "}
          <Link href={TENANT_TIMEZONE_HREF} className="m-ink-accent underline underline-offset-2">{tz.replace(/_/g, " ")}</Link>.
        </p>
        {schedulesQ.isLoading ? <Skeleton height={120} /> : schedulesQ.isError ? (
          <ErrorState {...apiErrorState(schedulesQ.error)} onRetry={() => void schedulesQ.refetch()} />
        ) : rows.length ? (
          <table className="m-table">
            <thead><tr><th>Process</th><th>Schedule</th><th>Last run</th><th>Next run</th><th>Freshness</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map(({ l1, s, h }) => (
                <tr key={l1}>
                  <td>{nameOf(l1)}</td>
                  <td>
                    {s && canManage
                      ? <CronPicker value={s.schedule_cron} disabled={update.isPending}
                          onChange={(c) => update.mutate({ s, body: { schedule_cron: c } })} />
                      : <span>{presetLabel(s?.schedule_cron ?? null)}</span>}
                  </td>
                  <td>{h?.last_run?.finished_at ? <span title={formatDate(h.last_run.finished_at, "datetime", tz)}>{relativeTime(h.last_run.finished_at)}</span> : "Never"}</td>
                  <td>{s?.active && s.next_run_at ? formatDate(s.next_run_at, "datetime", tz) : "—"}</td>
                  <td>{h ? <FreshnessPill value={h.freshness} /> : "—"}</td>
                  <td>{s ? <Status kind="lifecycle" value={s.active ? "active" : "paused"} /> : "—"}</td>
                  <td>
                    {s && canManage && (
                      <div className="flex gap-1">
                        <Button variant="ghost" disabled={update.isPending} aria-label={`${s.active ? "Pause" : "Resume"} the ${nameOf(l1)} schedule`}
                          onClick={() => update.mutate({ s, body: { active: !s.active } })}>
                          {s.active ? "Pause" : "Resume"}
                        </Button>
                        <Button variant="ghost" disabled={remove.isPending} aria-label={`Delete the ${nameOf(l1)} schedule`}
                          onClick={() => setRemoving(s)}>Delete</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="m-text-body m-ink-2">
            No schedules yet. Processes are only mined again when someone starts a run{canManage ? ". Pick a process below to schedule it" : ""}.
          </p>
        )}
        {canManage && addable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="[width:220px]">
              <Select label="Schedule a process" placeholder="Schedule a process…" value={adding}
                options={addable.map((l1) => ({ value: l1, label: nameOf(l1) }))} onValueChange={setAdding} />
            </div>
            <CronPicker value={cron} onChange={setCron} />
            <Button disabled={!adding || create.isPending || !!cronError(cron)} onClick={() => create.mutate()}>Add schedule</Button>
          </div>
        )}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(o) => { if (!o) setRemoving(null); }}
          title={`Delete the ${removing ? nameOf(removing.l1) : ""} schedule`}
          tone="danger"
          body={`${removing ? nameOf(removing.l1) : "This process"} is no longer mined on a schedule (${presetLabel(removing?.schedule_cron ?? null).toLowerCase()}). Runs already made stay.`}
          confirmLabel="Delete schedule"
          cancelLabel="Keep"
          pending={remove.isPending}
          onConfirm={() => { if (removing) remove.mutate(removing); }}
        />
      </div>
    </Card>
  );
}

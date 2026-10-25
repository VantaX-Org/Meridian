"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, ErrorState, Input, Pill, Select, Skeleton } from "@/design";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { getSystemObjects } from "@/lib/api/system-objects";
import { createSyncProfile, getSyncProfiles, updateSyncProfile } from "@/lib/api/systems";
import type { SyncProfile } from "@/types/api";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { clsx } from "clsx";

const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-1.5 border-t";

const CUSTOM = "custom";
const PRESETS = [
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 2 * * 1", label: "Weekly, Monday 02:00" },
  { value: "0 2 1 * *", label: "Monthly, 1st at 02:00" },
  { value: "0 * * * *", label: "Hourly" },
  { value: CUSTOM, label: "Custom cron…" },
];
export const presetLabel = (cron: string | null) =>
  !cron ? "Manual only" : PRESETS.find((p) => p.value === cron)?.label ?? cron;

const MODES = [
  { value: "full", label: "Full download" },
  { value: "delta", label: "Changes only" },
];
const modeLabel = (m: string | undefined) => MODES.find((x) => x.value === m)?.label ?? "Full download";

function CronPicker({ value, onChange, disabled }: { value: string; onChange: (cron: string) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(!PRESETS.some((p) => p.value === value));
  const [text, setText] = useState(value);
  return (
    <div className="flex gap-2">
      <div className="[width:200px]">
        <Select
          label="Schedule"
          options={PRESETS} value={custom ? CUSTOM : value}
          onValueChange={(v) => { setCustom(v === CUSTOM); if (v !== CUSTOM) onChange(v); }} />
      </div>
      {custom && (
        <Input aria-label="Cron expression" placeholder="min hour day month weekday" disabled={disabled}
          className="font-mono"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onChange(text.trim()); }}
          onBlur={() => { if (text.trim() && text.trim() !== value) onChange(text.trim()); }} />
      )}
    </div>
  );
}

export function SchedulesPanel({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient();
  const profilesQ = useQuery({ queryKey: queryKeys.syncProfiles(id), queryFn: () => getSyncProfiles(id) });
  const profiles = profilesQ.data ?? [];
  const { data: catalogue } = useQuery({ queryKey: queryKeys.systemObjects(id), queryFn: () => getSystemObjects(id), enabled: canManage });
  const [adding, setAdding] = useState("");
  const [cron, setCron] = useState(PRESETS[1].value);
  const [mode, setMode] = useState<"full" | "delta">("full");
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.syncProfiles(id) });
  const onError = (e: unknown) => toast.error(apiErrorMessage(e));

  const update = useMutation({
    mutationFn: ({ p, body }: { p: SyncProfile; body: { schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" } }) => updateSyncProfile(id, p.id, body),
    onSuccess: () => { toast.success("Schedule saved"); refresh(); },
    onError,
  });
  const create = useMutation({
    mutationFn: () => {
      const o = catalogue?.objects.find((x) => x.object === adding);
      return createSyncProfile(id, { system_id: id, domain: adding, tables: o?.tables ?? [], schedule_cron: cron, active: true, extraction_mode: mode });
    },
    onSuccess: () => { toast.success("Schedule added"); setAdding(""); refresh(); },
    onError,
  });
  const scheduled = new Set(profiles.map((p) => p.domain));
  const addable = (catalogue?.objects ?? []).filter((o) => !scheduled.has(o.object));

  return (
    <Card title="Scheduled extracts" meta="Pull an object again on a timetable, so its score stays current without anyone pressing Extract" dataTour="schedules">
      <div className="flex flex-col gap-3">
        <p className="m-text-body m-ink-2">
          Each schedule downloads the object again and re-runs its checks, so trends and alerts see every run.
          Times are server time; due runs start within 5 minutes.
          &ldquo;Changes only&rdquo; reads just the records SAP changed since the last download, with a full download at least once a week.
        </p>
        {profilesQ.isLoading ? <Skeleton height={120} /> : profilesQ.isError ? (
          <ErrorState {...apiErrorState(profilesQ.error)} onRetry={() => void profilesQ.refetch()} />
        ) : profiles.length ? (
          <table className="w-full m-text-body">
            <thead><tr>
              <th className={clsx(th, "m-ink-3")}>Object</th><th className={clsx(th, "m-ink-3")}>Schedule</th>
              <th className={clsx(th, "m-ink-3")}>Download</th>
              <th className={clsx(th, "m-ink-3")}>Last run</th><th className={clsx(th, "m-ink-3")}>Next run</th>
              <th className={clsx(th, "m-ink-3")}>Status</th><th className={clsx(th, "m-ink-3")} />
            </tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>{formatModuleName(p.domain)}</td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>
                    {canManage
                      ? <CronPicker value={p.schedule_cron ?? ""} disabled={update.isPending}
                          onChange={(c) => update.mutate({ p, body: { schedule_cron: c } })} />
                      : <span className="font-mono">{presetLabel(p.schedule_cron)}</span>}
                  </td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>
                    {canManage
                      ? <Select
                          label="Extraction mode"
                          value={p.extraction_mode ?? "full"} options={MODES}
                          onValueChange={(v) => update.mutate({ p, body: { extraction_mode: v === "delta" ? "delta" : "full" } })} />
                      : <span>{modeLabel(p.extraction_mode)}</span>}
                  </td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>{p.last_run_at ? relativeTime(p.last_run_at) : "Never"}</td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : "—"}</td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}><Pill tone={p.active ? "go" : "neutral"}>{p.active ? "Active" : "Paused"}</Pill></td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>
                    {canManage && (
                      <Button variant="ghost" disabled={update.isPending}
                        onClick={() => update.mutate({ p, body: { active: !p.active } })}>
                        {p.active ? "Pause" : "Resume"}
                      </Button>
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
            <Button disabled={!adding || create.isPending} onClick={() => create.mutate()}>Add schedule</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

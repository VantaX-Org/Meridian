"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Pill, Select } from "@/design";
import { getSystemObjects } from "@/lib/api/system-objects";
import { createSyncProfile, getSyncProfiles, updateSyncProfile } from "@/lib/api/systems";
import type { SyncProfile } from "@/types/api";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const th = "px-3 py-2 text-left font-medium";
const thStyle = { color: "var(--m-ink-3)" };
const td = "px-3 py-1.5 border-t";
const tdStyle = { borderColor: "var(--m-line)" };

const CUSTOM = "custom";
const PRESETS = [
  { value: "0 2 * * *", label: "Daily at 02:00" },
  { value: "0 2 * * 1", label: "Weekly, Monday 02:00" },
  { value: "0 2 1 * *", label: "Monthly, 1st at 02:00" },
  { value: "0 * * * *", label: "Hourly" },
  { value: CUSTOM, label: "Custom cron…" },
];
const presetLabel = (cron: string | null) =>
  !cron ? "Manual only" : PRESETS.find((p) => p.value === cron)?.label ?? cron;

function CronPicker({ value, onChange, disabled }: { value: string; onChange: (cron: string) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(!PRESETS.some((p) => p.value === value));
  const [text, setText] = useState(value);
  return (
    <div className="flex gap-2">
      <div style={{ width: 200 }}>
        <Select options={PRESETS} value={custom ? CUSTOM : value}
          onValueChange={(v) => { setCustom(v === CUSTOM); if (v !== CUSTOM) onChange(v); }} />
      </div>
      {custom && (
        <input aria-label="Cron expression" placeholder="min hour day month weekday" disabled={disabled}
          className="rounded border px-3 py-1.5 text-[13px] font-mono" style={{ borderColor: "var(--m-line)" }}
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onChange(text.trim()); }}
          onBlur={() => { if (text.trim() && text.trim() !== value) onChange(text.trim()); }} />
      )}
    </div>
  );
}

export function SchedulesPanel({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: profiles = [] } = useQuery({ queryKey: queryKeys.syncProfiles(id), queryFn: () => getSyncProfiles(id) });
  const { data: catalogue } = useQuery({ queryKey: queryKeys.systemObjects(id), queryFn: () => getSystemObjects(id), enabled: canManage });
  const [adding, setAdding] = useState("");
  const [cron, setCron] = useState(PRESETS[1].value);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.syncProfiles(id) });
  const onError = (e: unknown) => toast.error((e as Error).message || "Could not save the schedule");

  const update = useMutation({
    mutationFn: ({ p, body }: { p: SyncProfile; body: { schedule_cron?: string; active?: boolean } }) => updateSyncProfile(id, p.id, body),
    onSuccess: () => { toast.success("Schedule saved"); refresh(); },
    onError,
  });
  const create = useMutation({
    mutationFn: () => {
      const o = catalogue?.objects.find((x) => x.object === adding);
      return createSyncProfile(id, { system_id: id, domain: adding, tables: o?.tables ?? [], schedule_cron: cron, active: true });
    },
    onSuccess: () => { toast.success("Schedule added"); setAdding(""); refresh(); },
    onError,
  });
  const scheduled = new Set(profiles.map((p) => p.domain));
  const addable = (catalogue?.objects ?? []).filter((o) => !scheduled.has(o.object));

  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Scheduled re-evaluation</p>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          Each schedule re-downloads the object and re-runs its checks, so the trends and alert thresholds pick up every run.
          Times are server time; the scheduler looks for due runs every 5 minutes.
        </p>
        {profiles.length ? (
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={th} style={thStyle}>Object</th><th className={th} style={thStyle}>Schedule</th>
              <th className={th} style={thStyle}>Last run</th><th className={th} style={thStyle}>Next run</th>
              <th className={th} style={thStyle}>Status</th><th className={th} style={thStyle} />
            </tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td className={td} style={tdStyle}>{formatModuleName(p.domain)}</td>
                  <td className={td} style={tdStyle}>
                    {canManage
                      ? <CronPicker value={p.schedule_cron ?? ""} disabled={update.isPending}
                          onChange={(c) => update.mutate({ p, body: { schedule_cron: c } })} />
                      : <span className="font-mono">{presetLabel(p.schedule_cron)}</span>}
                  </td>
                  <td className={td} style={tdStyle}>{p.last_run_at ? relativeTime(p.last_run_at) : "never"}</td>
                  <td className={td} style={tdStyle}>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : "—"}</td>
                  <td className={td} style={tdStyle}><Pill tone={p.active ? "go" : "neutral"}>{p.active ? "active" : "paused"}</Pill></td>
                  <td className={td} style={tdStyle}>
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
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
            No schedules yet — objects are only re-evaluated when someone downloads them.
          </p>
        )}
        {canManage && addable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div style={{ width: 220 }}>
              <Select placeholder="Schedule an object…" value={adding}
                options={addable.map((o) => ({ value: o.object, label: formatModuleName(o.object) }))} onValueChange={setAdding} />
            </div>
            <CronPicker value={cron} onChange={setCron} />
            <Button disabled={!adding || create.isPending} onClick={() => create.mutate()}>Add schedule</Button>
          </div>
        )}
      </div>
    </div>
  );
}

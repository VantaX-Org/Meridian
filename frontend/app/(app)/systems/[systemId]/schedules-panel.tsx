"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Chip, Input, Panel, Select, Stack, Text } from "@/components/aurora";
import { getSystemObjects } from "@/lib/api/system-objects";
import { createSyncProfile, getSyncProfiles, updateSyncProfile } from "@/lib/api/systems";
import type { SyncProfile } from "@/types/api";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)]";

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
    <Stack direction="row" gap={2}>
      <div style={{ width: 200 }}>
        <Select aria-label="Schedule" disabled={disabled} options={PRESETS} value={custom ? CUSTOM : value}
          onValueChange={(v) => { setCustom(v === CUSTOM); if (v !== CUSTOM) onChange(v); }} />
      </div>
      {custom && (
        <Input aria-label="Cron expression" placeholder="min hour day month weekday" className="font-mono" disabled={disabled}
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onChange(text.trim()); }}
          onBlur={() => { if (text.trim() && text.trim() !== value) onChange(text.trim()); }} />
      )}
    </Stack>
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
    <Panel title="Scheduled re-evaluation">
      <Stack gap={3}>
        <Text variant="text-small" tone="secondary">
          Each schedule re-downloads the object and re-runs its checks, so the trends and alert thresholds pick up every run.
          Times are server time; the scheduler looks for due runs every 5 minutes.
        </Text>
        {profiles.length ? (
          <table className="w-full text-[13px]">
            <thead><tr>
              <th className={th}>Object</th><th className={th}>Schedule</th><th className={th}>Last run</th>
              <th className={th}>Next run</th><th className={th}>Status</th><th className={th} />
            </tr></thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{formatModuleName(p.domain)}</td>
                  <td className={td}>
                    {canManage
                      ? <CronPicker value={p.schedule_cron ?? ""} disabled={update.isPending}
                          onChange={(c) => update.mutate({ p, body: { schedule_cron: c } })} />
                      : <span className="font-mono">{presetLabel(p.schedule_cron)}</span>}
                  </td>
                  <td className={td}>{p.last_run_at ? relativeTime(p.last_run_at) : "never"}</td>
                  <td className={td}>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : "—"}</td>
                  <td className={td}><Chip tone={p.active ? "success" : "neutral"}>{p.active ? "active" : "paused"}</Chip></td>
                  <td className={td}>
                    {canManage && (
                      <Button variant="ghost" size="sm" disabled={update.isPending}
                        onClick={() => update.mutate({ p, body: { active: !p.active } })}>
                        {p.active ? "Pause" : "Resume"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Text tone="muted">No schedules yet — objects are only re-evaluated when someone downloads them.</Text>}
        {canManage && addable.length > 0 && (
          <Stack direction="row" gap={2} align="center" wrap>
            <div style={{ width: 220 }}>
              <Select aria-label="Object to schedule" placeholder="Schedule an object…" value={adding}
                options={addable.map((o) => ({ value: o.object, label: formatModuleName(o.object) }))} onValueChange={setAdding} />
            </div>
            <CronPicker value={cron} onChange={setCron} />
            <Button size="sm" disabled={!adding || create.isPending} onClick={() => create.mutate()}>Add schedule</Button>
          </Stack>
        )}
      </Stack>
    </Panel>
  );
}

// ── object × version heatmap ─────────────────────────────────────────────────

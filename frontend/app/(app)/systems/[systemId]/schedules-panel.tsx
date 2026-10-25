"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, ConfirmDialog, EmptyState, Input, Select, Status, toast } from "@/design";
import { usePreferences } from "@/hooks/use-preferences";
import { getSystemObjects } from "@/lib/api/system-objects";
import { createSyncProfile, deleteSyncProfile, getSyncProfiles, updateSyncProfile } from "@/lib/api/systems";
import { apiErrorMessage } from "@/lib/error";
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
  { value: "full", label: "Full extraction" },
  { value: "delta", label: "Changes only" },
];
const modeLabel = (m: string | undefined) => MODES.find((x) => x.value === m)?.label ?? "Full extraction";

/** Five cron fields, each a number, range, list, step or star within its bounds; nothing fancier is accepted. */
const FIELD = (min: number, max: number) => {
  const n = `(?:${min === 0 ? "[0-9]|[1-5][0-9]" : "[0-9]|[1-9][0-9]"})`;
  const item = `(?:\\*|${n}(?:-${n})?)(?:/[1-9][0-9]?)?`;
  return { re: new RegExp(`^${item}(?:,${item})*$`), min, max };
};
const FIELDS = [FIELD(0, 59), FIELD(0, 23), FIELD(1, 31), FIELD(1, 12), FIELD(0, 7)];
/** The reason a cron expression is rejected, or undefined when it is valid. */
export function cronError(cron: string): string | undefined {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return "Enter five fields: minute, hour, day, month, weekday";
  const bad = parts.findIndex((p, i) => {
    const f = FIELDS[i]!;
    if (!f.re.test(p)) return true;
    return p.split(/[,\-/]/).some((x) => /^\d+$/.test(x) && (Number(x) < f.min || Number(x) > f.max));
  });
  if (bad >= 0) return `${["Minute", "Hour", "Day", "Month", "Weekday"][bad]} is out of range`;
  return undefined;
}

function CronPicker({ value, onChange, disabled }: { value: string; onChange: (cron: string) => void; disabled?: boolean }) {
  const [custom, setCustom] = useState(!PRESETS.some((p) => p.value === value));
  const [text, setText] = useState(value);
  const error = custom && text.trim() ? cronError(text) : undefined;
  const commit = () => { const t = text.trim(); if (t && !cronError(t) && t !== value) onChange(t); };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <div className="[width:200px]">
          <Select
            label="Schedule"
            options={PRESETS} value={custom ? CUSTOM : value}
            onValueChange={(v) => { setCustom(v === CUSTOM); if (v !== CUSTOM) onChange(v); }} />
        </div>
        {custom && (
          <Input aria-label="Cron expression" placeholder="min hour day month weekday" disabled={disabled}
            className="font-mono" aria-invalid={!!error}
            value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
            onBlur={commit} />
        )}
      </div>
      {error ? <p className="m-field-error">{error}</p> : null}
    </div>
  );
}

export function SchedulesPanel({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient();
  const { prefs } = usePreferences();
  const tz = prefs.timezone || "UTC";
  const { data: profiles = [] } = useQuery({ queryKey: queryKeys.syncProfiles(id), queryFn: () => getSyncProfiles(id) });
  const { data: catalogue } = useQuery({ queryKey: queryKeys.systemObjects(id), queryFn: () => getSystemObjects(id), enabled: canManage });
  const [adding, setAdding] = useState("");
  const [cron, setCron] = useState(PRESETS[1].value);
  const [mode, setMode] = useState<"full" | "delta">("full");
  const [removing, setRemoving] = useState<SyncProfile | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.syncProfiles(id) });
  const onError = (e: unknown) => toast.error(apiErrorMessage(e) || "Could not save the schedule");

  const update = useMutation({
    mutationFn: ({ p, body }: { p: SyncProfile; body: { schedule_cron?: string; active?: boolean; extraction_mode?: "full" | "delta" } }) => updateSyncProfile(id, p.id, body),
    onSuccess: (saved) => { toast.success(saved.next_run_at ? `Schedule saved. Next run ${formatDate(saved.next_run_at, "datetime")} ${tz}` : "Schedule saved"); refresh(); },
    onError,
  });
  const create = useMutation({
    mutationFn: () => {
      const o = catalogue?.objects.find((x) => x.object === adding);
      return createSyncProfile(id, { system_id: id, domain: adding, tables: o?.tables ?? [], schedule_cron: cron, active: true, extraction_mode: mode });
    },
    onSuccess: (saved) => { toast.success(saved.next_run_at ? `Schedule added. Next run ${formatDate(saved.next_run_at, "datetime")} ${tz}` : "Schedule added"); setAdding(""); refresh(); },
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
    <Card title="Extraction schedule" dataTour="schedules">
      <div className="flex flex-col gap-3">
        <p className="m-text-body m-ink-2">
          Each schedule extracts the object again and re-runs its checks, so the trends and alert thresholds pick up every run.
          Times are shown in {tz}; the scheduler looks for due runs every 5 minutes.
          &ldquo;Changes only&rdquo; re-reads just the records SAP&rsquo;s change log shows changed since the last extraction, and does a full extraction at least weekly.
        </p>
        {profiles.length ? (
          <table className="w-full m-text-body">
            <thead><tr>
              <th className={clsx(th, "m-ink-3")}>Object</th><th className={clsx(th, "m-ink-3")}>Schedule</th>
              <th className={clsx(th, "m-ink-3")}>Mode</th>
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
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>{p.active && p.next_run_at ? `${formatDate(p.next_run_at, "datetime")} ${tz}` : "—"}</td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}><Status kind="lifecycle" value={p.active ? "active" : "paused"} /></td>
                  <td className={clsx(td, "[border-color:var(--m-line)]")}>
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
          <EmptyState
            title="No schedules yet"
            detail="Objects are only extracted again when someone starts an extraction."
            ghost="list"
          />
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

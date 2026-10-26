"use client";

/** Reports › Schedules: a report generated on a cadence, kept in the history and sent to users and alert channels. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, Card, Checkbox, ChoiceGroup, ConfirmDialog, DataTable, Drawer, Field, Input, Pill, RowActionButton, Select,
  Skeleton, Switch, actionColumn, toast, type PillTone,
} from "@/design";
import {
  createReportSchedule, deleteReportSchedule, getReportScheduleOptions, getReportSchedules, runReportScheduleNow,
  updateReportSchedule, type ReportSchedule, type ReportScheduleInput, type ScheduleCadence, type ScheduleOptions,
  type ScheduleRunStatus,
} from "@/lib/api/reports";
import { formatDate, formatModuleName, plural } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const CADENCES: { value: ScheduleCadence; label: string }[] = [
  { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" },
];
const LAST: Record<ScheduleRunStatus, { label: string; tone: PillTone }> = {
  sent: { label: "Sent", tone: "go" }, partial: { label: "Partly sent", tone: "at-risk" },
  failed: { label: "Failed", tone: "no-go" }, skipped: { label: "Skipped", tone: "neutral" },
  running: { label: "Running", tone: "info" },
};

interface Draft {
  name: string;
  kind: string;
  scope: string;
  module: string;
  cadence: ScheduleCadence;
  time: string;
  weekday: string;
  day: string;
  timezone: string;
  users: string[];
  channels: string[];
  enabled: boolean;
}

function draftOf(s: ReportSchedule | null, opts: ScheduleOptions | undefined): Draft {
  if (s) {
    return {
      name: s.name, kind: s.kind, scope: s.params.scope || "latest", module: s.params.module ?? "", cadence: s.cadence,
      time: s.time_of_day, weekday: String(s.weekday ?? 0), day: String(s.day_of_month ?? 1), timezone: s.timezone,
      users: s.recipient_user_ids, channels: s.recipient_channel_ids, enabled: s.enabled,
    };
  }
  return {
    name: "", kind: opts?.types[0]?.id ?? "board", scope: "latest", module: "", cadence: "weekly", time: "07:00",
    weekday: "0", day: "1", timezone: opts?.timezone ?? "UTC", users: [], channels: [], enabled: true,
  };
}

/** The request body for a draft: weekday only for weekly, the day only for monthly, a module only when the report needs one. */
export function scheduleInput(d: Draft, needsModule: boolean): ReportScheduleInput {
  return {
    name: d.name.trim(), kind: d.kind, params: { scope: d.scope, ...(needsModule && d.module ? { module: d.module } : {}) },
    cadence: d.cadence, time_of_day: d.time, weekday: d.cadence === "weekly" ? Number(d.weekday) : null,
    day_of_month: d.cadence === "monthly" ? Number(d.day) : null, timezone: d.timezone.trim() || null,
    recipient_user_ids: d.users, recipient_channel_ids: d.channels, enabled: d.enabled,
  };
}

function Recipients({ legend, options, value, onChange }: {
  legend: string; options: { id: string; label: string; detail?: string | null }[]; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="m-field-label">{legend}</legend>
      {options.length === 0 ? <p className="m-text-meta m-ink-3">None set up</p> : options.map((o) => (
        <label key={o.id} className="flex items-center gap-2 m-text-body">
          <Checkbox
            aria-label={o.label}
            checked={value.includes(o.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
          />
          <span>{o.label}</span>
          {o.detail ? <span className="m-text-meta m-ink-3">{o.detail}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

function ScheduleDrawer({ open, onOpenChange, editing, options, nameOf }: {
  open: boolean; onOpenChange: (o: boolean) => void; editing: ReportSchedule | null; options: ScheduleOptions | undefined;
  nameOf: (kind: string) => string;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftOf(editing, options));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const type = options?.types.find((t) => t.id === d.kind);
  const needsModule = !!type?.needs_module;
  const errors = {
    name: d.name.trim() ? undefined : "Name the schedule",
    module: needsModule && !d.module ? "Choose an object" : undefined,
    time: /^\d{2}:\d{2}$/.test(d.time) ? undefined : "Enter a time",
  };
  const valid = !errors.name && !errors.module && !errors.time;
  const save = useMutation({
    mutationFn: () => (editing ? updateReportSchedule(editing.id, scheduleInput(d, needsModule)) : createReportSchedule(scheduleInput(d, needsModule))),
    onSuccess: () => {
      toast.success(editing ? "Schedule saved" : "Schedule created");
      void qc.invalidateQueries({ queryKey: queryKeys.reportSchedules() });
      onOpenChange(false);
    },
    onError: (e) => toast.error(`Not saved. ${apiErrorMessage(e)}`),
  });
  const scopes = [{ value: "latest", label: "Latest finished run" }, { value: "upload", label: "Latest file upload" },
    ...(options?.systems ?? []).map((s) => ({ value: s.id, label: `Latest run of ${s.label}` }))];
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit schedule" : "New schedule"}
      subtitle={type ? `${nameOf(type.id)}, ${type.format.toUpperCase()}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close without saving</Button>
          <Button pending={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{editing ? "Save schedule" : "Create schedule"}</Button>
        </>
      }
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
        <Field label="Name" error={d.name ? errors.name : undefined}>
          <Input value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="For example Monday board pack" />
        </Field>
        <Field label="Report">
          <Select value={d.kind} onValueChange={(v) => set("kind", v)} options={(options?.types ?? []).map((t) => ({ value: t.id, label: nameOf(t.id) }))} />
        </Field>
        {type?.needs_run !== false ? (
          <Field label="Run">
            <Select value={d.scope} onValueChange={(v) => set("scope", v)} options={scopes} />
          </Field>
        ) : null}
        {needsModule ? (
          <Field label="Object" error={errors.module}>
            <Select value={d.module} onValueChange={(v) => set("module", v)} placeholder="Choose an object"
              options={(options?.modules ?? []).map((m) => ({ value: m, label: formatModuleName(m) }))} />
          </Field>
        ) : null}
        <p className="m-text-meta m-ink-3">{`Format: ${type ? type.format.toUpperCase() : "PDF"}. Each report has one format.`}</p>
        <ChoiceGroup label="Cadence" showLabel options={CADENCES} value={d.cadence} onChange={(v) => set("cadence", v)} />
        {d.cadence === "weekly" ? (
          <Field label="Day of the week">
            <Select value={d.weekday} onValueChange={(v) => set("weekday", v)} options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))} />
          </Field>
        ) : null}
        {d.cadence === "monthly" ? (
          <Field label="Day of the month">
            <Select value={d.day} onValueChange={(v) => set("day", v)}
              options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i + 1 > 28 ? `${i + 1} (or the month's last day)` : String(i + 1) }))} />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time" error={errors.time}>
            <Input type="time" value={d.time} onChange={(e) => set("time", e.target.value)} />
          </Field>
          <Field label="Time zone">
            <Input value={d.timezone} onChange={(e) => set("timezone", e.target.value)} placeholder="Africa/Johannesburg" />
          </Field>
        </div>
        <Recipients legend="Send to people" options={options?.users ?? []} value={d.users} onChange={(v) => set("users", v)} />
        <Recipients legend="Send to alert channels" options={options?.channels ?? []} value={d.channels} onChange={(v) => set("channels", v)} />
        <p className="m-text-meta m-ink-3">People get it in their inbox and by email. Email channels get the file attached; Slack, Teams and webhooks get a link</p>
        <Switch checked={d.enabled} onCheckedChange={(v) => set("enabled", v)} label="Schedule is on" />
      </form>
    </Drawer>
  );
}

export function ReportSchedules({ nameOf }: { nameOf: (kind: string) => string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [removing, setRemoving] = useState<ReportSchedule | null>(null);
  const q = useQuery({ queryKey: queryKeys.reportSchedules(), queryFn: getReportSchedules });
  const opts = useQuery({ queryKey: queryKeys.reportScheduleOptions(), queryFn: getReportScheduleOptions });
  const recipients = useMemo(() => new Map([...(opts.data?.users ?? []), ...(opts.data?.channels ?? [])].map((o) => [o.id, o.label])), [opts.data]);
  const run = useMutation({
    mutationFn: runReportScheduleNow,
    onSuccess: () => toast.success("Running now. The report shows in the history when it is ready"),
    onError: (e) => toast.error(`Not started. ${apiErrorMessage(e)}`),
  });
  const del = useMutation({
    mutationFn: deleteReportSchedule,
    onSuccess: () => { toast.success("Schedule deleted"); void qc.invalidateQueries({ queryKey: queryKeys.reportSchedules() }); },
    onError: (e) => toast.error(`Not deleted. ${apiErrorMessage(e)}`),
  });
  const open = (s: ReportSchedule | null) => { setEditing(s); setDrawer(true); };

  const columns: ColumnDef<ReportSchedule>[] = [
    { id: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "report", header: "Report", cell: ({ row }) => nameOf(row.original.kind) },
    { id: "when", header: "When", cell: ({ row }) => row.original.summary },
    {
      id: "to", header: "Sends to",
      cell: ({ row }) => {
        const ids = [...row.original.recipient_user_ids, ...row.original.recipient_channel_ids];
        if (!ids.length) return <span className="m-ink-3">History only</span>;
        const names = ids.map((id) => recipients.get(id)).filter((x): x is string => !!x);
        return names.length && names.length <= 2 ? names.join(", ") : plural(ids.length, "recipient");
      },
    },
    { id: "next", header: "Next run", cell: ({ row }) => (row.original.enabled && row.original.next_run_at ? formatDate(row.original.next_run_at, "datetime") : <span className="m-ink-3">Off</span>) },
    {
      id: "last", header: "Last run",
      cell: ({ row }) => {
        const s = row.original;
        if (!s.last_run_at || !s.last_status) return <span className="m-ink-3">Not yet</span>;
        const l = LAST[s.last_status];
        return <span className="flex items-center gap-2"><Pill tone={l.tone}>{l.label}</Pill><span className="m-text-meta m-ink-3">{formatDate(s.last_run_at, "datetime")}</span></span>;
      },
    },
    actionColumn<ReportSchedule>((s) => (s.can_edit ? (
      <span className="flex items-center gap-3">
        <RowActionButton label={`Edit ${s.name}`} onClick={() => open(s)}>Edit</RowActionButton>
        <RowActionButton label={`Run ${s.name} now`} disabled={run.isPending} onClick={() => run.mutate(s.id)}>Run now</RowActionButton>
        <RowActionButton label={`Delete ${s.name}`} onClick={() => setRemoving(s)}>Delete</RowActionButton>
      </span>
    ) : <span className="m-ink-3">View only</span>), "Actions"),
  ];

  return (
    <Card
      title="Schedules"
      meta="Reports generated on a cadence, kept in the history and sent to people and alert channels"
      actions={<Button onClick={() => open(null)} disabled={!opts.data}>New schedule</Button>}
    >
      {q.isError ? (
        <div className="flex items-center gap-3 m-text-body" role="alert">
          <span>{`Schedules did not load. ${apiErrorMessage(q.error)}`}</span>
          <Button variant="secondary" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : q.isLoading ? (
        <Skeleton height={80} />
      ) : (
        <DataTable
          tableId="report-schedules"
          columns={columns}
          data={q.data ?? []}
          getRowId={(r) => r.id}
          hideSearch
          emptyMessage="No schedule yet. Create one to send a report every day, week or month"
        />
      )}
      {drawer ? (
        <ScheduleDrawer key={editing?.id ?? "new"} open={drawer} onOpenChange={setDrawer} editing={editing} options={opts.data} nameOf={nameOf} />
      ) : null}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title={`Delete ${removing?.name ?? "this schedule"}`}
        tone="danger"
        body="The report stops being sent. Reports it already made stay in the history."
        confirmLabel="Delete schedule"
        cancelLabel="Keep schedule"
        pending={del.isPending}
        onConfirm={() => removing && del.mutate(removing.id, { onSettled: () => setRemoving(null) })}
      />
    </Card>
  );
}

"use client";

import { useState } from "react";
import type { ReportFile, ReportSchedule } from "@/lib/api/reports";
import * as rep from "@/lib/api/v2/reports";
import { apiErrorMessage } from "@/lib/error";
import { failureText } from "@/lib/v2/errors";
import { formatDate, labelOf } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { useReportHistory, useScheduleOptions, useSchedules } from "@/lib/v2/admin-queries";
import { type GridColumn } from "../Grid";
import { Dash, EmptyFrame, ErrorFrame, PageTitle } from "../parts";
import { StatusWord, useCan } from "../admin/kit";
import { SCHEDULE_TONE, SCHEDULE_WORD, sizeText } from "../inspector/reports";
import { ToolGrid } from "../GridTools";

const SOURCE: Record<ReportFile["source"], string> = { download: "Downloaded", schedule: "Scheduled", run_now: "On request" };

function reportColumns(download: (f: ReportFile) => void, busy: string | null): GridColumn<ReportFile>[] {
  return [
    { id: "name", header: "Report", width: 200, pin: true, locked: true, cell: (f) => f.name },
    { id: "kind", header: "Kind", width: 100, defaultHidden: true, cell: (f) => labelOf(f.kind) },
    { id: "run", header: "Run", width: 160, cell: (f) => f.run_label ?? (f.run_at ? formatDate(f.run_at) : <Dash why="Not tied to one run" />) },
    { id: "format", header: "Format", width: 70, cell: (f) => f.format.toUpperCase() },
    { id: "created", header: "Created", width: 150, cell: (f) => formatDate(f.created_at, "datetime") },
    { id: "by", header: "By", width: 160, cell: (f) => f.created_by_label ?? (f.source === "schedule" ? "Schedule" : <Dash />) },
    { id: "source", header: "How", width: 110, defaultHidden: true, cell: (f) => SOURCE[f.source] },
    { id: "size", header: "Size", width: 80, numeric: true, cell: (f) => sizeText(f.size_bytes) },
    {
      id: "get",
      header: "Download",
      width: 100,
      locked: true,
      cell: (f) => (
        <button
          type="button"
          className="m2-btn m2-sm"
          disabled={busy !== null}
          aria-label={`Download ${f.name}, ${f.file_name}`}
          onClick={(e) => {
            e.stopPropagation();
            download(f);
          }}
        >
          {busy === f.id ? "…" : "Download"}
        </button>
      ),
    },
  ];
}

function recipientsText(s: ReportSchedule, users: Map<string, string>, channels: Map<string, string>): string {
  const names = [...s.recipient_user_ids.map((id) => users.get(id) ?? id), ...s.recipient_channel_ids.map((id) => channels.get(id) ?? id)];
  return names.length === 0 ? "No one" : names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function scheduleColumns(users: Map<string, string>, channels: Map<string, string>): GridColumn<ReportSchedule>[] {
  return [
    { id: "name", header: "Report", width: 240, pin: true, locked: true, cell: (s) => <span>{s.name} <span className="m2-meta">{`${labelOf(s.kind)}, ${s.format.toUpperCase()}`}</span></span> },
    { id: "cadence", header: "Cadence", width: 230, cell: (s) => s.summary },
    { id: "to", header: "Recipients", width: 190, cell: (s) => recipientsText(s, users, channels) },
    { id: "next", header: "Next run", width: 150, cell: (s) => (s.enabled && s.next_run_at ? formatDate(s.next_run_at, "datetime") : <StatusWord tone="neutral">Paused</StatusWord>) },
    { id: "last", header: "Last result", width: 230, cell: (s) => (s.last_status ? <span><StatusWord tone={SCHEDULE_TONE[s.last_status]}>{SCHEDULE_WORD[s.last_status]}</StatusWord>{s.last_run_at ? <span className="m2-meta">{`, ${formatDate(s.last_run_at, "datetime")}`}</span> : null}</span> : <span className="m2-meta">Not run yet</span>) },
  ];
}

/** /v2/reports: the reports that exist, a way to make one, and the schedules that make them on a rhythm. */
export function ReportsCanvas() {
  const can = useCan();
  const { openItem, open } = useOpenItem();
  const history = useReportHistory();
  const schedules = useSchedules();
  const options = useScheduleOptions();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportAllowed = can("export");
  const users = new Map((options.data?.users ?? []).map((u) => [u.id, u.label]));
  const channels = new Map((options.data?.channels ?? []).map((c) => [c.id, c.label]));
  const download = async (f: ReportFile) => {
    setBusy(f.id);
    setError(null);
    try {
      await rep.downloadReportFile(f.id, f.file_name);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(null);
    }
  };
  const files = history.data?.items ?? [];
  const list = schedules.data ?? [];
  const active = list.filter((s) => s.enabled).length;
  return (
    <>
      <PageTitle>Reports</PageTitle>
      <p className="m2-finding">
        {`${history.data ? `${history.data.total} ${history.data.total === 1 ? "report" : "reports"} made, ` : ""}${schedules.data ? `${active} of ${list.length} ${list.length === 1 ? "schedule is" : "schedules are"} on` : ""}. Reports are built from stored runs, so a number in a report matches the run it names.`}
      </p>
      <div className="m2-cta">
        <button type="button" className="m2-btn m2-next" disabled={!exportAllowed} onClick={() => openItem({ kind: "report", id: "new" })}>
          Create a report
        </button>
        <button type="button" className="m2-btn" disabled={!exportAllowed} onClick={() => openItem({ kind: "schedule", id: "new" })}>
          Schedule a report
        </button>
      </div>
      {!exportAllowed ? <p className="m2-prov">Creating and scheduling reports needs the export permission.</p> : null}
      {error ? <ErrorFrame>{`The download did not finish. ${error}`}</ErrorFrame> : null}
      <section className="m2-sec" aria-label="Reports">
        <div className="m2-sechead">
          <h2 className="m2-h2">Reports</h2>
        </div>
        <ToolGrid<ReportFile>
          toolsTitle="Report history"
          id="reports-files"
          ariaLabel="Reports"
          columns={reportColumns((f) => void download(f), busy)}
          rows={files}
          rowId={(f) => f.id}
          loading={history.isPending}
          error={history.isError ? <ErrorFrame onRetry={() => void history.refetch()}>{`The reports could not be read. ${apiErrorMessage(history.error)}`}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>No report has been made yet. Create one from a run, or schedule one to arrive on its own.</EmptyFrame>}
          onOpen={(f) => openItem({ kind: "report", id: f.id })}
          openRowId={open?.kind === "report" ? open.id : null}
          compact
        />
      </section>
      <section className="m2-sec" aria-label="Schedules">
        <div className="m2-sechead">
          <h2 className="m2-h2">Schedules</h2>
          <span className="m2-sub">Each builds a report from the latest run and sends it.</span>
        </div>
        <ToolGrid<ReportSchedule>
          toolsTitle="Report schedules"
          id="reports-schedules"
          ariaLabel="Schedules"
          columns={scheduleColumns(users, channels)}
          rows={list}
          rowId={(s) => s.id}
          loading={schedules.isPending}
          error={schedules.isError ? <ErrorFrame onRetry={() => void schedules.refetch()}>{`The schedules could not be read. ${apiErrorMessage(schedules.error)}`}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>No schedule yet. Schedule the board pack and it arrives every Monday with no one asking for it.</EmptyFrame>}
          onOpen={(s) => openItem({ kind: "schedule", id: s.id })}
          openRowId={open?.kind === "schedule" ? open.id : null}
          fixedColumns
          compact
        />
      </section>
    </>
  );
}

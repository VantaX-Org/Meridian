"use client";

import { useState } from "react";
import { buildReport, createSchedule, deleteReportFile, deleteSchedule, downloadReportFile, runScheduleNow, startExport, type ExportFormat } from "@/lib/api/v2/reports";
import type { ScheduleCadence } from "@/lib/api/reports";
import { formatInt } from "@/lib/format";
import { useCatalogue, useExportOptions, useReportHistory, useScheduleOptions, useSchedules } from "@/lib/v2/admin-queries";
import { exportRequest } from "@/lib/v2/export-centre";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Select, useSheet, EmptyState } from "@/ui/kit";
import { Row, Sec, useAct, when } from "./ops/shared";

const kb = (n: number) => `${formatInt(Math.max(1, Math.round(n / 1024)))} KB`;

/** Reports: build a report, find a built one, schedule one, or export a dataset. */
export function Reports() {
  const cat = useCatalogue({});
  const hist = useReportHistory();
  const sch = useSchedules();
  const opt = useScheduleOptions();
  const exp = useExportOptions();
  const sheet = useSheet();
  const { run, busy } = useAct("reports");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [cadence, setCadence] = useState<ScheduleCadence>("weekly");
  const [time, setTime] = useState("08:00");
  const [dataset, setDataset] = useState("");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const entries = cat.data ?? [];
  const files = hist.data?.items ?? [];
  const schedules = sch.data ?? [];
  const types = opt.data?.types ?? [];
  const sets = exp.data?.datasets ?? [];
  const ds = dataset || sets[0]?.id || "";
  const k = kind || types[0]?.id || "";
  return (
    <Sec title={t("Reports")} scope="reports" q={[cat, hist, sch, opt, exp]}
      context={t("{n} reports, {m} built files", { n: entries.length, m: hist.data?.total ?? files.length })}
      facts={[t("{n} reports can be built.", { n: entries.length }), t("{n} schedules are set.", { n: schedules.length })]}
      actions={<Button variant="secondary" onClick={() => sheet.open("report")}>{t("Report guide")}</Button>}>
      <Card title={t("Build a report")}>
        <DataTable label={t("Reports")} rows={entries} rowKey={(r) => r.id} height={320}
          columns={[
            { key: "name", label: t("Report"), render: (r) => <Code code={r.id} description={r.name} /> },
            { key: "format", label: t("Format"), render: (r) => r.format },
            { key: "about", label: t("About"), render: (r) => r.about },
            { key: "last", label: t("Last built"), render: (r) => (r.last_built_at ? when(r.last_built_at) : t("Never")) },
            { key: "act", label: t("Actions"), render: (r) => (r.url
              ? <Button variant="secondary" disabled={busy} onClick={() => run(() => buildReport(r), t("Report built."))}>{t("Build")}</Button>
              : <span className="mx-muted">{t("Needs a run first")}</span>) },
          ]} />
      </Card>
      <Card title={t("Built files")}>
        {files.length === 0 ? <EmptyState heading={t("No report has been built yet.")} /> : (
          <DataTable label={t("Built files")} rows={files} rowKey={(r) => r.id} height={320}
            columns={[
              { key: "name", label: t("File"), render: (r) => <Code code={r.kind} description={r.file_name} /> },
              { key: "run", label: t("Run"), render: (r) => r.run_label ?? "" },
              { key: "size", label: t("Size"), align: "end", render: (r) => kb(r.size_bytes) },
              { key: "source", label: t("Source"), render: (r) => (r.source === "schedule" ? t("Schedule") : r.source === "run_now" ? t("Run now") : t("Download")) },
              { key: "at", label: t("Built"), render: (r) => when(r.created_at) },
              { key: "act", label: t("Actions"), render: (r) => (
                <Row>
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => downloadReportFile(r.id, r.file_name), t("File downloaded."))}>{t("Download")}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => run(() => deleteReportFile(r.id), t("File removed."))}>{t("Remove")}</Button>
                </Row>
              ) },
            ]} />
        )}
      </Card>
      <Card title={t("Schedules")}>
        {schedules.length === 0 ? <EmptyState heading={t("No report schedules yet.")} /> : (
          <DataTable label={t("Report schedules")} rows={schedules} rowKey={(r) => r.id} height={280}
            columns={[
              { key: "name", label: t("Schedule"), render: (r) => <Code code={r.kind} description={r.name} /> },
              { key: "cadence", label: t("Runs"), render: (r) => `${r.cadence} ${r.time_of_day}` },
              { key: "next", label: t("Next run"), render: (r) => (r.enabled ? when(r.next_run_at) : t("Paused")) },
              { key: "last", label: t("Last run"), render: (r) => (r.last_run_at ? `${when(r.last_run_at)} ${r.last_status ?? ""}` : t("Never")) },
              { key: "act", label: t("Actions"), render: (r) => (
                <Row>
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => runScheduleNow(r.id), t("Queued to run now."))}>{t("Run now")}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => run(() => deleteSchedule(r.id), t("Schedule removed."))}>{t("Remove")}</Button>
                </Row>
              ) },
            ]} />
        )}
        <Row>
          <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Report")}><Select value={k} onChange={(e) => setKind(e.target.value)} options={types.map((x) => ({ value: x.id, label: x.name }))} /></Field>
          <Field label={t("Runs")}><Select value={cadence} onChange={(e) => setCadence(e.target.value as ScheduleCadence)} options={[{ value: "daily", label: t("Daily") }, { value: "weekly", label: t("Weekly") }, { value: "monthly", label: t("Monthly") }]} /></Field>
          <Field label={t("Time")}><Input value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Button variant="primary" disabled={busy || !name.trim() || !k}
            onClick={() => run(async () => { await createSchedule({ name: name.trim(), kind: k, params: { scope: "latest" }, cadence, time_of_day: time, recipient_user_ids: [], recipient_channel_ids: [], enabled: true }); setName(""); }, t("Schedule added."))}>{t("Add schedule")}</Button>
        </Row>
      </Card>
      <Card title={t("Export centre")} sub={t("Write one dataset to a file.")}>
        <Row>
          <Field label={t("Dataset")}><Select value={ds} onChange={(e) => setDataset(e.target.value)} options={sets.map((x) => ({ value: x.id, label: x.name }))} /></Field>
          <Field label={t("Format")}><Select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} options={[{ value: "xlsx", label: "XLSX" }, { value: "csv", label: "CSV" }, { value: "json", label: "JSON" }, { value: "pdf", label: "PDF" }]} /></Field>
          <Button variant="primary" disabled={busy || !ds}
            onClick={() => run(() => startExport(exportRequest({ dataset: ds, format, columns: [], system: "", module: "", run: "latest", severity: [], split: "none" })), t("Export queued."))}>{t("Start export")}</Button>
        </Row>
      </Card>
    </Sec>
  );
}

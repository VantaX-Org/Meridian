"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as rep from "@/lib/api/v2/reports";
import type { ExportDataset, ExportFormat, ExportRun, ExportSeverity, ExportSplit } from "@/lib/api/v2/reports";
import type { ScheduleCadence } from "@/lib/api/reports";
import type { Job } from "@/types/jobs";
import { getJob, streamJobs } from "@/lib/api/jobs";
import { refreshAdmin, useExportOptions, useScheduleOptions } from "@/lib/v2/admin-queries";
import { exportRequest, exportSchedule, scheduleReady, type ExportChoice } from "@/lib/v2/export-centre";
import { failureText } from "@/lib/v2/errors";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { ErrorFrame } from "../parts";

const FORMAT_WORD: Record<ExportFormat, string> = { get xlsx() { return t("Excel workbook (xlsx)"); }, get csv() { return t("Comma separated (csv)"); }, get json() { return t("JSON"); }, get pdf() { return t("PDF report"); } };
const SPLIT_WORD: Record<ExportSplit, string> = { get none() { return t("One sheet"); }, get module() { return t("A sheet per object"); }, get severity() { return t("A sheet per severity"); }, get run() { return t("A sheet per run"); } };
const SEVERITY_WORD: Record<ExportSeverity, string> = { get critical() { return t("Critical"); }, get high() { return t("High"); }, get medium() { return t("Medium"); }, get low() { return t("Low"); } };

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Follows one export job on the jobs stream until it ends; falls back to one read when the stream closes early. */
function useExportJob(jobId: string | null): Job | null {
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!jobId) return;
    let done = false;
    const stop = streamJobs(
      (j) => {
        if (j.id !== jobId || done) return;
        setJob(j);
        if (j.status !== "queued" && j.status !== "running") done = true;
      },
      () => {
        if (!done) void getJob(jobId).then(setJob).catch(() => undefined);
      },
    );
    return () => {
      done = true;
      stop();
    };
  }, [jobId]);
  return jobId ? job : null;
}

/** The export centre on /reports: any dataset, any format, chosen columns and filters, now or on a schedule. */
export function ExportCentre() {
  const qc = useQueryClient();
  const options = useExportOptions();
  const sched = useScheduleOptions();
  const datasets = options.data?.datasets ?? [];
  const [datasetId, setDatasetId] = useState("");
  const ds: ExportDataset | undefined = datasets.find((d) => d.id === datasetId) ?? datasets[0];
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [columns, setColumns] = useState<string[] | null>(null);
  const [system, setSystem] = useState("");
  const [moduleKey, setModule] = useState("");
  const [run, setRun] = useState<ExportRun>("latest");
  const [severities, setSeverity] = useState<ExportSeverity[]>([]);
  const [split, setSplit] = useState<ExportSplit>("none");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState<ScheduleCadence>("weekly");
  const [time, setTime] = useState("07:00");
  const [users, setUsers] = useState<string[]>([]);
  const [folder, setFolder] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const job = useExportJob(jobId);
  const fetched = useRef<string | null>(null);

  useEffect(() => {
    if (job?.status === "completed" && fetched.current !== job.id) {
      fetched.current = job.id;
      void refreshAdmin(qc, "reports");
    }
  }, [job, qc]);

  if (options.isError) return <ErrorFrame onRetry={() => void options.refetch()}>{t("The export choices could not be read. {error}", { error: failureText(options.error) })}</ErrorFrame>;
  if (!ds) return <p className="m2-meta">{t("Reading the export choices.")}</p>;

  const all = ds.columns.map((c) => c.key);
  const chosen = columns ?? all;
  const has = (f: string) => ds.filters.includes(f);
  const formats = (options.data?.formats ?? []).filter((f) => f !== "pdf" || ds.pdf);
  const fmt = formats.includes(format) ? format : "xlsx";
  const choice: ExportChoice = {
    dataset: ds.id,
    format: fmt,
    columns: chosen.length === all.length ? [] : all.filter((k) => chosen.includes(k)),
    system: has("system") ? system : "",
    module: has("module") ? moduleKey : "",
    run: has("run") ? run : "latest",
    severity: has("severity") ? severities : [],
    split,
  };
  const running = job ? job.status === "queued" || job.status === "running" : jobId !== null && !error;
  const fileId = job?.status === "completed" ? (job.result?.report_file_id as string | undefined) : undefined;

  const pickDataset = (id: string) => {
    setDatasetId(id);
    setColumns(null);
    setJobId(null);
  };
  const start = async () => {
    setBusy(true);
    setError(null);
    setJobId(null);
    try {
      const { job_id } = await rep.startExport(exportRequest(choice));
      setJobId(job_id);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  const schedule = { name: name || t("{name} export", { name: ds.name }), cadence, time, users, folder };
  const saveSchedule = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const s = await rep.createSchedule(exportSchedule(choice, schedule));
      setSaved(s.summary);
      setScheduling(false);
      await refreshAdmin(qc, "reports");
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="m2-sec" aria-label={t("Export centre")} data-testid="export-centre">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Export centre")}</h2>
        <span className="m2-sub">{t("Every code comes with its description. Large exports run on the worker and land in the report history.")}</span>
      </div>
      <div className="m2-aform">
        <label>
          {t("Data")}
          <select value={ds.id} onChange={(e) => pickDataset(e.target.value)}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Format")}
          <select value={fmt} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {formats.map((f) => (
              <option key={f} value={f}>
                {FORMAT_WORD[f]}
              </option>
            ))}
          </select>
        </label>
        {has("system") ? (
          <label>
            {t("System")}
            <select value={system} onChange={(e) => setSystem(e.target.value)}>
              <option value="">{t("Every system")}</option>
              <option value="upload">{t("File uploads")}</option>
              {(sched.data?.systems ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {has("module") ? (
          <label>
            {t("Object")}
            <select value={moduleKey} onChange={(e) => setModule(e.target.value)}>
              <option value="">{t("All objects")}</option>
              {(sched.data?.modules ?? []).map((m) => (
                <option key={m} value={m}>
                  {moduleText(m)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {has("run") ? (
          <label>
            {t("Runs")}
            <select value={run} onChange={(e) => setRun(e.target.value as ExportRun)}>
              <option value="latest">{t("The latest run of each object")}</option>
              <option value="all">{t("Every stored run")}</option>
            </select>
          </label>
        ) : null}
        {fmt === "xlsx" ? (
          <label>
            {t("Sheets")}
            <select value={split} onChange={(e) => setSplit(e.target.value as ExportSplit)}>
              {(options.data?.splits ?? []).map((s) => (
                <option key={s} value={s}>
                  {SPLIT_WORD[s]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {has("severity") ? (
        <ul className="m2-pick" aria-label={t("Severities to include, none means all")}>
          {(options.data?.severities ?? []).map((s) => (
            <li key={s}>
              <label>
                <input type="checkbox" checked={severities.includes(s)} onChange={() => setSeverity(toggle(severities, s))} />
                <span>{SEVERITY_WORD[s]}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {fmt === "pdf" ? (
        <p className="m2-prov">{t("The PDF is the matching report, so the column and severity choices do not apply to it.")}</p>
      ) : (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="m2-meta">{t("{n} of {total} columns", { n: chosen.length, total: all.length })}</legend>
          <ul className="m2-pick" aria-label={t("Columns to include")}>
            {ds.columns.map((c) => (
              <li key={c.key}>
                <label>
                  <input type="checkbox" checked={chosen.includes(c.key)} disabled={chosen.length === 1 && chosen.includes(c.key)} onChange={() => setColumns(toggle(chosen, c.key))} />
                  <span>{c.header}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div className="m2-cta">
        <button type="button" className="m2-btn m2-strong" disabled={busy || running} onClick={() => void start()}>
          {t("Run export")}
        </button>
        <button type="button" className="m2-linkbtn" disabled={busy} onClick={() => setScheduling(!scheduling)}>
          {t("Schedule this export")}
        </button>
      </div>
      {error ? <ErrorFrame>{t("The export did not start. {error}", { error })}</ErrorFrame> : null}
      {jobId ? (
        <div role="status" aria-live="polite" data-testid="export-progress">
          {!job || running ? (
            <p className="m2-meta">{job ? t("{stage}, {percent}%", { stage: job.stages.find((s) => s.id === job.stage)?.label ?? t("Queued"), percent: Math.round(job.percent) }) : t("Queued on the worker.")}</p>
          ) : job.status === "completed" && fileId ? (
            <p>
              {t("The export is ready and stored in the report history.")}{" "}
              <button type="button" className="m2-btn m2-sm" onClick={() => void rep.downloadReportFile(fileId, `${ds.id}.${fmt}`).catch((e) => setError(failureText(e)))}>
                {t("Download")}
              </button>
            </p>
          ) : (
            <ErrorFrame>{t("The export did not finish. {error}", { error: job.error ?? job.message })}</ErrorFrame>
          )}
        </div>
      ) : null}
      {saved ? <p className="m2-prov">{t("Scheduled: {summary}", { summary: saved })}</p> : null}
      {scheduling ? (
        <div data-testid="export-schedule">
          <div className="m2-aform">
            <label>
              {t("Name")}
              <input value={schedule.name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t("Cadence")}
              <select value={cadence} onChange={(e) => setCadence(e.target.value as ScheduleCadence)}>
                <option value="daily">{t("Every day")}</option>
                <option value="weekly">{t("Every Monday")}</option>
                <option value="monthly">{t("On the first of each month")}</option>
              </select>
            </label>
            <label>
              {t("At ({timezone})", { timezone: sched.data?.timezone ?? t("tenant time zone") })}
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label className="m2-meta">
            <input type="checkbox" checked={folder} onChange={() => setFolder(!folder)} /> {t("Also save it to the server export folder")}
          </label>
          <ul className="m2-pick" aria-label={t("People who receive it by email")}>
            {(sched.data?.users ?? []).map((u) => (
              <li key={u.id}>
                <label>
                  <input type="checkbox" checked={users.includes(u.id)} onChange={() => setUsers(toggle(users, u.id))} />
                  <span>{u.label}</span>
                  <span className="m2-meta">{u.detail}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="m2-prov">{t("Email goes through the notification settings already in place. Only people with the export permission can receive it.")}</p>
          <button type="button" className="m2-btn m2-strong" disabled={busy || !scheduleReady(schedule)} onClick={() => void saveSchedule()}>
            {t("Save schedule")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

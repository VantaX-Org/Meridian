"use client";

import { useState, type ReactNode } from "react";
import type { ReportFile, ReportSchedule } from "@/lib/api/reports";
import * as rep from "@/lib/api/v2/reports";
import { apiErrorMessage } from "@/lib/error";
import { failureText } from "@/lib/v2/errors";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { useCatalogue, useReportHistory, useScheduleOptions, useSchedules } from "@/lib/v2/admin-queries";
import { type GridColumn } from "../Grid";
import { Dash, EmptyFrame, ErrorFrame, PageTitle } from "../parts";
import { StatusWord, useCan } from "../admin/kit";
import { SCHEDULE_TONE, SCHEDULE_WORD, sizeText } from "../inspector/reports";
import { ToolGrid } from "../GridTools";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import type { Verdict } from "@/lib/api/v2/types";
import { CcBanner, CcHBars, CcPage, type CcBarRow } from "./cc-parts";

const SOURCE: Record<ReportFile["source"], string> = { get download() { return t("Downloaded"); }, get schedule() { return t("Scheduled"); }, get run_now() { return t("On request"); } };

function reportColumns(download: (f: ReportFile) => void, busy: string | null): GridColumn<ReportFile>[] {
  return [
    { id: "name", header: t("Report"), width: 200, pin: true, locked: true, cell: (f) => f.name },
    { id: "kind", header: t("Kind"), width: 100, defaultHidden: true, cell: (f) => labelText(f.kind) },
    { id: "run", header: t("Run"), width: 160, cell: (f) => f.run_label ?? (f.run_at ? formatDate(f.run_at) : <Dash why={t("Not tied to one run")} />) },
    { id: "format", header: t("Format"), width: 70, cell: (f) => f.format.toUpperCase() },
    { id: "created", header: t("Created"), width: 150, cell: (f) => formatDate(f.created_at, "datetime") },
    { id: "by", header: t("By"), width: 160, cell: (f) => f.created_by_label ?? (f.source === "schedule" ? t("Schedule") : <Dash />) },
    { id: "source", header: t("How"), width: 110, defaultHidden: true, cell: (f) => SOURCE[f.source] },
    { id: "size", header: t("Size"), width: 80, numeric: true, cell: (f) => sizeText(f.size_bytes) },
    {
      id: "get",
      header: t("Download"),
      width: 100,
      locked: true,
      cell: (f) => (
        <button
          type="button"
          className="m2-btn m2-sm"
          disabled={busy !== null}
          aria-label={t("Download {name}, {file_name}", { name: f.name, file_name: f.file_name })}
          onClick={(e) => {
            e.stopPropagation();
            download(f);
          }}
        >
          {busy === f.id ? "…" : t("Download")}
        </button>
      ),
    },
  ];
}

function recipientsText(s: ReportSchedule, users: Map<string, string>, channels: Map<string, string>): string {
  const names = [...s.recipient_user_ids.map((id) => users.get(id) ?? id), ...s.recipient_channel_ids.map((id) => channels.get(id) ?? id)];
  return names.length === 0 ? t("No one") : names.length <= 2 ? names.join(", ") : t("{names} and {count} more", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
}

function scheduleColumns(users: Map<string, string>, channels: Map<string, string>): GridColumn<ReportSchedule>[] {
  return [
    { id: "name", header: t("Report"), width: 240, pin: true, locked: true, cell: (s) => <span>{s.name} <span className="m2-meta">{`${labelText(s.kind)}, ${s.format.toUpperCase()}`}</span></span> },
    { id: "cadence", header: t("Cadence"), width: 230, cell: (s) => s.summary },
    { id: "to", header: t("Recipients"), width: 190, cell: (s) => recipientsText(s, users, channels) },
    { id: "next", header: t("Next run"), width: 150, cell: (s) => (s.enabled && s.next_run_at ? formatDate(s.next_run_at, "datetime") : <StatusWord tone="neutral">{t("Paused")}</StatusWord>) },
    { id: "last", header: t("Last result"), width: 230, cell: (s) => (s.last_status ? <span><StatusWord tone={SCHEDULE_TONE[s.last_status]}>{SCHEDULE_WORD[s.last_status]}</StatusWord>{s.last_run_at ? <span className="m2-meta">{`, ${formatDate(s.last_run_at, "datetime")}`}</span> : null}</span> : <span className="m2-meta">{t("Not run yet")}</span>) },
  ];
}

/** A schedule is late when it is on and its next run is more than an hour past: the scheduler missed it. */
const LATE_MS = 60 * 60 * 1000;
const isLate = (s: ReportSchedule, now: number): boolean => s.enabled && !!s.next_run_at && now - Date.parse(s.next_run_at) > LATE_MS;

/** The banner and the reports-by-kind bars: whether the schedules deliver, and which reports people make. */
function ReportsOverview({ files, total, list, names, action }: { files: readonly ReportFile[]; total: number | null; list: readonly ReportSchedule[]; names: Map<string, { name: string; about: string }>; action: ReactNode }) {
  const [now] = useState(() => Date.now());
  const failed = list.filter((s) => s.last_status === "failed");
  const late = list.filter((s) => isLate(s, now));
  const partial = list.filter((s) => s.last_status === "partial");
  const active = list.filter((s) => s.enabled).length;
  const scheduled = files.filter((f) => f.source === "schedule").length;
  const [verdict, headline, why]: [Verdict, string, string] = failed.length
    ? ["no-go", t("{n} {count, plural, one {schedule failed} other {schedules failed}} on the last run", { n: int(failed.length), count: failed.length }), t("{name} did not deliver. Open it to see why, then run it again.", { name: failed[0].name })]
    : late.length
      ? ["no-go", t("{n} {count, plural, one {schedule is} other {schedules are}} overdue", { n: int(late.length), count: late.length }), t("{name} should have run by now and has not.", { name: late[0].name })]
      : partial.length
        ? ["at-risk", t("{n} {count, plural, one {schedule} other {schedules}} reached only some recipients", { n: int(partial.length), count: partial.length }), t("{name} was partly delivered. Check its recipients.", { name: partial[0].name })]
        : ["go", list.length ? t("Every schedule delivered on its last run") : t("No report goes out on a schedule yet"), list.length ? t("Each schedule reached its recipients the last time it ran.") : t("Schedule a report and it arrives with no one asking for it.")];
  const byKind = new Map<string, { n: number; sched: number }>();
  for (const f of files) {
    const k = byKind.get(f.kind) ?? { n: 0, sched: 0 };
    k.n += 1;
    if (f.source === "schedule") k.sched += 1;
    byKind.set(f.kind, k);
  }
  const bars: CcBarRow[] = [...byKind]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([kind, v]) => {
      const c = names.get(kind);
      return {
        key: kind,
        label: (
          <>
            {c?.name ?? labelText(kind)} <span className="m2-meta">{c?.about || t("Report kind {kind}", { kind })}</span>
          </>
        ),
        value: v.n,
        text: v.sched ? t("{n} made, {s} by schedule", { n: int(v.n), s: int(v.sched) }) : t("{n} made", { n: int(v.n) }),
      };
    });
  return (
    <>
      <CcBanner
        testId="reports-banner"
        label={t("Report delivery")}
        eyebrow={t("Report delivery")}
        verdict={verdict}
        headline={headline}
        why={why}
        figs={[
          { label: t("Reports made"), value: total == null ? "—" : int(total), note: t("{n} of the latest by schedule", { n: int(scheduled) }) },
          { label: t("Schedules on"), value: int(active), note: t("of {n} in all", { n: int(list.length) }) },
          { label: t("Need attention"), value: int(failed.length + late.length + partial.length), note: t("failed, overdue or partly delivered") },
        ]}
        action={action}
      />
      {bars.length > 0 ? (
        <section className="m2-cc-card" aria-label={t("Reports made by kind")} data-testid="reports-by-kind">
          <h3>{t("Reports made by kind")}</h3>
          <p className="m2-cc-lede">{t("Counted over the latest {n} reports in the history.", { n: int(files.length) })}</p>
          <CcHBars rows={bars} label={t("Reports made by kind")} />
        </section>
      ) : null}
    </>
  );
}

/** /reports: the reports that exist, a way to make one, and the schedules that make them on a rhythm. */
export function ReportsCanvas() {
  const can = useCan();
  const { openItem, open } = useOpenItem();
  const history = useReportHistory();
  const schedules = useSchedules();
  const options = useScheduleOptions();
  const catalogue = useCatalogue({});
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
  const names = new Map((catalogue.data ?? []).map((c) => [c.id, { name: c.name, about: c.about }]));
  const create = (
    <button type="button" className="m2-btn m2-next" disabled={!exportAllowed} onClick={() => openItem({ kind: "report", id: "new" })}>
      {t("Create a report")}
    </button>
  );
  return (
    <CcPage>
      <PageTitle>{t("Reports")}</PageTitle>
      {schedules.data && !history.isPending ? <ReportsOverview files={files} total={history.data?.total ?? null} list={list} names={names} action={create} /> : <div className="m2-cta">{create}</div>}
      <p className="m2-finding">
        {t("{value}{value2}. Reports are built from stored runs, so a number in a report matches the run it names.", { value: history.data ? t("{total} {total, plural, one {report} other {reports}} made, ", { total: history.data.total }) : "", value2: schedules.data ? t("{active} of {listCount} {listCount, plural, one {schedule is} other {schedules are}} on", { active, listCount: list.length }) : "" })}
      </p>
      <div className="m2-cta">
        <button type="button" className="m2-btn" disabled={!exportAllowed} onClick={() => openItem({ kind: "schedule", id: "new" })}>
          {t("Schedule a report")}
        </button>
      </div>
      {!exportAllowed ? <p className="m2-prov">{t("Creating and scheduling reports needs the export permission.")}</p> : null}
      {error ? <ErrorFrame>{t("The download did not finish. {error}", { error })}</ErrorFrame> : null}
      <section className="m2-sec" aria-label={t("Reports")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{t("Reports")}</h2>
        </div>
        <ToolGrid<ReportFile>
          toolsTitle={t("Report history")}
          id="reports-files"
          ariaLabel={t("Reports")}
          columns={reportColumns((f) => void download(f), busy)}
          rows={files}
          rowId={(f) => f.id}
          loading={history.isPending}
          error={history.isError ? <ErrorFrame onRetry={() => void history.refetch()}>{t("The reports could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(history.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{t("No report has been made yet. Create one from a run, or schedule one to arrive on its own.")}</EmptyFrame>}
          onOpen={(f) => openItem({ kind: "report", id: f.id })}
          openRowId={open?.kind === "report" ? open.id : null}
          compact
        />
      </section>
      <section className="m2-sec" aria-label={t("Schedules")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{t("Schedules")}</h2>
          <span className="m2-sub">{t("Each builds a report from the latest run and sends it.")}</span>
        </div>
        <ToolGrid<ReportSchedule>
          toolsTitle={t("Report schedules")}
          id="reports-schedules"
          ariaLabel={t("Schedules")}
          columns={scheduleColumns(users, channels)}
          rows={list}
          rowId={(s) => s.id}
          loading={schedules.isPending}
          error={schedules.isError ? <ErrorFrame onRetry={() => void schedules.refetch()}>{t("The schedules could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(schedules.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{t("No schedule yet. Schedule the board pack and it arrives every Monday with no one asking for it.")}</EmptyFrame>}
          onOpen={(s) => openItem({ kind: "schedule", id: s.id })}
          openRowId={open?.kind === "schedule" ? open.id : null}
          fixedColumns
          compact
        />
      </section>
    </CcPage>
  );
}

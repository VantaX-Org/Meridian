"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { AdminCanvas } from "@/design/v2/admin/Admin";
import { downloadReportFile } from "@/lib/api/v2/reports";
import { useReportHistory, useSchedules } from "@/lib/v2/admin-queries";
import type { ReportFile, ReportSchedule } from "@/lib/api/reports";
import { Button, Chip, SegmentedControl, useToast } from "../kit";
import { useSheets } from "../shell/SheetHost";
import { LegacyMount } from "../shell/LegacyMount";
import { failureText } from "@/lib/v2/errors";
import { ListSearch, LongText, QueryView, VirtualList } from "./states";

type Seg = "files" | "schedules" | "links";
const STATUS_TONE = { sent: "good", running: "accent", partial: "warn", failed: "bad", skipped: "neutral" } as const;

function Files() {
  const q = useReportHistory();
  const toast = useToast();
  const [find, setFind] = useState("");
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? items.filter((f) => `${f.name} ${f.file_name} ${f.run_label ?? ""}`.toLowerCase().includes(n)) : items;
  }, [items, find]);
  const get = (f: ReportFile) => downloadReportFile(f.id, f.file_name).catch((e) => toast({ text: failureText(e), tone: "bad" }));
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={items.length === 0} emptyHeading={t("No reports yet")} emptyText={t("Build one and it is kept here.")} label={t("Loading reports")}>
      <ListSearch value={find} onChange={setFind} label={t("Search reports")} />
      <p className="nx-sub" role="status">{t("{n} files", { n: shown.length })}</p>
      {shown.length === 0 ? <p className="nx-sub">{t("No report matches this search.")}</p> : (
        <VirtualList rows={shown} rowKey={(f) => f.id} label={t("Report files")} render={(f) => (
          <div className="nx-row">
            <LongText text={f.name} className="nx-row-main" />
            <span className="nx-sub">{f.run_label ?? ""}</span>
            <Chip>{f.format.toUpperCase()}</Chip>
            <Button size={32} onClick={() => void get(f)}>{t("Download")}</Button>
          </div>
        )} />
      )}
    </QueryView>
  );
}

function Schedules() {
  const q = useSchedules();
  const [find, setFind] = useState("");
  const items: ReportSchedule[] = useMemo(() => q.data ?? [], [q.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? items.filter((s) => `${s.name} ${s.summary}`.toLowerCase().includes(n)) : items;
  }, [items, find]);
  const status = { sent: t("Sent"), running: t("Running"), partial: t("Partly sent"), failed: t("Failed"), skipped: t("Skipped") };
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={items.length === 0} emptyHeading={t("Nothing is scheduled")} emptyText={t("Schedule a report and it arrives on its own.")} label={t("Loading schedules")}>
      <ListSearch value={find} onChange={setFind} label={t("Search schedules")} />
      {shown.length === 0 ? <p className="nx-sub">{t("No schedule matches this search.")}</p> : (
        <VirtualList rows={shown} rowKey={(s) => s.id} label={t("Schedules")} render={(s) => (
          <div className="nx-row">
            <LongText text={s.name} className="nx-row-main" />
            <LongText text={s.summary} className="nx-sub" />
            {s.enabled ? null : <Chip>{t("Paused")}</Chip>}
            {s.last_status ? <Chip tone={STATUS_TONE[s.last_status]}>{status[s.last_status]}</Chip> : null}
          </div>
        )} />
      )}
    </QueryView>
  );
}

/** Reports in three segments: the files built, the schedules, the shared links. A New report sheet starts one. */
export function Reports() {
  const [seg, setSeg] = useState<Seg>("files");
  const sheets = useSheets();
  return (
    <div className="nx-body">
      <div className="nx-row">
        <SegmentedControl label={t("Reports")} value={seg} onChange={(v) => setSeg(v as Seg)} items={[{ value: "files", label: t("Files") }, { value: "schedules", label: t("Schedules") }, { value: "links", label: t("Shared links") }]} />
        <Button variant="primary" onClick={() => sheets.open({ kind: "report", id: "new" })}>{t("New report")}</Button>
      </div>
      {seg === "files" ? <Files /> : seg === "schedules" ? <Schedules /> : <LegacyMount><AdminCanvas section="sharelinks" /></LegacyMount>}
    </div>
  );
}

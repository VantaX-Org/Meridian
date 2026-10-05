"use client";

/**
 * Workbench, Reports: every completed analysis as a downloadable report
 * (PDF for people, JSON for systems, the config-match workbook for
 * consultants). ?version_id= preselects a report, even an older one.
 */

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, KeyValue, Mono, PageHeader, TableSkeleton, Tally, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { apiErrorMessage } from "@/lib/api/optional";
import { copyToClipboard } from "@/lib/actions";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { downloadAuthenticated } from "@/lib/api/download";
import { compositeDqs } from "@/lib/api/findings";
import { getAnalysisReportUrl, getCleaningReportUrl, getComparisonReportUrl, getExtractionReportUrl, getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { archiveVersions, getVersion, getVersions, restoreVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Version } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const DONE = new Set(["complete", "agents_complete", "ai_enriched"]);
const exportable = (v: Version) => DONE.has(v.status) && !!v.dqs_summary;
const checks = (v: Version) => Object.values(v.dqs_summary ?? {}).reduce((a, m) => a + (m.total_checks ?? 0), 0);
const name = (v: Version) => v.label ?? v.metadata?.file_name ?? `Analysis ${v.id.slice(0, 8)}`;
const stamp = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
type Kind = "pdf" | "analysis" | "extraction" | "compare" | "cleaning" | "json" | "config";
const FILE: Record<Kind, { url: (id: string) => string; file: (id: string) => string; label: string }> = {
  pdf: { url: getReportDownloadUrl, file: (id) => `meridian_dq_report_${id.slice(0, 8)}.pdf`, label: "PDF report" },
  analysis: { url: getAnalysisReportUrl, file: (id) => `meridian_analysis_${id.slice(0, 8)}.pdf`, label: "Analysis run PDF" },
  extraction: { url: getExtractionReportUrl, file: (id) => `meridian_extraction_${id.slice(0, 8)}.pdf`, label: "Extraction PDF" },
  compare: { url: (id) => getComparisonReportUrl(id), file: (id) => `meridian_comparison_${id.slice(0, 8)}.pdf`, label: "Compare with previous PDF" },
  cleaning: { url: getCleaningReportUrl, file: (id) => `meridian_cleaning_${id.slice(0, 8)}.pdf`, label: "Cleaning and fixes PDF" },
  json: { url: getReportJsonExportUrl, file: (id) => `meridian_dq_report_${id.slice(0, 8)}.json`, label: "JSON export" },
  config: { url: getConfigMatchesExportUrl, file: (id) => `meridian-config-${id.slice(0, 8)}.xlsx`, label: "Config workbook" },
};

export function ReportsSurface() {
  const linked = useSearchParams().get("version_id");
  const drawer = useDrawerParam("report");
  const q = useQuery({ queryKey: ["reports.versions", { limit: 50 }], queryFn: () => getVersions({ limit: 50 }) });
  const listed = !!linked && !!q.data?.versions.some((v) => v.id === linked);
  const linkedQ = useQuery({ queryKey: ["version", linked], queryFn: () => getVersion(linked as string), enabled: !!linked && !!q.data && !listed });
  const versions = useMemo(() => (linkedQ.data && !listed ? [linkedQ.data, ...(q.data?.versions ?? [])] : q.data?.versions ?? []).filter(exportable), [q.data, linkedQ.data, listed]);
  const selectedId = drawer.value ?? linked;
  const selected = selectedId ? versions.find((v) => v.id === selectedId) ?? null : null;
  const latest = versions[0];
  const latestDqs = latest ? compositeDqs(latest.dqs_summary) : null;
  const week = versions.filter((v) => Date.now() - new Date(v.run_at).getTime() < 7 * 86_400_000).length;

  const qc = useQueryClient();
  const [confirmClear, setConfirmClear] = useState(false);
  const restore = useMutation({
    mutationFn: restoreVersions,
    onSuccess: () => qc.invalidateQueries(),
  });
  const clear = useMutation({
    mutationFn: () => archiveVersions(1),
    onSuccess: ({ archived }) => {
      qc.invalidateQueries();
      toast.success(archived ? `Cleared ${archived} old run${archived === 1 ? "" : "s"}. The latest run stays.` : "No old runs to clear.",
        archived ? { action: { label: "Undo", onClick: () => restore.mutate() } } : undefined);
    },
    onError: (e) => toast.error(`Old runs were not cleared. ${apiErrorMessage(e)}`),
  });

  const download = useMutation({
    mutationFn: ({ v, kind }: { v: Version; kind: Kind }) => downloadAuthenticated(FILE[kind].url(v.id), FILE[kind].file(v.id)),
    onSuccess: (_r, { kind }) => toast.success(`${FILE[kind].label} downloaded`),
    onError: (e, { kind }) => toast.error(`${FILE[kind].label} did not download. ${apiErrorMessage(e)}`),
  });

  const columns = useMemo<ColumnDef<Version, unknown>[]>(() => [
    { id: "name", header: "Analysis", meta: meta({ sticky: "start", width: 260 }), cell: ({ row }) => (
      <span><strong>{name(row.original)}</strong><div className="ui-micro"><Mono>{row.original.id.slice(0, 8)}</Mono>, {stamp(row.original.run_at)}</div></span>) },
    { id: "objects", header: "Objects", cell: ({ row }) => Object.keys(row.original.dqs_summary ?? {}).map(formatModuleName).join(", ") },
    { id: "checks", header: "Checks", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => checks(row.original).toLocaleString() },
    { id: "dqs", header: "DQS", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => compositeDqs(row.original.dqs_summary)?.toFixed(1) ?? "—" },
    { id: "when", header: "Run", meta: meta({ width: 110 }), cell: ({ row }) => relativeTime(row.original.run_at) },
    { id: "pdf", header: "", meta: meta({ width: 110 }), cell: ({ row }) => (
      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); download.mutate({ v: row.original, kind: "pdf" }); }} disabled={download.isPending}>PDF</Button>) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [download.isPending]);
  const objectsOf = (v: Version) => Object.keys(v.dqs_summary ?? {}).length;

  return (
    <div className="ui-page">
      <PageHeader title="Reports" summary="Every completed analysis as a PDF for people, JSON for systems, and the config workbook for consultants."
        actions={latest ? <>
          {versions.length > 1 ? <Button variant="secondary" onClick={() => setConfirmClear(true)} disabled={clear.isPending}>Clear old runs</Button> : null}
          <Button onClick={() => download.mutate({ v: latest, kind: "pdf" })} disabled={download.isPending}>Download latest PDF</Button>
        </> : null} />
      {confirmClear ? (
        <Banner tone="warning" title="Clear old runs?"
          action={<div className="ui-page-header__actions">
            <Button size="sm" variant="danger" disabled={clear.isPending} onClick={() => { clear.mutate(); setConfirmClear(false); }}>Clear old runs</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Keep runs</Button>
          </div>}>
          Every run except the latest is archived. You can undo this from the confirmation message.
        </Banner>
      ) : null}
      <Tally level={2} label="Reports" figures={[
        { label: "Reports", value: q.isLoading ? null : versions.length, loading: q.isLoading, verdict: versions.length ? "Completed analyses." : "No analysis has finished yet.", href: "/reports" },
        { label: "This week", value: q.isLoading ? null : week, loading: q.isLoading, verdict: week ? "Written in the last 7 days." : "Nothing written this week.", href: "/reports" },
        { label: "Latest DQS", value: latestDqs === null ? (q.isLoading ? null : "None") : Math.round(latestDqs * 10) / 10, loading: q.isLoading,
          tone: latestDqs !== null && latestDqs < 70 ? "danger" : latestDqs !== null && latestDqs < 90 ? "warning" : undefined,
          verdict: latest ? `Run ${relativeTime(latest.run_at)}.` : "No analysis has completed.", href: latest ? `/reports?report=${latest.id}` : "/reports" },
      ]} />
      {q.isLoading ? <TableSkeleton rows={8} label="Loading completed analyses" />
        : q.error ? <Banner tone="danger" title="Analyses could not be read">{apiErrorMessage(q.error)}</Banner>
        : versions.length ? (
          <>
            <p className="ui-note">{latest ? <>Latest: {name(latest)}, {checks(latest).toLocaleString()} checks over {objectsOf(latest)} object{objectsOf(latest) === 1 ? "" : "s"}. </> : null}Open a row for the JSON export and the config workbook.</p>
            <DataTable columns={columns} data={versions} getRowId={(v) => v.id} onRowActivate={(v) => drawer.open(v.id)} ariaLabel="Reports" maxHeight="60vh" />
          </>
        )
        : <EmptyState>No reports yet. A report is written when an analysis completes. Import a file or download objects from a system to run one.</EmptyState>}
      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Report details"
        header={selected ? <div className="ui-drawer-head"><h2 className="ui-drawer-head__title">{name(selected)}</h2></div> : null}>
        {selected ? (
          <div className="ui-detail">
            <KeyValue rows={[
              { k: "Version", v: selected.id.slice(0, 8), mono: true },
              { k: "Run", v: stamp(selected.run_at) },
              { k: "Status", v: selected.status.replace(/_/g, " ") },
              { k: "Checks", v: checks(selected).toLocaleString() },
              { k: "DQS", v: compositeDqs(selected.dqs_summary)?.toFixed(1) ?? "—" },
            ]} />
            <section className="ui-detail-part">
              <h3 className="ui-detail-part__title">Objects</h3>
              <table className="ui-mini-table">
                <thead><tr><th>Object</th><th className="ui-num">DQS</th><th>Capped</th></tr></thead>
                <tbody>
                  {Object.entries(selected.dqs_summary ?? {}).map(([m, s]) => (
                    <tr key={m}><td>{formatModuleName(m)}</td><td className="ui-num">{s.composite_score.toFixed(1)}</td><td>{s.capped ? "Yes, by a critical failure" : "No"}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
            <div className="ui-form__actions">
              {(Object.keys(FILE) as Kind[]).filter((k) => k !== "extraction" || selected.metadata?.source === "extraction").map((k) => (
                <Button key={k} variant={k === "pdf" ? "primary" : "secondary"} onClick={() => download.mutate({ v: selected, kind: k })} disabled={download.isPending}>{FILE[k].label}</Button>
              ))}
              <Button variant="ghost" onClick={() => copyToClipboard(selected.id, "Version ID copied")}>Copy version ID</Button>
            </div>
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

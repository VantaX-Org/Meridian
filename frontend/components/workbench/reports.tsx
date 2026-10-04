"use client";

/**
 * Workbench, Reports: every completed analysis as a downloadable report
 * (PDF for people, JSON for systems, the config-match workbook for
 * consultants). ?version_id= preselects a report, even an older one.
 */

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, KeyValue, Metric, MetricStrip, Mono, PageHeader, TableSkeleton, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { apiErrorMessage } from "@/lib/api/optional";
import { copyToClipboard } from "@/components/meridian/actions";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { downloadAuthenticated } from "@/lib/api/download";
import { compositeDqs } from "@/lib/api/findings";
import { getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getVersion, getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Version } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const DONE = new Set(["complete", "agents_complete", "ai_enriched"]);
const exportable = (v: Version) => DONE.has(v.status) && !!v.dqs_summary;
const checks = (v: Version) => Object.values(v.dqs_summary ?? {}).reduce((a, m) => a + (m.total_checks ?? 0), 0);
const name = (v: Version) => v.label ?? v.metadata?.file_name ?? `Analysis ${v.id.slice(0, 8)}`;
const stamp = (iso: string) => new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
type Kind = "pdf" | "json" | "config";
const FILE: Record<Kind, { url: (id: string) => string; file: (id: string) => string; label: string }> = {
  pdf: { url: getReportDownloadUrl, file: (id) => `meridian_dq_report_${id.slice(0, 8)}.pdf`, label: "PDF report" },
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
        actions={latest ? <Button onClick={() => download.mutate({ v: latest, kind: "pdf" })} disabled={download.isPending}>Download latest PDF</Button> : null} />
      <MetricStrip label="Reports">
        <Metric label="Reports" value={versions.length} />
        <Metric label="This week" value={week} />
        <Metric label="Latest DQS" value={latestDqs?.toFixed(1) ?? "—"} tone={latestDqs !== null && latestDqs < 70 ? "danger" : latestDqs !== null && latestDqs < 90 ? "warning" : "default"} />
        <Metric label="Latest run" value={latest ? relativeTime(latest.run_at) : "—"} />
      </MetricStrip>
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
              {(Object.keys(FILE) as Kind[]).map((k) => (
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

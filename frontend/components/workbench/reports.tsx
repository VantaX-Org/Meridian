"use client";

/**
 * Workbench → Reports: every completed analysis as a downloadable report
 * (PDF for people, JSON for systems, the config-match workbook for
 * consultants). ?version_id= preselects a report, even an older one.
 */

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Button, Chip, DataTable, Drawer, EmptyState, KpiRail, Stack, Stat, Text, useDrawerParam, type AuroraColumnMeta } from "@/components/aurora";
import { copyToClipboard } from "@/components/meridian/actions";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { downloadAuthenticated } from "@/lib/api/download";
import { compositeDqs } from "@/lib/api/findings";
import { getAnalysisReportUrl, getCleaningReportUrl, getComparisonReportUrl, getExtractionReportUrl, getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getVersion, getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Version } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const DONE = new Set(["complete", "agents_complete", "ai_enriched"]);
const exportable = (v: Version) => DONE.has(v.status) && !!v.dqs_summary;
const checks = (v: Version) => Object.values(v.dqs_summary ?? {}).reduce((a, m) => a + (m.total_checks ?? 0), 0);
const name = (v: Version) => v.label ?? v.metadata?.file_name ?? `Analysis ${v.id.slice(0, 8)}`;
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

  const download = useMutation({
    mutationFn: ({ v, kind }: { v: Version; kind: Kind }) => downloadAuthenticated(FILE[kind].url(v.id), FILE[kind].file(v.id)),
    onSuccess: (_r, { kind }) => toast.success(`${FILE[kind].label} downloaded`),
    onError: (e, { kind }) => toast.error((e as Error).message || `${FILE[kind].label} did not download`),
  });

  const columns = useMemo<ColumnDef<Version, unknown>[]>(() => [
    { id: "name", header: "Analysis", meta: meta({ sticky: "start", width: 260 }), cell: ({ row }) => (
      <span><strong>{name(row.original)}</strong><Text variant="text-micro" tone="muted" as="div" className="aurora-number">{row.original.id.slice(0, 8)} · {new Date(row.original.run_at).toLocaleString()}</Text></span>) },
    { id: "objects", header: "Objects", cell: ({ row }) => Object.keys(row.original.dqs_summary ?? {}).map(formatModuleName).join(" · ") },
    { id: "checks", header: "Checks", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => checks(row.original).toLocaleString() },
    { id: "dqs", header: "DQS", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => compositeDqs(row.original.dqs_summary)?.toFixed(1) ?? "—" },
    { id: "when", header: "Run", meta: meta({ width: 110 }), cell: ({ row }) => relativeTime(row.original.run_at) },
    { id: "pdf", header: "", meta: meta({ width: 110 }), cell: ({ row }) => (
      <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); download.mutate({ v: row.original, kind: "pdf" }); }} disabled={download.isPending}>PDF</Button>) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [download.isPending]);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Reports" value={versions.length} />
        <Stat label="This week" value={week} />
        <Stat label="Latest DQS" value={latestDqs?.toFixed(1) ?? "—"} tone={latestDqs === null ? "neutral" : latestDqs >= 90 ? "success" : latestDqs >= 70 ? "warning" : "danger"} />
        <Stat label="Latest run" value={latest ? relativeTime(latest.run_at) : "—"} />
      </KpiRail>
      {latest ? (
        <Banner tone="info" title={`Latest report: ${name(latest)} · DQS ${latestDqs?.toFixed(1) ?? "—"}`}
          action={<Button size="sm" onClick={() => download.mutate({ v: latest, kind: "pdf" })} disabled={download.isPending}>Download PDF</Button>}>
          {checks(latest).toLocaleString()} checks over {Object.keys(latest.dqs_summary ?? {}).length} object{Object.keys(latest.dqs_summary ?? {}).length === 1 ? "" : "s"}. Open a row for the JSON export and the config workbook.
        </Banner>
      ) : null}
      {q.isLoading ? <Text tone="muted">Reading completed analyses.</Text>
        : q.error ? <Banner tone="danger" title="Analyses could not be read">{(q.error as Error).message}</Banner>
        : versions.length ? <DataTable columns={columns} data={versions} getRowId={(v) => v.id} onRowActivate={(v) => drawer.open(v.id)} ariaLabel="Reports" maxHeight="60vh" />
        : <EmptyState title="No reports yet." body="A report is generated when an analysis completes. Import a file or download objects from a system to run one." />}
      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Report details" header={selected ? <Text variant="text-lead">{name(selected)}</Text> : null}>
        {selected ? (
          <Stack gap={4}>
            <table className="aurora-exec__table"><tbody>
              {([["Version", selected.id.slice(0, 8)], ["Run", new Date(selected.run_at).toLocaleString()], ["Status", selected.status.replace(/_/g, " ")],
                ["Checks", checks(selected).toLocaleString()], ["DQS", compositeDqs(selected.dqs_summary)?.toFixed(1) ?? "—"]] as [string, string][])
                .map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}
            </tbody></table>
            <Stack gap={2}>
              <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Objects</Text>
              <Stack direction="row" gap={1} wrap>
                {Object.entries(selected.dqs_summary ?? {}).map(([m, s]) => <Chip key={m} tone={s.capped ? "warning" : "neutral"}>{formatModuleName(m)} · {s.composite_score.toFixed(1)}</Chip>)}
              </Stack>
            </Stack>
            <Stack direction="row" gap={2} wrap>
              {(Object.keys(FILE) as Kind[]).filter((k) => k !== "extraction" || selected.metadata?.source === "extraction").map((k) => (
                <Button key={k} variant={k === "pdf" ? "primary" : "secondary"} onClick={() => download.mutate({ v: selected, kind: k })} disabled={download.isPending}>{FILE[k].label}</Button>
              ))}
              <Button variant="ghost" onClick={() => copyToClipboard(selected.id, "Version ID copied")}>Copy version ID</Button>
            </Stack>
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}

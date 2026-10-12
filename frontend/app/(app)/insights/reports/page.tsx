"use client";

/** Insights › Reports: every PDF and JSON report the platform renders, for one chosen run. */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, Select } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import {
  getAnalysisReportUrl, getCleaningReportUrl, getComparisonReportUrl, getExecutiveReportUrl, getExtractionReportUrl,
  getReportDownloadUrl, getReportJsonExportUrl,
} from "@/lib/api/reports";
import { formatDate } from "@/lib/format";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { usePermissions } from "@/lib/permissions";
import { MeridianMark } from "@/components/meridian/icons";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";

interface ReportRow {
  id: string;
  name: string;
  about: string;
  format: "PDF" | "JSON";
  /** null: the report needs an object or record, so it is opened from there. */
  url: ((versionId: string) => string) | null;
  file: string;
}

const REPORTS: ReportRow[] = [
  { id: "executive", name: "Executive summary", about: "Readiness, value at risk and owners for the run.", format: "PDF", url: getExecutiveReportUrl, file: "executive.pdf" },
  { id: "analysis", name: "Analysis report", about: "Scores, findings and rule results.", format: "PDF", url: getAnalysisReportUrl, file: "analysis.pdf" },
  { id: "extraction", name: "Extraction report", about: "Tables read from the source system and their coverage.", format: "PDF", url: getExtractionReportUrl, file: "extraction.pdf" },
  { id: "cleaning", name: "Cleaning and fixes", about: "Cleaning work across the organisation for this run.", format: "PDF", url: (v) => getCleaningReportUrl(v), file: "cleaning.pdf" },
  { id: "compare", name: "Run comparison", about: "This run against the baseline or previous run.", format: "PDF", url: (v) => getComparisonReportUrl(v), file: "compare.pdf" },
  { id: "full", name: "Full report", about: "The stored run report.", format: "PDF", url: getReportDownloadUrl, file: "report.pdf" },
  { id: "json", name: "Run data", about: "Run results as JSON.", format: "JSON", url: getReportJsonExportUrl, file: "report.json" },
  { id: "object", name: "Object report", about: "One object's rules and fields. Open it from the object page.", format: "PDF", url: null, file: "" },
  { id: "record", name: "Record fix sheet", about: "One record's fixes. Open it from the record page.", format: "PDF", url: null, file: "" },
];

export default function ReportsPage() {
  const { can } = usePermissions();
  const [picked, setPicked] = useState("");
  const versions = useQuery({ queryKey: ["versions", "reports"], queryFn: () => getVersions({ limit: 25 }) });
  const runs = (versions.data?.versions ?? []).filter((v) => v.status === "complete" || v.status === "agents_complete" || v.status === "ai_enriched");
  const versionId = picked || runs[0]?.id || "";

  const columns: ColumnDef<ReportRow>[] = [
    {
      id: "cover", header: "", enableSorting: false,
      cell: () => <span aria-hidden className="m-report-cover flex items-center justify-center" style={{ width: 56, height: 40 }}><MeridianMark size={20} variant="mono" /></span>,
    },
    { accessorKey: "name", header: "Report" },
    { accessorKey: "about", header: "What it covers" },
    { accessorKey: "format", header: "Format" },
    {
      id: "get",
      header: "",
      cell: ({ row }) => {
        const r = row.original;
        if (r.url && !can("export")) return <span className="m-text-body" style={{ color: "var(--m-ink-3)" }}>Export needs the auditor or analyst role</span>;
        return r.url ? (
          <Button variant="secondary" onClick={() => void downloadAuthenticated(r.url!(versionId), `${r.id}_${versionId}.${r.format.toLowerCase()}`)}>Download</Button>
        ) : (
          <Button variant="secondary" render={<Link href="/objects">Open objects</Link>} />
        );
      },
    },
  ];

  return (
    <InsightFrame
      title="Reports"
      meta="Latest completed runs"
      skeleton={<CardSkeleton height={300} />}
      insight={{
        situation: { sentence: `${REPORTS.filter((x) => x.url).length} of ${REPORTS.length} reports can be downloaded for a run, ${runs.length} completed ${runs.length === 1 ? "run is" : "runs are"} available. Reports are rendered from the run you choose.`, tone: runs.length ? "go" : "at-risk" },
        changed: { sentence: "—" },
        why: { sentence: `${REPORTS.length - REPORTS.filter((x) => x.url).length} reports open from an object or record page instead.` },
        next: can("export") && versionId
          ? { sentence: "Download the executive summary for the chosen run.", action: { label: "Download executive summary", onClick: () => void downloadAuthenticated(getExecutiveReportUrl(versionId), `executive_${versionId}.pdf`) } }
          : { sentence: "Export needs the auditor or analyst role.", action: { label: "Open runs", href: "/runs" } },
      }}
      actions={
        <Select
          label="Analysis run"
          value={versionId}
          onValueChange={setPicked}
          placeholder="Choose a run"
          options={runs.map((v) => ({ value: v.id, label: v.label || formatDate(v.run_at, "datetime") }))}
        />
      }
      state={versions.isLoading ? "loading" : isListFailure(versions) ? "error" : runs.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No completed run yet",
        detail: "Reports are rendered from a finished run.",
        ghost: "table",
        action: <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />,
      }}
      errorProps={{ message: apiErrorMessage(versions.error), onRetry: () => void versions.refetch() }}
    >
      <Card title="Available reports">
        <DataTable columns={columns} data={REPORTS} getRowId={(r) => r.id} hideToolbar dense height="auto" />
      </Card>
    </InsightFrame>
  );
}

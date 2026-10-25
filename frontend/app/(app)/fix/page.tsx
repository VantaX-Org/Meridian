"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, ExportMenu, FilterChip, PageHeader, Stat, Tabs, emptyExportOptions, type CellMeta } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadCleaningExport, getCleaningGroups, type CleaningGroup } from "@/lib/api/cleaning";
import { KindLabel, groupHref, kindText } from "@/components/fix/kind";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, formatModuleName } from "@/lib/format";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { HIGH_CONFIDENCE_LABEL } from "@/lib/api/remediation";
import { BatchesTab } from "./batches-tab";
import { DedupTab } from "./monitor-dedup-tabs";
import { MonitorTab } from "./monitor-tab";
import { FixWork } from "@/components/work/fix-work";

const runLabel = (g: CleaningGroup) => (g.version_id ? g.run_label ?? (g.run_at ? formatDate(g.run_at, "datetime") : "Run") : "Matching");

const columns: ColumnDef<CleaningGroup>[] = [
  { id: "object", accessorFn: (r) => formatModuleName(r.object_type), header: "Object" },
  {
    id: "kind",
    header: "What it fixes",
    accessorFn: (r) => kindText(r.kind, r.rule_name),
    cell: ({ row }) => <KindLabel kind={row.original.kind} ruleName={row.original.rule_name} />,
  },
  { id: "records", accessorFn: (r) => r.records, header: "Records", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => row.original.records.toLocaleString() },
  { id: "confidence", accessorFn: (r) => r.avg_confidence, header: "Confidence", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => `${Math.round(row.original.avg_confidence * 100)}%` },
  { id: "confident", accessorFn: (r) => r.confident, header: `At ${HIGH_CONFIDENCE_LABEL}`, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => row.original.confident.toLocaleString() },
  { id: "run", accessorFn: (r) => r.run_at ?? "", header: "Found by run", cell: ({ row }) => runLabel(row.original) },
  {
    id: "action",
    header: "",
    size: 90,
    enableSorting: false,
    cell: ({ row }) => (
      <span onClick={(e) => e.stopPropagation()}>
        <Link href={groupHref(row.original)} aria-label={`Review ${kindText(row.original.kind, row.original.rule_name)} from ${runLabel(row.original)}`} className="m-ink-accent">Review</Link>
      </span>
    ),
  },
];

function CleaningQueueTab() {
  const router = useRouter();
  const dayOne = useDayOne();
  // `?module=` narrows the queue to one object (the object workbench and Home link here with it).
  const [module, setModule] = useUrlState("module", "");
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ["cleaning", "groups"], queryFn: getCleaningGroups });
  // The chosen run (scope bar): its proposals, plus the matcher's, which carry no run.
  const run = useSearchParams()?.get("run");
  const all = (data?.groups ?? []).filter((g) => !run || !g.version_id || g.version_id === run);
  const rows = module ? all.filter((g) => g.object_type === module) : all;
  const narrowed = Boolean(run || module);
  const records = narrowed ? rows.reduce((n, g) => n + g.records, 0) : data?.records ?? 0;
  const confident = narrowed ? rows.reduce((n, g) => n + g.confident, 0) : data?.confident ?? 0;
  const runs = narrowed ? new Set(rows.map((g) => g.version_id).filter(Boolean)).size : data?.runs ?? 0;
  // These call downloadCleaningExport, a plain cleaning-queue export of approved fixes, not a
  // mass-change template; the four-eyes export lives on the Batches tab.
  const exportOptions = [
    { format: "xlsx" as const, label: "Approved fixes (.xlsx)", run: () => downloadCleaningExport("xlsx", "approved") },
    { format: "csv" as const, label: "Approved fixes (.csv)", run: () => downloadCleaningExport("csv", "approved") },
  ];

  return (
    <ExplorerPage
      state={isLoading ? "loading" : isListFailure({ isError, error }) ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={module && all.length > 0 ? {
        title: `No cleaning proposals for ${formatModuleName(module)}`,
        detail: "Other objects have proposals waiting.",
        action: <Button variant="secondary" onClick={() => setModule("")}>Show every object</Button>,
      } : {
        title: "No cleaning proposals",
        detail: dayOne.step?.detail ?? "When a run finds values a rule can correct, the proposals land here.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />,
      }}
      filterBar={module ? <FilterChip label="Object" value={formatModuleName(module)} onRemove={() => setModule("")} /> : undefined}
      errorProps={{ message: apiErrorMessage(error), onRetry: refetch }}
      toolbarEnd={<ExportMenu options={rows.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} />}
      summary={data && rows.length > 0 ? (
        <div className="m-stat-grid @5xl:[grid-template-columns:repeat(2,minmax(0,360px))]">
          <Stat label="Records with a proposal" value={records.toLocaleString()} hint={`${rows.length.toLocaleString()} group${rows.length === 1 ? "" : "s"} across ${runs.toLocaleString()} run${runs === 1 ? "" : "s"}`} />
          <Stat label={`At ${HIGH_CONFIDENCE_LABEL}`} value={confident.toLocaleString()} tone={confident > 0 ? "go" : undefined} hint="ready to accept in one step" />
        </div>
      ) : undefined}
      table={
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => `${row.version_id}/${row.object_type}/${row.kind}`}
          onRowClick={(row) => router.push(groupHref(row))}
        />
      }
    />
  );
}

export default function FixPage() {
  const [tabRaw, setTab] = useUrlState("tab", "work");
  const tab = oneOf(tabRaw, ["work", "cleaning", "batches", "monitor", "dedup"], "work");

  return (
    <div className="flex flex-col gap-4">
    <PageHeader
      title="Fix"
      meta="Every record that fails a check, worst first: see what is wrong, set the right value, and send it for approval."
      actions={<Button variant="secondary" render={<Link href="/fix/what-if">What-if</Link>} />}
    />
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "work", label: "Records to fix", content: <FixWork /> },
        { value: "cleaning", label: "Cleaning proposals", content: <CleaningQueueTab /> },
        { value: "batches", label: "Approvals and export", content: <BatchesTab /> },
        { value: "monitor", label: "Monitor", content: <MonitorTab /> },
        { value: "dedup", label: "Duplicates", content: <DedupTab /> },
      ]}
    />
    </div>
  );
}

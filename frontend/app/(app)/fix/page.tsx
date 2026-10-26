"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import type { ComponentType } from "react";
import { Button, DataTable, ExplorerPage, ExportMenu, FilterChip, PageHeader, Select, Stat, Tabs, emptyExportOptions, type CellMeta } from "@/design";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { downloadCleaningExport, getCleaningGroups, type CleaningGroup } from "@/lib/api/cleaning";
import { KindLabel, groupHref, kindText } from "@/components/fix/kind";
import { isListFailure } from "@/lib/error";
import { formatDate, formatModuleName } from "@/lib/format";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { HIGH_CONFIDENCE_LABEL } from "@/lib/api/remediation";
import { BatchesTab } from "./batches-tab";
import { DedupTab } from "./monitor-dedup-tabs";
import { MonitorTab } from "./monitor-tab";
import { FixWork } from "@/components/work/fix-work";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { useRole } from "@/hooks/use-role";
import { approvesOnly } from "@/lib/persona";
import { personaForRole } from "@/lib/persona";

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
      errorProps={{ error: error, onRetry: refetch }}
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

const TABS: { value: string; label: string; Content: ComponentType }[] = [
  { value: "work", label: "Records to fix", Content: FixWork },
  { value: "cleaning", label: "Cleaning proposals", Content: CleaningQueueTab },
  // Approving is done in Inbox › Approvals (the one approvals page); this tab keeps the batches and their export.
  { value: "batches", label: "Batches and export", Content: BatchesTab },
  { value: "monitor", label: "Monitor", Content: MonitorTab },
];
/** Old tab names that now live elsewhere: duplicate pairs are reviewed in MDM › Match review (DedupTab redirects). */
const MOVED_TABS = ["dedup", "duplicates"];

export default function FixPage() {
  // An approver who may not apply has every control disabled on "Records to fix", so the nav entry
  // used to drop them on a dead screen. Land them where their work is, unless the URL says otherwise.
  const { can, homeRole } = useRole();
  const approverOnly = approvesOnly(can);
  const [tabRaw, setTab] = useUrlState("tab", approverOnly ? "batches" : "work");
  const tab = oneOf(tabRaw, TABS.map((t) => t.value), "work");
  // Stewards land here rather than on a persona home (lib/persona.ts homeHrefForRole), so the first-run offer is here too.
  const steward = !!homeRole && personaForRole(homeRole) === "steward";
  if (MOVED_TABS.includes(tabRaw)) return <DedupTab />;

  return (
    <div className="flex flex-col gap-4">
    <PageHeader
      title="Fix work"
      meta="Every record that fails a check, worst first: see what is wrong, set the right value, and send it for approval."
      actions={<Button variant="secondary" render={<Link href="/fix/what-if">What-if</Link>} />}
    />
    {steward && <HomeOnboarding />}
    {/* Below 640px the four tabs would wrap: a Select picks the section and the tab strip steps aside. */}
    <div className="sm:hidden">
      <Select label="Section" value={tab} onValueChange={setTab} options={TABS.map(({ value, label }) => ({ value, label }))}
        className="m-input inline-flex w-full items-center justify-between gap-2" />
    </div>
    <div className="max-[639px]:[&_.m-tabs-list]:hidden">
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={TABS.map(({ value, label, Content }) => ({ value, label, content: <Content /> }))}
      />
    </div>
    </div>
  );
}

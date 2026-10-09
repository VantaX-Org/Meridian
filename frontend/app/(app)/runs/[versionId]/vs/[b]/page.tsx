// frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Bar,
  Button,
  DataTable,
  Delta,
  EmptyState,
  ErrorState,
  Mono,
  Pager,
  Pill,
  ReportPage,
  Skeleton,
  Sparkline,
  Stat,
  Waterfall,
  type ChartPoint,
  type PillTone,
} from "@/design";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { downloadAuthenticated } from "@/lib/api/download";
import { createBatch, errorText } from "@/lib/api/remediation";
import { getComparisonReportUrl } from "@/lib/api/reports";
import { compareRecordKeys, compareRecords, compareVersions, type RecordDiffCheck } from "@/lib/api/versions";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { compareNarrative } from "@/lib/narrative";
import { queryKeys } from "@/lib/query-keys";
import type { CheckChange, Version } from "@/types/api";

const KEYS_PAGE_SIZE = 25;
const nf = new Intl.NumberFormat("en-ZA");
const round1 = (n: number) => Math.round(n * 10) / 10;
const runLabel = (v: Version) => v.label ?? formatDate(v.run_at, "date");

function severityTone(severity: string): PillTone {
  if (severity === "critical" || severity === "high") return "no-go";
  if (severity === "medium") return "at-risk";
  return "neutral";
}

const diffColumns: ColumnDef<RecordDiffCheck>[] = [
  { accessorKey: "check_id", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
  { accessorKey: "severity", header: "Severity" },
  { accessorKey: "new", header: "New" },
  { accessorKey: "resolved", header: "Resolved" },
  { accessorKey: "persisting", header: "Persisting" },
  {
    id: "trend",
    header: "Trend",
    enableSorting: false,
    cell: ({ row }) => {
      const c = row.original;
      const points: ChartPoint[] = [
        { x: "before", y: c.persisting + c.resolved },
        { x: "after", y: c.persisting + c.new },
      ];
      return <Sparkline data={points} />;
    },
  },
];

function CheckList({
  title,
  rows,
  count,
  onOpen,
  action,
  bulk,
}: {
  title: string;
  rows: CheckChange[];
  count: (c: CheckChange) => number;
  onOpen: (checkId: string) => void;
  action?: (c: CheckChange) => ReactNode;
  bulk?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium" style={{ color: "var(--m-ink-2)" }}>
          {title}
        </h3>
        {bulk}
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          None
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((c) => (
            <li key={c.check_id} className="flex items-center gap-2 text-[13px]">
              <button type="button" className="flex items-center gap-2" onClick={() => onOpen(c.check_id)}>
                <Mono>{c.check_id}</Mono>
                <Pill tone={severityTone(c.severity)}>{labelOf(c.severity)}</Pill>
                <span className="tabular-nums">{nf.format(count(c))} records</span>
              </button>
              {action?.(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CompareRunsPage() {
  const { versionId, b } = useParams<{ versionId: string; b: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [module, setModule] = useUrlState("module");
  const [checkId, setCheckId] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState("");
  const [keyPage, setKeyPage] = useState(1);

  const v1Param = b === "baseline" ? undefined : b;
  const moduleParam = module || undefined;

  const cmpQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "modules", module],
    queryFn: () => compareVersions(v1Param, versionId, moduleParam),
  });
  const diffQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "records", module],
    queryFn: () => compareRecords(versionId, v1Param, moduleParam),
  });

  const resolvedV1 = diffQ.data?.v1;
  const keysQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "keys", checkId, "new"],
    queryFn: () => compareRecordKeys(checkId ?? "", { v1: resolvedV1 ?? "", v2: versionId, change: "new" }),
    enabled: checkId !== null && resolvedV1 !== undefined,
  });

  const cmp = cmpQ.data;
  const diff = diffQ.data ?? null;
  const v2Label = cmp ? runLabel(cmp.v2) : versionId;

  const create = useMutation({
    mutationFn: (c: CheckChange) =>
      createBatch(`Regressions ${c.check_id} ${v2Label}`, { version_id: versionId, check_id: c.check_id, module: c.module }),
    onSuccess: () => {
      toast.success("Batch created", { action: { label: "Open batches", onClick: () => router.push("/fix?tab=batches") } });
      qc.invalidateQueries({ queryKey: queryKeys.remediationBatches() });
    },
    onError: (e: unknown) => toast.error(errorText(e)),
  });

  const sentences = useMemo(() => (cmp ? compareNarrative(cmp, diff) : []), [cmp, diff]);

  const selectCheck = (id: string) => {
    setCheckId(id);
    setKeyFilter("");
    setKeyPage(1);
  };

  const filteredKeys = useMemo(() => {
    const keys = keysQ.data?.record_keys ?? [];
    const needle = keyFilter.trim().toLowerCase();
    return needle ? keys.filter((k) => k.toLowerCase().includes(needle)) : keys;
  }, [keysQ.data, keyFilter]);
  const keyPageCount = Math.max(1, Math.ceil(filteredKeys.length / KEYS_PAGE_SIZE));
  const pageKeys = filteredKeys.slice((keyPage - 1) * KEYS_PAGE_SIZE, keyPage * KEYS_PAGE_SIZE);

  const loading = cmpQ.isLoading || diffQ.isLoading;
  const errored = cmpQ.isError || diffQ.isError;
  const empty = !!cmp && !!diff && Object.keys(cmp.delta).length === 0 && diff.checks.length === 0;
  const state: "loading" | "error" | "empty" | undefined = loading ? "loading" : errored ? "error" : empty ? "empty" : undefined;

  const onDownload = () =>
    downloadAuthenticated(getComparisonReportUrl(versionId, v1Param), "comparison.pdf").catch((e: unknown) => toast.error(errorText(e)));

  const narrative = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{cmp ? `${runLabel(cmp.v2)} vs ${runLabel(cmp.v1)}` : "Comparing runs…"}</h2>
        {b === "baseline" ? <Pill tone="go">Baseline</Pill> : null}
        <Button variant="secondary" onClick={onDownload}>
          Download PDF
        </Button>
        <label className="flex items-center gap-1 text-[13px]">
          <span>Module</span>
          <select
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="rounded border px-2 py-1"
            style={{ borderColor: "var(--m-line)" }}
          >
            <option value="">All modules</option>
            {Object.keys(cmp?.delta ?? {}).map((m) => (
              <option key={m} value={m}>
                {formatModuleName(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sentences.map((s) => (
        <p key={s}>{s}</p>
      ))}
    </div>
  );

  const charts = cmp ? (
    <div className="flex flex-col gap-4">
      {Object.entries(cmp.delta).map(([name, d]) => {
        const failing = cmp.checks.newly_failing.filter((c) => c.module === name);
        const fixed = cmp.checks.fixed.filter((c) => c.module === name);
        const canFix = can("apply");
        const barData: ChartPoint[] = Object.entries(d.dimensions)
          .filter(([, dim]) => dim.change !== null)
          .map(([dim, x]) => ({ x: dim, y: round1(x.change as number), dimension: dim }));
        return (
          <section
            key={name}
            aria-label={formatModuleName(name)}
            className="flex flex-col gap-3 rounded border p-3"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
          >
            <h2 className="text-[15px] font-semibold">{formatModuleName(name)}</h2>
            <div className="flex gap-6">
              <Stat label="Before" value={<span className="tabular-nums">{d.v1_score.toFixed(1)}</span>} />
              <Stat label="After" value={<span className="tabular-nums">{d.v2_score.toFixed(1)}</span>} />
              <Stat label="Change" value={<Delta value={round1(d.dqs_change)} />} />
            </div>
            <Bar data={barData} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <CheckList
                title="Newly failing"
                rows={failing}
                count={(c) => c.v2_affected}
                onOpen={selectCheck}
                action={
                  canFix
                    ? (c) => (
                        <Button variant="ghost" disabled={create.isPending} onClick={() => create.mutate(c)}>
                          Create fix batch
                        </Button>
                      )
                    : undefined
                }
                bulk={
                  canFix && failing.length > 0 ? (
                    <Button
                      variant="ghost"
                      disabled={create.isPending}
                      onClick={async () => {
                        for (const c of failing) await create.mutateAsync(c).catch(() => undefined);
                      }}
                    >
                      Create fix batches
                    </Button>
                  ) : undefined
                }
              />
              <CheckList title="Fixed" rows={fixed} count={(c) => c.v1_affected} onOpen={selectCheck} />
            </div>
          </section>
        );
      })}
    </div>
  ) : null;

  const waterfallData: ChartPoint[] = diff
    ? [
        { x: "Resolved", y: -diff.totals.resolved },
        { x: "New", y: diff.totals.new },
        { x: "Persisting", y: diff.totals.persisting },
      ]
    : [];

  const tables = diff ? (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={diffColumns}
        data={diff.checks}
        getRowId={(c) => c.check_id}
        onRowClick={(c) => selectCheck(c.check_id)}
        height={360}
      />
      <Waterfall data={waterfallData} />
      {checkId && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>
            New record keys for <Mono>{checkId}</Mono>
          </p>
          {keysQ.isLoading && <Skeleton height={80} />}
          {keysQ.isError && (
            <ErrorState message={`Couldn't load the new record keys for this check. ${keysQ.error.message}`} onRetry={() => keysQ.refetch()} />
          )}
          {keysQ.data && keysQ.data.record_keys.length === 0 && <EmptyState title="No new record keys for this check." />}
          {keysQ.data && keysQ.data.record_keys.length > 0 && (
            <>
              <input
                type="search"
                aria-label="Filter record keys"
                placeholder="Filter record keys"
                value={keyFilter}
                onChange={(e) => {
                  setKeyFilter(e.target.value);
                  setKeyPage(1);
                }}
                className="h-8 rounded border px-2 text-[13px]"
                style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
              />
              <ul className="flex flex-col gap-1">
                {pageKeys.map((key) => (
                  <li key={key}>
                    <Mono>{key}</Mono>
                  </li>
                ))}
              </ul>
              <Pager page={keyPage} pageCount={keyPageCount} onPageChange={setKeyPage} />
            </>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <ReportPage
      narrative={narrative}
      charts={charts}
      tables={tables}
      state={state}
      emptyProps={{ title: "No differences. These two runs have identical results." }}
      errorProps={{
        message: `Couldn't compare these runs. ${cmpQ.error?.message ?? diffQ.error?.message ?? ""}`.trim(),
        onRetry: () => {
          cmpQ.refetch();
          diffQ.refetch();
        },
      }}
    />
  );
}

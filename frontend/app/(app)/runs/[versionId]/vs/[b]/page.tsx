// frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import {
  Button,
  DataTable,
  Delta,
  EmptyState,
  ErrorState,
  ExportMenu,
  Mono,
  Pager,
  Pill,
  ReportPage,
  Select,
  Skeleton,
  Stat,
  type SelectOption,
  PageHeader,
} from "@/design";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { downloadAuthenticated } from "@/lib/api/download";
import { createBatch, errorText } from "@/lib/api/remediation";
import { getComparisonReportUrl } from "@/lib/api/reports";
import { compareRecordKeys, compareRecords, compareVersions } from "@/lib/api/versions";
import { formatDate, formatModuleName, roundedDelta } from "@/lib/format";
import { compareNarrative } from "@/lib/narrative";
import { queryKeys } from "@/lib/query-keys";
import type { CheckChange, Version } from "@/types/api";

const KEYS_LIMIT = 50;
const nf = new Intl.NumberFormat("en-ZA");
const runLabel = (v: Version) => v.label ?? formatDate(v.run_at, "date");
const change = (c: CheckChange) => c.v2_affected - c.v1_affected;

const columns: ColumnDef<CheckChange>[] = [
  { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
  { id: "module", header: "Object", accessorFn: (c) => formatModuleName(c.module) },
  { id: "before", header: "Records before", accessorFn: (c) => c.v1_affected, cell: ({ row }) => nf.format(row.original.v1_affected) },
  { id: "after", header: "Records after", accessorFn: (c) => c.v2_affected, cell: ({ row }) => nf.format(row.original.v2_affected) },
  {
    id: "delta",
    header: "Change",
    accessorFn: change,
    cell: ({ row }) => {
      const d = change(row.original);
      return <span className="tabular-nums">{d > 0 ? "+" : ""}{nf.format(d)}</span>;
    },
  },
];

function RuleDrawer({ rule, versionId, v1, canFix }: { rule: CheckChange; versionId: string; v1: string | undefined; canFix: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const regressed = change(rule) > 0;
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(filter, 300);
  const keys = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, v1 ?? "baseline"), "keys", rule.check_id, search, page],
    queryFn: () =>
      compareRecordKeys(rule.check_id, {
        v1: v1 ?? "", v2: versionId, change: "new", search: search || undefined, limit: KEYS_LIMIT, offset: (page - 1) * KEYS_LIMIT,
      }),
    enabled: regressed && v1 !== undefined,
  });
  const create = useMutation({
    mutationFn: () => createBatch(`Regressions ${rule.check_id}`, { version_id: versionId, check_id: rule.check_id, module: rule.module }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.remediationBatches() });
      toast.success("Batch created", { action: { label: "Open batches", onClick: () => router.push("/fix?tab=batches") } });
    },
    onError: (e: unknown) => toast.error(errorText(e)),
  });
  const list = keys.data?.record_keys ?? [];
  // The server pages; a full page means there may be another.
  const pageCount = page + (list.length === KEYS_LIMIT ? 1 : 0);

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="font-semibold" style={{ fontSize: "var(--m-text-title)", lineHeight: "var(--m-leading-title)" }}>
        <Mono>{rule.check_id}</Mono>
      </h2>
      <Pill tone={regressed ? "no-go" : "neutral"}>{regressed ? "Newly failing" : "Fixed"}</Pill>
      {regressed ? (
        <>
          <p style={{ color: "var(--m-ink-2)" }}>Records that newly fail</p>
          <input
            type="search"
            aria-label="Filter record keys"
            placeholder="Filter record keys"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            className="h-8 rounded border px-2"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
          />
          {keys.isLoading ? <Skeleton height={120} /> : null}
          {keys.isError ? <ErrorState message={errorText(keys.error)} onRetry={() => keys.refetch()} /> : null}
          {keys.data && list.length === 0 ? <EmptyState title={search ? "No records match" : "No new records"} detail={search ? "Try a different filter." : "Nothing newly fails for this rule."} /> : null}
          <ul className="flex flex-col gap-1">
            {list.map((k) => (
              <li key={k}><Mono>{k}</Mono></li>
            ))}
          </ul>
          {list.length > 0 ? <Pager page={page} pageCount={pageCount} onPageChange={setPage} /> : null}
          {canFix ? (
            <Button disabled={create.isPending} onClick={() => create.mutate()}>Create fix batch</Button>
          ) : null}
        </>
      ) : (
        <p style={{ color: "var(--m-ink-2)" }}>{nf.format(rule.v1_affected)} records failed before; none fail now.</p>
      )}
    </div>
  );
}

export default function CompareRunsPage() {
  const { versionId, b } = useParams<{ versionId: string; b: string }>();
  const { can } = useRole();
  const [module, setModule] = useUrlState("module");
  const v1Param = b === "baseline" ? undefined : b;
  const moduleParam = module || undefined;

  const cmpQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "modules", moduleParam],
    queryFn: () => compareVersions(v1Param, versionId, moduleParam),
  });
  // Module options come from the unfiltered comparison; shares cache with cmpQ when no module is chosen.
  const allModulesQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "modules", undefined],
    queryFn: () => compareVersions(v1Param, versionId, undefined),
  });
  const diffQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "records", module],
    queryFn: () => compareRecords(versionId, v1Param, moduleParam),
  });

  const qc = useQueryClient();
  const bulk = useMutation({
    mutationFn: async (selected: CheckChange[]) => {
      let ok = 0;
      for (const c of selected) {
        await createBatch(`Regressions ${c.check_id}`, { version_id: versionId, check_id: c.check_id, module: c.module }).then(
          () => { ok += 1; },
          () => undefined,
        );
      }
      return ok;
    },
    onSuccess: (ok, selected) => {
      qc.invalidateQueries({ queryKey: queryKeys.remediationBatches() });
      toast.success(`Created ${ok} of ${selected.length} fix batches`);
      if (ok < selected.length) toast.error(`${selected.length - ok} fix batch${selected.length - ok === 1 ? "" : "es"} failed to create`);
    },
  });

  const cmp = cmpQ.data;
  const diff = diffQ.data ?? null;
  const sentences = useMemo(() => (cmp ? compareNarrative(cmp, diff) : []), [cmp, diff]);
  const rows = useMemo(
    () => (cmp ? [...cmp.checks.newly_failing, ...cmp.checks.fixed].sort((x, y) => change(y) - change(x)) : []),
    [cmp],
  );

  const moduleOptions: SelectOption[] = Object.keys(allModulesQ.data?.delta ?? cmp?.delta ?? {}).map((m) => ({
    value: m,
    label: formatModuleName(m),
  }));

  const notFound =
    (isAxiosError(cmpQ.error) && cmpQ.error.response?.status === 404) ||
    (isAxiosError(diffQ.error) && diffQ.error.response?.status === 404);
  if (notFound) {
    return (
      <EmptyState
        title="No earlier run to compare"
        detail="Comparison needs two finished runs of the same system."
        action={<Button render={<Link href="/runs">All runs</Link>} />}
      />
    );
  }

  const loading = cmpQ.isLoading || diffQ.isLoading;
  const errored = cmpQ.isError || diffQ.isError;
  const deltas = cmp ? Object.values(cmp.delta) : [];
  const empty = !!cmp && !!diff && deltas.length === 0 && diff.checks.length === 0;
  const state: "loading" | "error" | "empty" | undefined = loading ? "loading" : errored ? "error" : empty ? "empty" : undefined;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  const before = mean(deltas.map((d) => d.v1_score));
  const after = mean(deltas.map((d) => d.v2_score));

  const header = cmp ? (
    <PageHeader
      title={`${runLabel(cmp.v2)} vs ${runLabel(cmp.v1)}`}
      meta={`${formatDate(cmp.v2.run_at, "datetime")} and ${formatDate(cmp.v1.run_at, "datetime")}`}
      status={b === "baseline" ? <Pill>Baseline</Pill> : undefined}
    />
  ) : (
    <Skeleton height={48} />
  );

  const narrative = (
    <div className="flex flex-col gap-2">
      <Select label="Object" value={module} onValueChange={setModule} options={moduleOptions} placeholder="All objects" />
      {sentences.map((s) => (
        <p key={s}>{s}</p>
      ))}
    </div>
  );

  const charts = cmp ? (
    <div className="grid grid-cols-3 gap-3">
      <Stat label={`DQS ${runLabel(cmp.v1)}`} value={<span className="tabular-nums">{before.toFixed(1)}</span>} />
      <Stat label={`DQS ${runLabel(cmp.v2)}`} value={<span className="tabular-nums">{after.toFixed(1)}</span>} />
      <Stat label="Change" value={<Delta value={roundedDelta(before, after)} />} />
    </div>
  ) : null;

  const tables = cmp ? (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(c) => c.check_id}
      bulkActions={
        can("apply")
          ? (selected) => {
              const failing = selected.filter((c) => change(c) > 0);
              return failing.length > 0 ? (
                <Button disabled={bulk.isPending} onClick={() => bulk.mutate(failing)}>Create fix batches</Button>
              ) : null;
            }
          : undefined
      }
      renderDrawer={(c) => <RuleDrawer rule={c} versionId={versionId} v1={diff?.v1 ?? v1Param} canFix={can("apply")} />}
    />
  ) : null;

  return (
    <ReportPage
      header={header}
      narrative={narrative}
      exportMenu={
        cmp && can("export") ? (
          <ExportMenu
            options={[{ format: "pdf" as const, run: () => downloadAuthenticated(getComparisonReportUrl(versionId, v1Param), "comparison.pdf") }]}
          />
        ) : undefined
      }
      charts={charts}
      tables={tables}
      state={state}
      emptyProps={{ title: "No differences", detail: "These two runs have identical results." }}
      errorProps={{
        message: errorText(cmpQ.error ?? diffQ.error),
        onRetry: () => {
          cmpQ.refetch();
          diffQ.refetch();
        },
      }}
    />
  );
}

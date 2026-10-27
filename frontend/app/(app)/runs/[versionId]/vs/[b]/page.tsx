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
  buildDrillHref,
  Card,
  DataTable,
  type CellMeta,
  Delta,
  EmptyState,
  ErrorState,
  Field,
  ExportMenu,
  Input,
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
import { compareRecordKeys, compareRecords, compareVersions, type RecordDiffCheck } from "@/lib/api/versions";
import { formatModuleName, formatNumber, plural, roundedDelta } from "@/lib/format";
import { runName, runScopeLabel } from "@/lib/run-scope";
import { compareNarrative } from "@/lib/narrative";
import { queryKeys } from "@/lib/query-keys";
import { useRuleNames } from "@/lib/rule-name";
import { RuleCell } from "@/components/fix/rule-cell";
import { compareTimes } from "@/lib/run-axis";
import type { CheckChange, Version, VersionComparison } from "@/types/api";

const KEYS_LIMIT = 50;
const runLabel = (v: Version) => runScopeLabel(v);
const change = (c: CheckChange) => c.v2_affected - c.v1_affected;
/** One number format on the page, the viewer's locale (the narrative and the ledger agree). */
const fmtN = (n: number) => formatNumber(n);

/**
 * The four change sets of a comparison: a rule that flipped (newly failing, fixed) or that failed in both runs
 * with materially more or fewer records (worse, better; the API's threshold is 10% and 10 records).
 * `filter` is the `?change=` value that narrows the ledger to the set.
 */
type ChangeKind = "newly_failing" | "worse" | "better" | "fixed";
const CHANGE_SETS: { kind: ChangeKind; filter: string; label: string; tone: "no-go" | "at-risk" | "neutral" }[] = [
  { kind: "newly_failing", filter: "new", label: "Newly failing", tone: "no-go" },
  { kind: "worse", filter: "worse", label: "Worse", tone: "at-risk" },
  { kind: "better", filter: "better", label: "Better", tone: "neutral" },
  { kind: "fixed", filter: "resolved", label: "Fixed", tone: "neutral" },
];
type ChangeRow = CheckChange & { kind: ChangeKind };
const setOf = (kind: ChangeKind) => CHANGE_SETS.find((c) => c.kind === kind)!;

/** Every changed rule of a comparison, tagged with its set; `filter` keeps one set (the `?change=` value). */
function changeRows(cmp: VersionComparison, filter: string): ChangeRow[] {
  return CHANGE_SETS
    .filter((c) => !filter || c.filter === filter)
    .flatMap((c) => (cmp.checks[c.kind] ?? []).map((r) => ({ ...r, kind: c.kind })))
    .sort((x, y) => change(y) - change(x));
}

/** "Meridian run comparison – Run A vs Run B – 2026-10-25.pdf", without characters a file name cannot hold. */
function comparisonFilename(a: Version, b: Version, on: Date = new Date()): string {
  const day = `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, "0")}-${String(on.getDate()).padStart(2, "0")}`;
  // Characters Windows, macOS or Linux refuse in a file name (and control characters) become a hyphen.
  const clean = (t: string) =>
    [...t].map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? "-" : ch)).join("").replace(/-+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  return `Meridian run comparison – ${clean(runName(a))} vs ${clean(runName(b))} – ${day}.pdf`;
}

/** The rule cell of both ledgers: the shared RuleCell, its id opening the rule's failing records in `versionId`. */
const ruleCell = (checkId: string, module: string, versionId: string, message?: string | null) => (
  <RuleCell id={checkId} fallback={message} href={buildDrillHref({ object: module, ruleId: checkId, run: versionId })} />
);

/** Fixed widths for the figures, so a long rule name wraps in its own column and never pushes them off the card. */
const NUM = { size: 112, meta: { numeric: true } satisfies CellMeta };
/** A column a phone hides (below 640px): the rule, its change set and its change stay in view. */
const SECONDARY = { meta: { priority: "low" } satisfies CellMeta };

/**
 * The ledger's columns; the rule opens its failing records in this run (`versionId`, the newer of the two). The words
 * under the id come from the one precedence (lib/rule-name.ts): catalogue name, the rule's stored message, generated.
 */
const columnsFor = (versionId: string): ColumnDef<ChangeRow>[] => [
  {
    accessorKey: "check_id",
    header: "Rule",
    size: 440,
    cell: ({ row }) => ruleCell(row.original.check_id, row.original.module, versionId, row.original.message),
  },
  { id: "kind", header: "Change set", size: 128, accessorFn: (c) => setOf(c.kind).label, cell: ({ row }) => <Pill tone={setOf(row.original.kind).tone}>{setOf(row.original.kind).label}</Pill> },
  { id: "module", header: "Object", size: 160, ...SECONDARY, accessorFn: (c) => formatModuleName(c.module) },
  // Per rule: the records failing that one rule in each run (glossary "Failing records", for a single rule).
  { id: "before", header: "Failing records before", ...NUM, meta: { numeric: true, priority: "low" }, accessorFn: (c) => c.v1_affected, cell: ({ row }) => fmtN(row.original.v1_affected) },
  { id: "after", header: "Failing records after", ...NUM, meta: { numeric: true, priority: "low" }, accessorFn: (c) => c.v2_affected, cell: ({ row }) => fmtN(row.original.v2_affected) },
  {
    id: "delta",
    header: "Change",
    ...NUM,
    accessorFn: change,
    cell: ({ row }) => {
      const d = change(row.original);
      return <span className="tabular-nums whitespace-nowrap">{d > 0 ? "+" : ""}{fmtN(d)}</span>;
    },
  },
];

/**
 * The rules with new failures in the later run that the change sets above do not list, from the record diff, most
 * first. Most of the narrative's "new" rule failures sit on rules that fail in both runs with records churning (some
 * resolved, others newly failing), which the change sets (counts that flipped, or moved by 10% and 10 records) leave
 * out; the newly failing and worse rules are already rows of the ledger above.
 */
function worseRows(checks: readonly RecordDiffCheck[], listed: ReadonlySet<string>): RecordDiffCheck[] {
  return checks
    .filter((c) => c.comparable && c.new > 0 && !listed.has(`${c.module}:${c.check_id}`))
    .sort((a, b) => b.new - a.new || a.check_id.localeCompare(b.check_id));
}

const worseColumnsFor = (versionId: string): ColumnDef<RecordDiffCheck>[] => [
  {
    accessorKey: "check_id",
    header: "Rule",
    size: 440,
    cell: ({ row }) => ruleCell(row.original.check_id, row.original.module, versionId),
  },
  { id: "module", header: "Object", size: 160, ...SECONDARY, accessorFn: (c) => formatModuleName(c.module) },
  // Per rule: records failing it in the later run that did not before, those that no longer fail it, those failing it in both.
  { id: "new", header: "Newly failing records", ...NUM, accessorFn: (c) => c.new, cell: ({ row }) => fmtN(row.original.new) },
  { id: "resolved", header: "Records resolved", ...NUM, meta: { numeric: true, priority: "low" }, accessorFn: (c) => c.resolved, cell: ({ row }) => fmtN(row.original.resolved) },
  { id: "persisting", header: "Failing in both", ...NUM, meta: { numeric: true, priority: "low" }, accessorFn: (c) => c.persisting, cell: ({ row }) => fmtN(row.original.persisting) },
];

function RuleDrawer({ rule, versionId, v1, canFix, name }: { rule: ChangeRow; versionId: string; v1: string | undefined; canFix: boolean; name?: string }) {
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
      <h2 className="font-semibold m-text-title">
        <Mono>{rule.check_id}</Mono>
      </h2>
      {name ? <p className="m-ink">{name}</p> : null}
      {rule.message && rule.message !== name ? <p className="m-ink-2">{rule.message}</p> : null}
      <Pill tone={setOf(rule.kind).tone}>{setOf(rule.kind).label}</Pill>
      {regressed ? (
        <>
          <p className="m-ink-2">Records that newly fail</p>
          <Field label="Filter record keys">
            <Input
              type="search"
              placeholder="Filter record keys"
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(1); }}
            />
          </Field>
          {keys.isLoading ? <Skeleton height={120} /> : null}
          {keys.isError ? <ErrorState message={errorText(keys.error)} onRetry={() => keys.refetch()} /> : null}
          {keys.data && list.length === 0 ? <EmptyState title={search ? "No records match" : "No new records"} detail={search ? "Try a different filter." : "Nothing newly fails for this rule."} action={search ? <Button onClick={() => { setFilter(""); setPage(1); }}>Clear filter</Button> : <Button onClick={() => router.push("/runs")}>All runs</Button>} /> : null}
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
        <p className="m-ink-2">{fmtN(rule.v1_affected)} records failed before; {rule.v2_affected > 0 ? `${fmtN(rule.v2_affected)} fail now` : "none fail now"}.</p>
      )}
    </div>
  );
}

export default function CompareRunsPage() {
  const { versionId, b } = useParams<{ versionId: string; b: string }>();
  const { can } = useRole();
  const [module, setModule] = useUrlState("module");
  // `?change=new|worse|better|resolved` (`new` and `resolved` from the Progress tiles) narrows the ledger to one change set.
  const [changeFilter, setChangeFilter] = useUrlState("change");
  const v1Param = b === "baseline" ? undefined : b;
  const moduleParam = module || undefined;

  const cmpQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "modules", moduleParam],
    queryFn: () => compareVersions(v1Param, versionId, moduleParam),
    placeholderData: (p) => p,
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
      const failed = selected.length - ok;
      if (ok === 0) toast.error(`No fix batches created; ${failed} failed`);
      else toast.success(`Created ${ok} of ${selected.length} fix batches${failed > 0 ? `; ${failed} failed` : ""}`);
    },
  });

  const cmp = cmpQ.data;
  const diff = diffQ.data ?? null;
  const sentences = useMemo(() => (cmp ? compareNarrative(cmp, diff) : []), [cmp, diff]);
  const rows = useMemo(() => (cmp ? changeRows(cmp, changeFilter) : []), [cmp, changeFilter]);
  // Shown with every change, or with the sets that got worse; a filter to the fixed or better rules hides it.
  const worse = useMemo(() => {
    if (!cmp || (changeFilter && changeFilter !== "new" && changeFilter !== "worse")) return [];
    const listed = new Set([...cmp.checks.newly_failing, ...(cmp.checks.worse ?? [])].map((c) => `${c.module}:${c.check_id}`));
    return worseRows(diff?.checks ?? [], listed);
  }, [cmp, diff, changeFilter]);
  const nameOf = useRuleNames(rows.map((r) => r.check_id));
  const columns = useMemo(() => columnsFor(versionId), [versionId]);
  const worseColumns = useMemo(() => worseColumnsFor(versionId), [versionId]);

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
  const state: "error" | "empty" | undefined = errored ? "error" : empty ? "empty" : undefined;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  const before = mean(deltas.map((d) => d.v1_score));
  const after = mean(deltas.map((d) => d.v2_score));
  // The API compares only objects scored in both runs; an object only one run measured is left out of both means.
  const bothHint = `Mean of ${plural(deltas.length, "object")} in both runs; objects in only one run are left out`;

  // The direction in words: from the run compared with (A) to this run (B), each with its time, to the second when
  // both share the minute. Every figure below reads A to B.
  const [timeA, timeB] = cmp ? compareTimes(cmp.v1.run_at, cmp.v2.run_at) : ["", ""];
  const header = cmp ? (
    <PageHeader
      title={`${runName(cmp.v1)} (${timeA}) to ${runName(cmp.v2)} (${timeB})`}
      meta="Changes read from the first run to the second"
      status={b === "baseline" ? <Pill>Baseline</Pill> : undefined}
    />
  ) : (
    <Skeleton height={48} width={320} />
  );

  const narrative = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select label="Object" value={module} onValueChange={setModule} options={[{ value: "", label: "All objects" }, ...moduleOptions]} placeholder="All objects" />
        <Select label="Change" value={changeFilter} onValueChange={setChangeFilter} options={[{ value: "", label: "All changes" }, ...CHANGE_SETS.map((c) => ({ value: c.filter, label: c.label }))]} placeholder="All changes" />
      </div>
      {sentences.map((s) => (
        <p key={s}>{s}</p>
      ))}
    </div>
  );

  const charts = cmp ? (
    <div className="m-stat-grid">
      {/* In the title's order: the run compared with, then this run. */}
      <Stat label={`DQS ${runLabel(cmp.v1)}`} help="dqs" hint={bothHint} value={<span className="tabular-nums">{before.toFixed(1)}</span>} />
      <Stat label={`DQS ${runLabel(cmp.v2)}`} help="dqs" hint={bothHint} value={<span className="tabular-nums">{after.toFixed(1)}</span>} />
      <Stat label="Change" hint={`${runLabel(cmp.v1)} to ${runLabel(cmp.v2)}`} value={<Delta value={roundedDelta(before, after)} />} />
    </div>
  ) : (
    <div className="m-stat-grid">
      {[0, 1, 2].map((i) => <Stat key={i} label="" value="" loading />)}
    </div>
  );

  // The ledger is per rule; the narrative's rule-failure totals cover every rule, so the card says which is which.
  const fixedRules = rows.filter((r) => r.kind === "fixed").length;
  const tables = cmp && !loading ? (
    <div className="flex flex-col gap-4">
    <Card
      title="Rules that changed"
      meta={`${plural(rows.length, "rule")}${fixedRules ? `, ${fixedRules.toLocaleString()} fixed` : ""}; each row counts the records failing that one rule, not the rule-failure totals above`}
    >
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
      renderDrawer={(c) => <RuleDrawer rule={c} versionId={versionId} v1={diff?.v1 ?? v1Param} canFix={can("apply")} name={nameOf(c.check_id, c.message)} />}
    />
    </Card>
    {worse.length > 0 ? (
      <Card
        title="Rules with new failures"
        meta={`${plural(worse.length, "rule")} failing in both runs that some records newly fail, most first; together ${plural(worse.reduce((a, c) => a + c.new, 0), "new rule failure")}. Newly failing and worse rules are above.`}
      >
        <DataTable columns={worseColumns} data={worse} getRowId={(c) => `${c.module}:${c.check_id}`} tableId="compare-worse" />
      </Card>
    ) : null}
    </div>
  ) : (
    <div className="flex flex-col gap-1" aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="[height:36px]"><Skeleton height="100%" /></div>)}
    </div>
  );

  return (
    <ReportPage
      header={header}
      narrative={narrative}
      exportMenu={
        cmp && can("export") ? (
          <ExportMenu
            options={[{ format: "pdf" as const, label: "Progress report (PDF)", run: () => downloadAuthenticated(getComparisonReportUrl(versionId, v1Param), comparisonFilename(cmp.v2, cmp.v1)) }]}
          />
        ) : undefined
      }
      charts={charts}
      tables={tables}
      state={state}
      emptyProps={{ title: "No differences", detail: "These two runs have identical results.", action: <Button render={<Link href="/runs">All runs</Link>} /> }}
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

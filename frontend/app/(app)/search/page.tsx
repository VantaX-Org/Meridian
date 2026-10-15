// frontend/app/(app)/search/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, ExportMenu, Field, Pill, emptyExportOptions } from "@/design";
import { getCleaningQueue } from "@/lib/api/cleaning";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { exportFindings } from "@/lib/api/findings";
import { getRules } from "@/lib/api/rules";
import { getSystems } from "@/lib/api/connectivity";
import { getObjects } from "@/lib/api/v1/objects";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { rankResults, type SearchCandidate } from "@/lib/search";
import { queryKeys } from "@/lib/query-keys";

const columns: ColumnDef<SearchCandidate>[] = [
  { accessorKey: "kind", header: "Type" },
  { accessorKey: "label", header: "Result" },
];

export default function SearchPage() {
  const router = useRouter();
  const search = useSearchParams();
  const q = search.get("q") ?? "";
  const run = search.get("run") ?? "";
  const [draft, setDraft] = useState(q);

  const rules = useQuery({
    queryKey: queryKeys.rule("search", q),
    queryFn: () => getRules({ search: q }),
    enabled: !!q,
  });
  const glossary = useQuery({
    queryKey: queryKeys.glossary("search", { search: q }),
    queryFn: () => getGlossaryTerms({ search: q }),
    enabled: !!q,
  });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const batches = useQuery({
    queryKey: queryKeys.batch("list"),
    queryFn: () => getCleaningQueue({ per_page: 100 }),
  });
  const objects = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
    enabled: !!run,
  });
  const runs = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });

  const candidates = useMemo<SearchCandidate[]>(() => {
    const out: SearchCandidate[] = [];
    for (const r of rules.data?.rules ?? []) {
      out.push({ kind: "rule", id: r.id, label: r.name, href: `/rules/${r.id}` });
    }
    for (const t of glossary.data?.terms ?? []) {
      out.push({ kind: "glossary", id: t.id, label: t.business_name, href: `/mdm/glossary/${t.id}` });
    }
    for (const s of systems.data ?? []) {
      out.push({ kind: "object", id: s.id, label: s.name, href: `/systems/${s.id}` });
    }
    // Groups cleaning-queue items by batch_id (falling back to the item's own id when it has
    // none) — the deliberately minimal batch grouping this page needs; the fuller
    // `groupIntoBatches` helper belongs to the cleaning page's own task.
    const batchIds = new Set((batches.data?.items ?? []).map((item) => item.batch_id ?? item.id));
    for (const batchId of batchIds) {
      out.push({ kind: "batch", id: batchId, label: `Batch ${batchId}`, href: `/fix/${batchId}` });
    }
    for (const o of objects.data?.objects ?? []) {
      out.push({ kind: "object", id: o.module, label: o.label, href: `/objects/${o.module}?run=${run}` });
    }
    for (const v of runs.data?.versions ?? []) {
      out.push({ kind: "run", id: v.id, label: v.label ?? v.id, href: `/runs/${v.id}` });
    }
    return out;
  }, [rules.data, glossary.data, systems.data, batches.data, objects.data, runs.data, run]);

  const results = rankResults(q, candidates);
  const exportOptions = [
    { format: "xlsx" as const, label: "Findings (.xlsx)", run: () => exportFindings("xlsx", { version_id: run || undefined }) },
  ];
  const loading = rules.isLoading || glossary.isLoading || systems.isLoading || batches.isLoading || runs.isLoading
    || (!!run && objects.isLoading);
  const failedQuery = [rules, glossary, systems, batches, objects, runs].find((query) => isListFailure(query));
  const refetchAll = () => {
    void rules.refetch();
    void glossary.refetch();
    void systems.refetch();
    void batches.refetch();
    if (run) void objects.refetch();
    void runs.refetch();
  };

  return (
    <ExplorerPage
      summary={<ExportMenu options={!q || results.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} />}
      filterBar={
        <div className="flex flex-col gap-2">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/search?q=${encodeURIComponent(draft)}${run ? `&run=${run}` : ""}`);
          }}
        >
          <Field label="Search">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Object, rule, glossary term, batch or run id"
              className="w-full rounded border px-4 py-3 m-text-h"
              style={{ borderColor: "var(--m-line)" }}
            />
          </Field>
        </form>
        {q || run ? (
          <div className="flex flex-wrap gap-2" aria-label="Parsed filters">
            {q ? (
              <Link href={`/search${run ? `?run=${run}` : ""}`} aria-label={`Remove text filter ${q}`}>
                <Pill tone="neutral">Text: {q} ×</Pill>
              </Link>
            ) : null}
            {run ? (
              <Link href={`/search${q ? `?q=${encodeURIComponent(q)}` : ""}`} aria-label={`Remove run filter ${run}`}>
                <Pill tone="neutral">Run: {run} ×</Pill>
              </Link>
            ) : null}
          </div>
        ) : null}
        </div>
      }
      table={
        <DataTable
          columns={columns}
          data={results}
          getRowId={(r) => `${r.kind}:${r.id}`}
          onRowClick={(r) => router.push(r.href)}
        />
      }
      state={loading ? "loading" : failedQuery ? "error" : !q || results.length === 0 ? "empty" : undefined}
      emptyProps={
        q
          ? { title: "Nothing matches.", detail: `No results for "${q}". Search matches object names, rule ids, glossary terms, batch ids, run ids and record keys.` }
          : { title: "Search objects, records, checks and rules.", detail: "Type a name, rule id, batch id or run id above.", ghost: "table" }
      }
      errorProps={{
        message: apiErrorMessage(failedQuery?.error),
        onRetry: refetchAll,
      }}
    />
  );
}

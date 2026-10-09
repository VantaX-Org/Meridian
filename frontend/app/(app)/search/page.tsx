// frontend/app/(app)/search/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Field } from "@/design";
import { getCleaningQueue } from "@/lib/api/cleaning";
import { getRules } from "@/lib/api/rules";
import { getSystems } from "@/lib/api/connectivity";
import { getObjects } from "@/lib/api/v1/objects";
import { getVersions } from "@/lib/api/versions";
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
  }, [rules.data, systems.data, batches.data, objects.data, runs.data, run]);

  const results = rankResults(q, candidates);
  const loading = rules.isLoading || systems.isLoading || batches.isLoading || runs.isLoading || (!!run && objects.isLoading);
  const failedQuery = [rules, systems, batches, objects, runs].find((query) => query.isError);
  const refetchAll = () => {
    void rules.refetch();
    void systems.refetch();
    void batches.refetch();
    if (run) void objects.refetch();
    void runs.refetch();
  };

  return (
    <ExplorerPage
      filterBar={
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
              placeholder="Object, rule, batch or run id"
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)" }}
            />
          </Field>
        </form>
      }
      table={
        <DataTable
          columns={columns}
          data={results}
          getRowId={(r) => `${r.kind}:${r.id}`}
          onRowClick={(r) => router.push(r.href)}
        />
      }
      state={loading ? "loading" : failedQuery ? "error" : q && results.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No matches. Try an object id, a rule id, a batch id or a run id." }}
      errorProps={{
        message: failedQuery?.error instanceof Error ? failedQuery.error.message : "Could not load search results.",
        onRetry: refetchAll,
      }}
    />
  );
}

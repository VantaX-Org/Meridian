// frontend/app/(app)/search/page.tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, ExportMenu, Field, Input, Notice, PageHeader, Pill, emptyExportOptions } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { exportFindings } from "@/lib/api/findings";
import { listBatches } from "@/lib/api/remediation";
import { getRules } from "@/lib/api/rules";
import { getSystems } from "@/lib/api/connectivity";
import { getCatalogue, listRuns } from "@/lib/api/process-discovery";
import { listModels } from "@/lib/api/process-designer";
import { getObjects } from "@/lib/api/v1/objects";
import { useRunList } from "@/hooks/use-run-list";
import { useRole } from "@/hooks/use-role";
import { useVisibleNav } from "@/hooks/use-nav";
import { apiErrorState, isListFailure } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { flattenNav, resolveNavHref } from "@/lib/nav";
import { runScopeLabel } from "@/lib/run-scope";
import { rankResults, SEARCH_KIND_LABEL, type SearchCandidate } from "@/lib/search";
import { queryKeys } from "@/lib/query-keys";

const INDEXED = "Pages, systems, objects, rules, glossary terms, batches, runs, processes, discovery runs and process models";

const columns: ColumnDef<SearchCandidate>[] = [
  { id: "kind", header: "Type", size: 160, accessorFn: (c) => c.kind, cell: ({ row }) => <Pill tone="neutral">{SEARCH_KIND_LABEL[row.original.kind]}</Pill> },
  { accessorKey: "label", header: "Result" },
  actionColumn((c) => <RowLink href={c.href} label={`Open ${c.label}`}>Open</RowLink>),
];

export default function SearchPage() {
  const router = useRouter();
  const search = useSearchParams();
  const q = search.get("q") ?? "";
  // Objects are listed for ?run=, else for the newest finished run ("latest", resolved by the objects API).
  const run = search.get("run") ?? "";
  const objectsRun = run || "latest";
  const [draft, setDraft] = useState(q);
  const { role } = useRole();
  const nav = useVisibleNav();

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
  const batches = useQuery({ queryKey: queryKeys.remediationBatches(), queryFn: listBatches });
  const objects = useQuery({
    queryKey: queryKeys.objects(objectsRun),
    queryFn: () => getObjects(objectsRun),
  });
  const runs = useRunList();
  const models = useQuery({ queryKey: queryKeys.processModels(), queryFn: listModels });
  // The L1 catalogue and the discovery runs of every system, in one query keyed by the systems it covers.
  const systemIds = useMemo(() => (systems.data ?? []).map((s) => s.id), [systems.data]);
  const processes = useQuery({
    queryKey: ["search", "process", systemIds],
    queryFn: async () => Promise.all(systemIds.map(async (id) => ({
      systemId: id, catalogue: await getCatalogue(id), runs: await listRuns(id, { limit: 50 }),
    }))),
    enabled: systems.isSuccess,
  });

  const candidates = useMemo<SearchCandidate[]>(() => {
    const out: SearchCandidate[] = [];
    for (const item of flattenNav(nav.flatMap((g) => g.items))) {
      out.push({ kind: "page", id: item.href, label: item.label, href: resolveNavHref(item.href, role) });
    }
    for (const r of rules.data?.rules ?? []) {
      out.push({ kind: "rule", id: r.id, label: r.name, href: `/rules/${r.id}` });
    }
    for (const t of glossary.data?.terms ?? []) {
      out.push({ kind: "glossary", id: t.id, label: t.business_name, href: `/mdm/glossary/${t.id}` });
    }
    for (const s of systems.data ?? []) {
      out.push({ kind: "system", id: s.id, label: s.name, href: `/systems/${s.id}` });
    }
    for (const b of batches.data?.items ?? []) {
      out.push({ kind: "batch", id: b.id, label: b.name, href: `/fix?tab=batches&batch=${b.id}` });
    }
    for (const o of objects.data?.objects ?? []) {
      out.push({ kind: "object", id: o.module, label: o.label, href: run ? `/objects/${o.module}?run=${run}` : `/objects/${o.module}` });
    }
    for (const v of runs.data?.versions ?? []) {
      out.push({ kind: "run", id: v.id, label: runScopeLabel(v), href: `/runs/${v.id}` });
    }
    for (const p of processes.data ?? []) {
      const names = new Map(p.catalogue.map((row) => [row.l1, row.name]));
      for (const row of p.catalogue) {
        out.push({ kind: "process", id: row.l1, label: row.name, href: `/process/${row.l1}?system=${p.systemId}` });
      }
      for (const r of p.runs) {
        out.push({ kind: "discovery_run", id: r.id, label: `${names.get(r.l1) ?? r.l1}, ${formatDate(r.started_at, "date")}`, href: `/process/runs/${r.id}` });
      }
    }
    for (const m of models.data ?? []) {
      out.push({ kind: "model", id: m.id, label: m.name, href: `/insights/process/designer?model=${m.id}` });
    }
    return out;
  }, [nav, role, rules.data, glossary.data, systems.data, batches.data, objects.data, runs.data, processes.data, models.data, run]);

  const results = rankResults(q, candidates);
  const exportOptions = [
    { format: "xlsx" as const, label: "Findings (.xlsx)", run: () => exportFindings("xlsx", { version_id: run || undefined }) },
  ];
  // Each source is searched on its own: a loaded source's results show while a slow one is still on its way, and a
  // source that failed says so in its own notice with its own Retry instead of hiding everything else.
  const sources = [
    { name: "Rules", query: rules },
    { name: "Glossary terms", query: glossary },
    { name: "Systems", query: systems },
    { name: "Batches", query: batches },
    { name: "Objects", query: objects },
    { name: "Runs", query: runs },
    { name: "Processes", query: processes },
    { name: "Process models", query: models },
  ];
  const pending = sources.filter((s) => s.query.isLoading);
  const failed = sources.filter((s) => isListFailure(s.query));
  // Only a search with nothing to show yet waits for a skeleton; every source failing is a page error.
  const loading = results.length === 0 && pending.length > 0 && failed.length < sources.length;
  const allFailed = failed.length === sources.length;
  const refetchFailed = () => {
    for (const s of failed) void s.query.refetch();
  };
  const notices = !allFailed && (failed.length || (pending.length && results.length)) ? (
    <div className="flex flex-col gap-2" data-testid="search-source-notices">
      {failed.map((s) => (
        <Notice
          key={s.name}
          tone="warning"
          title={`${s.name} could not be searched`}
          action={<Button variant="secondary" onClick={() => void s.query.refetch()}>Retry</Button>}
        >
          {apiErrorState(s.query.error).title}
        </Notice>
      ))}
      {pending.length && results.length ? (
        <Notice compact>{`Still searching ${pending.map((s) => s.name.toLowerCase()).join(", ")}`}</Notice>
      ) : null}
    </div>
  ) : undefined;

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Search"
          meta={q ? `${results.length.toLocaleString()} ${results.length === 1 ? "result" : "results"} for "${q}"` : INDEXED}
          actions={<ExportMenu options={!q || results.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} />}
        />
      }
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
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Page, system, object, rule, glossary term, batch, run or process"
              className="[min-width:320px]"
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
      strip={notices}
      state={loading ? "loading" : allFailed ? "error" : !q || results.length === 0 ? "empty" : undefined}
      emptyProps={
        q
          ? { title: "Nothing matches", detail: `No results for "${q}". Search matches the names and ids of ${INDEXED.charAt(0).toLowerCase()}${INDEXED.slice(1)}.` }
          : { title: "Search pages, objects, rules and processes", detail: `Type a name or id. ${INDEXED} are indexed.`, ghost: "table" }
      }
      errorProps={{
        error: failed[0]?.query.error,
        onRetry: refetchFailed,
      }}
    />
  );
}

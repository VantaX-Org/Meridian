// frontend/app/(app)/mdm/glossary/page.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Field, Input, PageHeader, Pager, Pill, Select, asyncStateOf, type CellMeta } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { formatModuleName } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";
import { getGlossaryTerms, populateGlossary } from "@/lib/api/glossary";
import { getRuleCoverage } from "@/lib/api/rules";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { GlossaryTermSummary } from "@/types/api";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "under_review", label: "Under review" },
  { value: "deprecated", label: "Deprecated" },
];

const PAGE_SIZE = 100;

const STATUS_LABEL: Record<string, string> = { active: "Active", under_review: "Under review", deprecated: "Deprecated" };

const columns: ColumnDef<GlossaryTermSummary>[] = [
  { accessorKey: "business_name", header: "Term" },
  { id: "domain", header: "Object", accessorFn: (t) => formatModuleName(t.domain) },
  { id: "status", header: "Status", accessorFn: (t) => t.status, cell: ({ row }) => <Pill tone={row.original.status === "deprecated" ? "neutral" : "info"}>{STATUS_LABEL[row.original.status] ?? row.original.status.replace(/_/g, " ")}</Pill> },
  { id: "s4", header: "S/4HANA mandatory", cell: ({ row }) => (row.original.mandatory_for_s4hana ? "Yes" : "") },
  { id: "drafted", header: "Definition", cell: ({ row }) => (row.original.ai_drafted ? "Model draft" : "Steward") },
  { accessorKey: "linked_rules_count", header: "Rules", size: 80, meta: { numeric: true } satisfies CellMeta },
  actionColumn((t) => <RowLink href={`/mdm/glossary/${t.id}`}>Open</RowLink>),
];

export default function GlossaryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  // One replace: separate useUrlState setters would each rebuild the query from the same stale string.
  const clearFilters = () => {
    const params = new URLSearchParams(urlParams.toString());
    for (const k of ["domain", "status", "q", "page"]) params.delete(k);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const domain = urlParams.get("domain") ?? "all";
  const status = urlParams.get("status") ?? "all";
  const [search, setSearchRaw] = useUrlState("q");
  const page = Math.max(1, Number(urlParams.get("page")) || 1);
  // A filter change starts again from page one: one replace, so the setters never race.
  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(urlParams.toString());
    params.delete("page");
    if (value && value !== "all") params.set(key, value); else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setDomain = (v: string) => setFilter("domain", v);
  const setStatus = (v: string) => setFilter("status", v);
  // Typing keeps the hook's local value; only the first keystroke on a later page goes through setFilter.
  const setSearch = page > 1 ? (v: string) => setFilter("q", v) : setSearchRaw;
  const setPage = (n: number) => {
    const params = new URLSearchParams(urlParams.toString());
    if (n > 1) params.set("page", String(n)); else params.delete("page");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const qc = useQueryClient();
  const canDraft = useRole().can("approve");
  const draft = useMutation({
    mutationFn: populateGlossary,
    onSuccess: (r) => {
      toast.success(`${r.created.toLocaleString()} term${r.created === 1 ? "" : "s"} drafted across ${r.objects.toLocaleString()} object${r.objects === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: ["glossary"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const query = useQuery({
    queryKey: queryKeys.glossary("list", { domain, status, search, page }),
    queryFn: () =>
      getGlossaryTerms({
        domain: domain === "all" ? undefined : domain,
        status: status === "all" ? undefined : status,
        search: search || undefined,
        per_page: PAGE_SIZE,
        page,
      }),
  });

  const terms = useMemo(() => query.data?.terms ?? [], [query.data]);
  // Every object with rules (the same catalogue the rule drafts use), not only those on the loaded page.
  const coverage = useQuery({ queryKey: ["rule-coverage", "modules"], queryFn: () => getRuleCoverage(), staleTime: 60_000, meta: { ignoreError: true } });
  const domainOptions = useMemo(() => {
    const seen = new Set((coverage.data?.objects ?? []).map((o) => o.module));
    if (domain !== "all") seen.add(domain);
    return [{ value: "all", label: "All objects" }, ...Array.from(seen).sort().map((d) => ({ value: d, label: formatModuleName(d) }))];
  }, [coverage.data, domain]);
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const state = asyncStateOf(query, () => terms.length === 0, true);
  const filtered = domain !== "all" || status !== "all" || !!search;

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Glossary"
          meta={`What each SAP field means in business words, and the rules that check it.${query.data ? ` ${query.data.total.toLocaleString()} terms.` : ""}`}
          actions={canDraft ? <Button variant="secondary" pending={draft.isPending} onClick={() => draft.mutate()}>Draft terms from analysed objects</Button> : undefined}
        />
      }
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Search">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Term, SAP table or field"
            />
          </Field>
          <Field label="Object">
            <Select value={domain} onValueChange={setDomain} options={domainOptions} />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
          </Field>
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            data={terms}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/mdm/glossary/${r.id}`)}
            rowHref={(r) => `/mdm/glossary/${r.id}`}
          />
          {pageCount > 1 && <Pager page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
        </div>
      }
      state={state}
      emptyProps={{
        title: filtered ? "No terms match" : "No terms yet",
        detail: filtered
          ? "Clear a filter to widen the list."
          : "Terms are drafted from the SAP fields Meridian's rules check, for each object you analyse. Each analysis adds its objects' terms.",
        action: filtered
          ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
          : canDraft
            ? <Button pending={draft.isPending} onClick={() => draft.mutate()}>Draft terms from analysed objects</Button>
            : <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />,
      }}
      errorProps={{
        message: apiErrorMessage(query.error),
        onRetry: () => query.refetch(),
      }}
    />
  );
}

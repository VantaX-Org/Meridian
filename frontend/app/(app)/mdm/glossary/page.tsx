// frontend/app/(app)/mdm/glossary/page.tsx
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Field, Input, PageHeader, Pill, Select, asyncStateOf, type CellMeta } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { formatModuleName } from "@/lib/format";
import { useUrlState } from "@/hooks/use-url-state";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { GlossaryTermSummary } from "@/types/api";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "under_review", label: "Under review" },
  { value: "deprecated", label: "Deprecated" },
];

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
    for (const k of ["domain", "status", "q"]) params.delete(k);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const [domain, setDomain] = useUrlState("domain", "all");
  const [status, setStatus] = useUrlState("status", "all");
  const [search, setSearch] = useUrlState("q");

  const query = useQuery({
    queryKey: queryKeys.glossary("list", { domain, status, search }),
    queryFn: () =>
      getGlossaryTerms({
        domain: domain === "all" ? undefined : domain,
        status: status === "all" ? undefined : status,
        search: search || undefined,
        per_page: 100,
      }),
  });

  const terms = useMemo(() => query.data?.terms ?? [], [query.data]);
  const domainOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of terms) seen.add(t.domain);
    return [{ value: "all", label: "All domains" }, ...Array.from(seen).sort().map((d) => ({ value: d, label: d }))];
  }, [terms]);

  const state = asyncStateOf(query, () => terms.length === 0, true);
  const filtered = domain !== "all" || status !== "all" || !!search;

  return (
    <ExplorerPage
      header={<PageHeader title="Glossary" meta={query.data ? `${query.data.total.toLocaleString()} terms` : undefined} />}
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Search">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Term, SAP table or field"
            />
          </Field>
          <Field label="Domain">
            <Select value={domain} onValueChange={setDomain} options={domainOptions} />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
          </Field>
        </div>
      }
      table={
        <DataTable
          columns={columns}
          data={terms}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/mdm/glossary/${r.id}`)}
          rowHref={(r) => `/mdm/glossary/${r.id}`}
        />
      }
      state={state}
      emptyProps={{
        title: filtered ? "No terms match" : "No terms yet",
        detail: filtered ? "Clear a filter to widen the list." : "Terms are drafted from analysed SAP fields. Run an analysis to populate the glossary.",
        action: filtered
          ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>
          : <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />,
      }}
      errorProps={{
        message: apiErrorMessage(query.error),
        onRetry: () => query.refetch(),
      }}
    />
  );
}

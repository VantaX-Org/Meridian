// frontend/app/(app)/mdm/glossary/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Field, Select } from "@/design";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { queryKeys } from "@/lib/query-keys";
import type { GlossaryTermSummary } from "@/types/api";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "under_review", label: "Under review" },
  { value: "deprecated", label: "Deprecated" },
];

const columns: ColumnDef<GlossaryTermSummary>[] = [
  { accessorKey: "business_name", header: "Term" },
  { accessorKey: "domain", header: "Domain" },
  { accessorKey: "status", header: "Status" },
  { id: "s4", header: "S/4HANA mandatory", cell: ({ row }) => (row.original.mandatory_for_s4hana ? "Yes" : "") },
  { id: "drafted", header: "Definition", cell: ({ row }) => (row.original.ai_drafted ? "AI draft" : "Steward") },
  { accessorKey: "linked_rules_count", header: "Rules" },
];

export default function GlossaryPage() {
  const router = useRouter();
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: queryKeys.glossary("list", { domain, status, search }),
    queryFn: () =>
      getGlossaryTerms({
        domain: domain === "all" ? undefined : domain,
        status: status === "all" ? undefined : status,
        search: search || undefined,
        per_page: 200,
      }),
  });

  const terms = useMemo(() => query.data?.terms ?? [], [query.data]);
  const domainOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const t of terms) seen.add(t.domain);
    return [{ value: "all", label: "All domains" }, ...Array.from(seen).sort().map((d) => ({ value: d, label: d }))];
  }, [terms]);

  const state = query.isLoading ? "loading" : query.isError ? "error" : terms.length === 0 ? "empty" : undefined;

  return (
    <ExplorerPage
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Term, SAP table or field"
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)" }}
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
        />
      }
      state={state}
      emptyProps={{ title: "No glossary terms match these filters." }}
      errorProps={{
        message: query.error instanceof Error ? query.error.message : "Could not load the glossary.",
        onRetry: () => query.refetch(),
      }}
    />
  );
}

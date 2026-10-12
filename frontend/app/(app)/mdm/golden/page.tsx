// frontend/app/(app)/mdm/golden/page.tsx
"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, type CellMeta, ExplorerPage, Field, Input, PageHeader, Pager, Select } from "@/design";
import { getMasterRecords } from "@/lib/api/master-records";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MasterRecordSummary } from "@/types/api";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "candidate", label: "Candidate" },
  { value: "pending_review", label: "Pending review" },
  { value: "golden", label: "Golden" },
  { value: "superseded", label: "Superseded" },
];

const DOMAIN_OPTIONS = [
  { value: "all", label: "All domains" },
  { value: "material_master", label: "Material master" },
  { value: "business_partner", label: "Business partner" },
];

const columns: ColumnDef<MasterRecordSummary>[] = [
  { accessorKey: "sap_object_key", header: "SAP key", size: 200 },
  { id: "domain", header: "Domain", size: 160, cell: ({ row }) => formatModuleName(row.original.domain) },
  { accessorKey: "status", header: "Status", size: 130 },
  { accessorKey: "source_count", header: "Sources", size: 90, meta: { numeric: true } satisfies CellMeta },
  { id: "conf", header: "Confidence", size: 110, meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => `${Math.round(row.original.overall_confidence * 100)}%` },
  { accessorKey: "pending_issues", header: "Open issues", size: 110, meta: { numeric: true } satisfies CellMeta },
];

export default function GoldenRecordsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const domain = search.get("domain") ?? "all";
  const status = search.get("status") ?? "all";
  const minConfidence = search.get("min") ?? "";
  const maxConfidence = search.get("max") ?? "";
  const page = Math.max(1, Number(search.get("page")) || 1);
  // One replace per change: separate useUrlState setters would each start from a stale query string.
  const setParams = (patch: Record<string, string>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries({ page: "", ...patch })) { if (v && v !== "all" && !(k === "page" && v === "1")) params.set(k, v); else params.delete(k); }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const setPage = (n: number) => { const params = new URLSearchParams(search.toString()); if (n > 1) params.set("page", String(n)); else params.delete("page"); const qs = params.toString(); router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }); };

  const filters = {
    domain: domain === "all" ? undefined : domain,
    status: status === "all" ? undefined : status,
    min_confidence: minConfidence ? Number(minConfidence) / 100 : undefined,
    max_confidence: maxConfidence ? Number(maxConfidence) / 100 : undefined,
  };

  const query = useQuery({
    queryKey: queryKeys.masterRecords({ ...filters, page }),
    queryFn: () => getMasterRecords({ ...filters, per_page: 100, page }),
  });

  const records = useMemo(() => query.data?.records ?? [], [query.data]);
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 100));
  const state = query.isLoading ? "loading" : isListFailure(query) ? "error" : records.length === 0 ? "empty" : undefined;
  const filtered = domain !== "all" || status !== "all" || !!minConfidence || !!maxConfidence;

  return (
    <ExplorerPage
      header={<PageHeader title="Golden records" meta={query.data ? `${query.data.total.toLocaleString()} records` : undefined} />}
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Domain">
            <Select value={domain} onValueChange={(v) => setParams({ domain: v })} options={DOMAIN_OPTIONS} />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => setParams({ status: v })} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Min confidence %">
            <Input
              value={minConfidence}
              onChange={(e) => setParams({ min: e.target.value })}
              placeholder="0-100"
              inputMode="numeric"
              style={{ width: 90 }}
            />
          </Field>
          <Field label="Max confidence %">
            <Input
              value={maxConfidence}
              onChange={(e) => setParams({ max: e.target.value })}
              placeholder="0-100"
              inputMode="numeric"
              style={{ width: 90 }}
            />
          </Field>
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            data={records}
            getRowId={(r) => r.id}
            onRowClick={(r) => router.push(`/mdm/golden/${r.id}`)}
            rowHref={(r) => `/mdm/golden/${r.id}`}
          />
          {pageCount > 1 && <Pager page={page} pageCount={pageCount} pageSize={100} total={query.data?.total ?? 0} onPageChange={setPage} />}
        </div>
      }
      state={state}
      emptyProps={
        filtered
          ? { title: "No records match", detail: "Clear a filter to widen the list.", action: <Button variant="secondary" onClick={() => setParams({ domain: "", status: "", min: "", max: "" })}>Clear filters</Button> }
          : { title: "No golden records", action: <Button render={<Link href="/mdm/match-rules">Open match rules</Link>} /> }
      }
      errorProps={{
        message: apiErrorMessage(query.error),
        onRetry: () => query.refetch(),
      }}
    />
  );
}

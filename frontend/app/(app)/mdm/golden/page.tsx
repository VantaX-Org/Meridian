// frontend/app/(app)/mdm/golden/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, Field, Pager, Select } from "@/design";
import { getMasterRecords } from "@/lib/api/master-records";
import { apiErrorMessage } from "@/lib/error";
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
  { accessorKey: "sap_object_key", header: "SAP key" },
  { id: "domain", header: "Domain", cell: ({ row }) => formatModuleName(row.original.domain) },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "source_count", header: "Sources" },
  { id: "conf", header: "Confidence", cell: ({ row }) => `${Math.round(row.original.overall_confidence * 100)}%` },
  { accessorKey: "pending_issues", header: "Open issues" },
];

export default function GoldenRecordsPage() {
  const router = useRouter();
  const [domain, setDomain] = useState("all");
  const [status, setStatus] = useState("all");
  const [minConfidence, setMinConfidence] = useState("");
  const [maxConfidence, setMaxConfidence] = useState("");
  const [page, setPage] = useState(1);

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
  const state = query.isLoading ? "loading" : query.isError ? "error" : records.length === 0 ? "empty" : undefined;
  const filtered = domain !== "all" || status !== "all" || !!minConfidence || !!maxConfidence;

  return (
    <ExplorerPage
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Domain">
            <Select value={domain} onValueChange={(v) => { setDomain(v); setPage(1); }} options={DOMAIN_OPTIONS} />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Min confidence %">
            <input
              aria-label="Min confidence %"
              value={minConfidence}
              onChange={(e) => { setMinConfidence(e.target.value); setPage(1); }}
              placeholder="0-100"
              inputMode="numeric"
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)", width: 90 }}
            />
          </Field>
          <Field label="Max confidence %">
            <input
              aria-label="Max confidence %"
              value={maxConfidence}
              onChange={(e) => { setMaxConfidence(e.target.value); setPage(1); }}
              placeholder="0-100"
              inputMode="numeric"
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)", width: 90 }}
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
          />
          {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPageChange={setPage} />}
        </div>
      }
      state={state}
      emptyProps={
        filtered
          ? { title: "No master records match these filters." }
          : { title: "No golden records.", action: <Button render={<Link href="/mdm/match-rules">Match rules</Link>} /> }
      }
      errorProps={{
        message: apiErrorMessage(query.error),
        onRetry: () => query.refetch(),
      }}
    />
  );
}

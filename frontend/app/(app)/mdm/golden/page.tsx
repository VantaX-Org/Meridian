// frontend/app/(app)/mdm/golden/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Field, Select } from "@/design";
import { getMasterRecords } from "@/lib/api/master-records";
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

  const filters = {
    domain: domain === "all" ? undefined : domain,
    status: status === "all" ? undefined : status,
    min_confidence: minConfidence ? Number(minConfidence) / 100 : undefined,
  };

  const query = useQuery({
    queryKey: queryKeys.masterRecords(filters),
    queryFn: () => getMasterRecords({ ...filters, per_page: 200 }),
  });

  const records = useMemo(() => query.data?.records ?? [], [query.data]);
  const state = query.isLoading ? "loading" : query.isError ? "error" : records.length === 0 ? "empty" : undefined;

  return (
    <ExplorerPage
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Domain">
            <Select value={domain} onValueChange={setDomain} options={DOMAIN_OPTIONS} />
          </Field>
          <Field label="Status">
            <Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} />
          </Field>
          <Field label="Min confidence %">
            <input
              value={minConfidence}
              onChange={(e) => setMinConfidence(e.target.value)}
              placeholder="0-100"
              inputMode="numeric"
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)", width: 90 }}
            />
          </Field>
        </div>
      }
      table={
        <DataTable
          columns={columns}
          data={records}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/mdm/golden/${r.id}`)}
        />
      }
      state={state}
      emptyProps={{ title: "No master records match these filters." }}
      errorProps={{ message: "Could not load golden records.", onRetry: () => query.refetch() }}
    />
  );
}

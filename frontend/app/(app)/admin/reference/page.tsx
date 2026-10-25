"use client";

/** Admin › Reference data: postal-code and BIC lists held per system. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, PageHeader, Select } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { getSystems } from "@/lib/api/connectivity";
import { getReferenceLists, type ReferenceList } from "@/lib/api/system-objects";
import { isListFailure } from "@/lib/error";
import { labelOf } from "@/lib/format";

/** Reference list kinds as words. */
const KIND_LABEL: Record<string, string> = {
  "postal-codes": "Postal codes", postal_codes: "Postal codes", postal: "Postal codes",
  bic: "Bank codes (SWIFT BIC)", bics: "Bank codes (SWIFT BIC)",
};
const kindLabel = (k: string) => KIND_LABEL[k] ?? labelOf(k);

const columns: ColumnDef<ReferenceList>[] = [
  { id: "kind", header: "List", cell: ({ row }) => kindLabel(row.original.kind) },
  { id: "n", header: "Records", cell: ({ row }) => row.original.records.toLocaleString() },
  { id: "c", header: "Countries", cell: ({ row }) => row.original.countries.join(", ") || "—" },
];

export default function ReferenceAdminPage() {
  const [picked, setPicked] = useState("");
  const systems = useQuery({ queryKey: ["systems", "reference"], queryFn: getSystems });
  const list = systems.data ?? [];
  const id = picked || list[0]?.id || "";
  const q = useQuery({ queryKey: ["reference-lists", id], queryFn: () => getReferenceLists(id), enabled: !!id });
  const rows = q.data ?? [];
  const failed = isListFailure(systems) ? systems : isListFailure(q) ? q : null;
  return (
    <ExplorerPage
      header={<PageHeader title="Reference data" meta="Official postal code and bank code lists, per system, that address and bank checks compare against. Upload or replace a list on the system page" />}
      filterBar={list.length > 0 ? <Select label="System" value={id} onValueChange={setPicked} options={list.map((s) => ({ value: s.id, label: s.name }))} placeholder="System" /> : undefined}
      state={systems.isLoading || (!!id && q.isLoading) ? "loading" : failed ? "error" : rows.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No reference data loaded",
        detail: list.length === 0 ? "Reference lists belong to a system. Connect a system first." : "Upload postal codes or a bank code list on the system's Health tab. Until then those checks use format rules only.",
        action: <Button render={<Link href={list.length === 0 ? "/systems?connect=1" : id ? `/systems/${id}?tab=health` : "/systems"}>{list.length === 0 ? "Connect a system" : "Open the system"}</Link>} />,
      }}
      errorProps={{ error: failed?.error, onRetry: () => { void systems.refetch(); void q.refetch(); } }}
      table={<DataTable columns={[...columns, actionColumn<ReferenceList>(() => (id ? <RowLink href={`/systems/${id}?tab=health`}>Open system</RowLink> : null))]} data={rows} getRowId={(r) => r.kind} />}
    />
  );
}

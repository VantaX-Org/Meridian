"use client";

/** MDM › Survivorship: which source wins each field when records merge into a golden record. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Pill } from "@/design";
import { getSurvivorshipRules, type SurvivorshipRule } from "@/lib/api/survivorship";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName } from "@/lib/format";

const columns: ColumnDef<SurvivorshipRule>[] = [
  { id: "domain", header: "Domain", cell: ({ row }) => formatModuleName(row.original.domain) },
  { accessorKey: "field", header: "Field" },
  { id: "type", header: "Rule", cell: ({ row }) => row.original.rule_type.replace(/_/g, " ") },
  { id: "sources", header: "Trusted sources", cell: ({ row }) => row.original.trusted_sources?.join(", ") || "—" },
  { accessorKey: "weight", header: "Weight" },
  { id: "active", header: "Status", cell: ({ row }) => <Pill tone={row.original.active ? "go" : "at-risk"}>{row.original.active ? "Active" : "Off"}</Pill> },
  { id: "ai", header: "Source", cell: ({ row }) => (row.original.ai_inferred ? "Inferred by AI" : "Set by a person") },
];

export default function SurvivorshipPage() {
  const q = useQuery({ queryKey: ["mdm", "survivorship"], queryFn: () => getSurvivorshipRules() });
  const rules = q.data?.rules ?? [];
  return (
    <ExplorerPage
      state={q.isLoading ? "loading" : isListFailure(q) ? "error" : rules.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No survivorship rules.", detail: "Until a rule exists for a field, the most recent source value wins." }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={rules} getRowId={(r) => r.id} />}
    />
  );
}

"use client";

/** MDM › Survivorship: which source wins each field when records merge into a golden record. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, PageHeader, Pill, type CellMeta, asyncStateOf } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { getSurvivorshipRules, type SurvivorshipRule } from "@/lib/api/survivorship";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";

const columns: ColumnDef<SurvivorshipRule>[] = [
  { id: "domain", header: "Object", size: 160, cell: ({ row }) => formatModuleName(row.original.domain) },
  { accessorKey: "field", header: "Field", size: 160 },
  { id: "type", header: "Rule", size: 160, cell: ({ row }) => row.original.rule_type.replace(/_/g, " ") },
  { id: "sources", header: "Trusted sources", cell: ({ row }) => row.original.trusted_sources?.join(", ") || "—" },
  { accessorKey: "weight", header: "Weight", size: 90, meta: { numeric: true } satisfies CellMeta },
  { id: "active", header: "Status", size: 100, accessorFn: (r) => (r.active ? "Active" : "Off"), cell: ({ row }) => <Pill tone={row.original.active ? "go" : "neutral"}>{row.original.active ? "Active" : "Off"}</Pill> },
  { id: "ai", header: "Set by", cell: ({ row }) => (row.original.ai_inferred ? "Model inference" : "A person") },
  actionColumn((r) => <RowLink href={`/mdm/golden?domain=${encodeURIComponent(r.domain)}`}>Open records</RowLink>),
];

export default function SurvivorshipPage() {
  const q = useQuery({ queryKey: ["mdm", "survivorship"], queryFn: () => getSurvivorshipRules() });
  const rules = q.data?.rules ?? [];
  return (
    <ExplorerPage
      header={<PageHeader title="Survivorship rules" meta={`${rules.length.toLocaleString()} rules`} />}
      state={asyncStateOf(q, () => rules.length === 0, true)}
      emptyProps={{ title: "No survivorship rules", detail: "Until a rule exists for a field, the most recent source value wins.", action: <Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={rules} getRowId={(r) => r.id} />}
    />
  );
}

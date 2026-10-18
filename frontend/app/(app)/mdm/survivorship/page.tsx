"use client";

/** MDM › Survivorship: which source wins each field when records merge into a golden record. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, PageHeader, Pill, Stat, type CellMeta, asyncStateOf } from "@/design";
import { getSurvivorshipRules, type SurvivorshipRule } from "@/lib/api/survivorship";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";

const columns: ColumnDef<SurvivorshipRule>[] = [
  { id: "domain", header: "Domain", size: 160, cell: ({ row }) => formatModuleName(row.original.domain) },
  { accessorKey: "field", header: "Field", size: 160 },
  { id: "type", header: "Rule", size: 160, cell: ({ row }) => row.original.rule_type.replace(/_/g, " ") },
  { id: "sources", header: "Trusted sources", cell: ({ row }) => row.original.trusted_sources?.join(", ") || "—" },
  { accessorKey: "weight", header: "Weight", size: 90, meta: { numeric: true } satisfies CellMeta },
  { id: "active", header: "Status", size: 100, cell: ({ row }) => <Pill tone={row.original.active ? "go" : "at-risk"}>{row.original.active ? "Active" : "Off"}</Pill> },
  { id: "ai", header: "Source", cell: ({ row }) => (row.original.ai_inferred ? "Inferred by AI" : "Set by a person") },
];

export default function SurvivorshipPage() {
  const q = useQuery({ queryKey: ["mdm", "survivorship"], queryFn: () => getSurvivorshipRules() });
  const rules = q.data?.rules ?? [];
  return (
    <ExplorerPage
      header={<PageHeader title="Survivorship rules" meta={`${rules.length.toLocaleString()} rules`} />}
      summary={
        <div className="m-stat-grid">
          <Stat label="Rules" value={rules.length.toLocaleString()} loading={q.isLoading} />
          <Stat label="Active" value={rules.filter((r) => r.active).length.toLocaleString()} loading={q.isLoading} />
          <Stat label="Inferred by AI" value={rules.filter((r) => r.ai_inferred).length.toLocaleString()} loading={q.isLoading} />
        </div>
      }
      state={asyncStateOf(q, () => rules.length === 0, true)}
      emptyProps={{ title: "No survivorship rules", detail: "Until a rule exists for a field, the most recent source value wins.", action: <Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={rules} getRowId={(r) => r.id} />}
    />
  );
}

"use client";

/** MDM › Survivorship: which source wins each field when records merge into a golden record. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, Mono, PageHeader, Pill, type CellMeta, asyncStateOf } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { getSurvivorshipRules, type SurvivorshipRule } from "@/lib/api/survivorship";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";

/** Each rule type as the sentence a steward would say. */
const RULE_WORDS: Record<string, string> = {
  most_recent: "Newest value wins",
  most_complete: "Most complete value wins",
  most_frequent: "Most common value wins",
  trusted_source: "Trusted system wins",
  chain: "Trusted systems, in order",
  manual_override: "A steward sets it",
};

const columns: ColumnDef<SurvivorshipRule>[] = [
  { id: "domain", header: "Object", size: 160, cell: ({ row }) => formatModuleName(row.original.domain) },
  { accessorKey: "field", header: "Field", size: 160, cell: ({ row }) => <Mono>{row.original.field}</Mono> },
  { id: "type", header: "Which value is kept", size: 200, accessorFn: (r) => RULE_WORDS[r.rule_type] ?? r.rule_type.replace(/_/g, " ") },
  { id: "sources", header: "Trusted systems", cell: ({ row }) => (row.original.trusted_sources?.length ? row.original.trusted_sources.map((s, i) => <span key={s}>{i ? ", " : ""}<Mono>{s}</Mono></span>) : "Any system") },
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
      header={
        <PageHeader
          title="Survivorship rules"
          meta={`When records merge, these rules decide which value each field keeps. A field without a rule keeps the newest value.${q.data ? ` ${rules.length.toLocaleString()} rules.` : ""}`}
          actions={<Button variant="secondary" render={<Link href="/mdm/golden/merge">Review match pairs</Link>} />}
        />
      }
      state={asyncStateOf(q, () => rules.length === 0, true)}
      emptyProps={{ title: "No survivorship rules", detail: "Until a rule exists for a field, the newest source value wins. You can still pick a value per field when you merge a pair.", action: <Button variant="secondary" render={<Link href="/mdm/golden/merge">Review match pairs</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={rules} getRowId={(r) => r.id} />}
    />
  );
}

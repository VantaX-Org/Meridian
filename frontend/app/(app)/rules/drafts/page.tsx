"use client";

/** Rules › Drafts: rule drafts from the New rule drawer, editable here: dry run, publish, delete. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Mono, PageHeader, asyncStateOf } from "@/design";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { getRuleDrafts, type RuleDraft } from "@/lib/api/rules";
import { formatDate, formatModuleName } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { DraftDrawer } from "./draft-drawer";

export default function RuleDraftsPage() {
  const { can } = useRole();
  const canManage = can("manage_rules");
  const q = useQuery({ queryKey: ["rule-drafts"], queryFn: getRuleDrafts });
  const [selected, setSelected] = useState<RuleDraft | "new" | null>(null);
  const columns = useMemo<ColumnDef<RuleDraft>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain.replace("dq_rule:", "")) },
    { id: "rule", header: "Rule", cell: ({ row }) => <Mono>{String(row.original.proposed_rule.id ?? row.original.proposed_rule.rule_id ?? "—")}</Mono> },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{String(row.original.proposed_rule.field ?? "—")}</Mono> },
    { id: "why", header: "Why", cell: ({ row }) => row.original.rationale ?? "—" },
    { id: "at", header: "Saved", cell: ({ row }) => formatDate(row.original.created_at, "date") },
    actionColumn((d) => <RowButton onClick={() => setSelected(d)}>Open</RowButton>),
  ], []);
  const items = q.data ?? [];
  const newDraft = canManage ? <Button onClick={() => setSelected("new")}>New draft</Button> : undefined;
  return (
    <>
      <ExplorerPage
        header={<PageHeader title="Rule drafts" meta="A draft is a rule that does not run yet. Dry run it on real data, then publish it to run on every analysis." actions={<><Button variant="secondary" render={<Link href="/rules">Back to rules</Link>} />{newDraft}</>} />}
        state={asyncStateOf(q, () => items.length === 0, true)}
        emptyProps={{ title: "No drafts", detail: "Start a draft here, or from New rule on the rules page.", ghost: "table", action: newDraft ?? <Button variant="secondary" render={<Link href="/rules">Open rules</Link>} /> }}
        errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
        table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} onRowClick={(r) => setSelected(r)} tableId="rule-drafts" />}
      />
      {selected ? (
        <DraftDrawer
          key={selected === "new" ? "new" : selected.id}
          draft={selected === "new" ? null : selected}
          open
          onOpenChange={(o) => { if (!o) setSelected(null); }}
        />
      ) : null}
    </>
  );
}

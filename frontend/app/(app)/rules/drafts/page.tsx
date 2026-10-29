"use client";

/** Rules › Drafts: rule drafts from the New rule drawer, editable here: dry run, publish, delete; and the
 * match rules the AI proposed, for a person with review_ai_rules to approve or reject. */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ExplorerPage, Mono, PageHeader, Skeleton, Tabs, asyncStateOf } from "@/design";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { RequestAccessButton } from "@/components/request-access-button";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getRuleDrafts, type RuleDraft } from "@/lib/api/rules";
import { formatDate, formatModuleName } from "@/lib/format";
import { AiProposals, useAiProposals } from "./ai-proposals";
import { DraftDrawer } from "./draft-drawer";

export default function RuleDraftsPage() {
  const { can, loading } = useRole();
  const canManage = can("manage_rules");
  const canReview = can("review_ai_rules");
  // GET /rules/drafts needs manage_rules (api/routes/rule_authoring.py); without it the read would only answer 403.
  const q = useQuery({ queryKey: ["rule-drafts"], queryFn: getRuleDrafts, enabled: canManage });
  // GET /ai/proposed-rules needs review_ai_rules (api/routes/ai_feedback.py); the tab's own list reads the same key.
  const proposals = useAiProposals(canReview);
  const [tabRaw, setTab] = useUrlState("tab", "drafts");
  // Without manage_rules the AI reviewer's only tab is the proposals.
  const tab = canReview && (tabRaw === "ai" || !canManage) ? "ai" : "drafts";
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
  const newDraft = canManage && tab === "drafts" ? <Button onClick={() => setSelected("new")}>New draft</Button> : undefined;
  if (loading) return <Skeleton height={240} />;
  if (!canManage && !canReview) {
    return (
      <EmptyState
        title="Rule drafts need the manage-rules permission"
        detail="Ask an administrator for the manage-rules permission to write and publish rule drafts."
        ghost="table"
        action={<span className="inline-flex flex-wrap items-center justify-center gap-2"><RequestAccessButton resource="rules" action="edit" variant="primary" size="md" label="Request manage-rules access" /><Button variant="secondary" render={<Link href="/rules">Back to rules</Link>} /></span>}
      />
    );
  }
  const tabs = (
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={[
        ...(canManage ? [{ value: "drafts", label: "Drafts", content: null, count: q.data?.length }] : []),
        ...(canReview ? [{ value: "ai", label: "Proposed by AI", content: null, count: proposals.data?.total }] : []),
      ]}
    />
  );
  const header = (
    <PageHeader
      title="Rule drafts"
      meta={tab === "ai"
        ? "Match rules the AI proposed from steward corrections. Approve one to add it to the match rules, or reject it with a reason."
        : "A draft is a rule that does not run yet. Dry run it on real data, then publish it to run on every analysis."}
      actions={<><Button variant="secondary" render={<Link href="/rules">Back to rules</Link>} />{newDraft}</>}
    />
  );
  if (tab === "ai") return <ExplorerPage header={header} filterBar={tabs} table={<AiProposals />} />;
  return (
    <>
      <ExplorerPage
        header={header}
        filterBar={canReview ? tabs : undefined}
        state={asyncStateOf(q, () => items.length === 0, true)}
        emptyProps={{ title: "No drafts", detail: "Start a draft here, or from New rule on the rules page.", ghost: "table", action: newDraft ?? <Button variant="secondary" render={<Link href="/rules">Open rules</Link>} /> }}
        errorProps={{ error: q.error, onRetry: () => q.refetch() }}
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

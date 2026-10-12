"use client";

/** Rules › Drafts: AI-assisted rule drafts saved from the New rule drawer. */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Mono } from "@/design";
import { getRuleDrafts, type RuleDraft } from "@/lib/api/rules";
import { formatDate } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";

export default function RuleDraftsPage() {
  const q = useQuery({ queryKey: ["rule-drafts"], queryFn: getRuleDrafts });
  const columns = useMemo<ColumnDef<RuleDraft>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => { const m = row.original.domain.replace("dq_rule:", ""); return <Link href={`/objects/${m}`} className="underline">{m}</Link>; } },
    { id: "rule", header: "Rule", cell: ({ row }) => <Mono>{String(row.original.proposed_rule.id ?? row.original.proposed_rule.rule_id ?? "—")}</Mono> },
    { id: "why", header: "Why", cell: ({ row }) => row.original.rationale ?? "—" },
    { id: "at", header: "Saved", cell: ({ row }) => formatDate(row.original.created_at, "date") },
  ], []);
  const items = q.data ?? [];
  return (
    <ExplorerPage
      toolbarEnd={<Button variant="secondary" render={<Link href="/rules">Back to rules</Link>} />}
      state={q.isLoading ? "loading" : isListFailure(q) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No drafts", detail: "Drafts appear when a steward starts a rule and has not published it yet", ghost: "table", action: <Button variant="secondary" render={<Link href="/rules">Open rules</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
    />
  );
}

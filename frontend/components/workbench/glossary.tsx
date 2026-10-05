"use client";

/**
 * Glossary: the business names and definitions behind SAP fields, by domain,
 * with the rules each term governs. A drawer shows the term; its page edits
 * the definition and dependents.
 */

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { copyToClipboard } from "@/components/meridian/actions";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FieldChip, FilterBar, KeyValue, PageHeader,
  StatusBadge, TableSkeleton, Tally, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { useUrlState } from "@/hooks/use-url-state";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { relativeTime } from "@/lib/format";
import type { GlossaryTermSummary } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const label = (s: string) => { const t = s.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const TermStatus = ({ status }: { status: string }) => (
  <StatusBadge status={status === "active" ? "ok" : status === "under_review" ? "medium" : "idle"}>{status === "active" ? "Approved" : label(status)}</StatusBadge>
);

const columns: ColumnDef<GlossaryTermSummary, unknown>[] = [
  {
    id: "term", header: "Term", meta: meta({ sticky: "start", width: 280 }),
    cell: ({ row }) => (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main">{row.original.business_name}</span>
        <span className="ui-cell-stack__sub"><FieldChip table={row.original.sap_table} field={row.original.sap_field} /></span>
      </span>
    ),
  },
  { id: "domain", header: "Domain", meta: meta({ width: 140 }), cell: ({ row }) => label(row.original.domain) },
  { id: "status", header: "Status", meta: meta({ width: 140 }), cell: ({ row }) => <TermStatus status={row.original.status} /> },
  { id: "s4", header: "S/4HANA mandatory", meta: meta({ width: 140 }), cell: ({ row }) => (row.original.mandatory_for_s4hana ? "Yes" : "") },
  { id: "rules", header: "Rules", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => row.original.linked_rules_count },
  { id: "drafted", header: "Definition", meta: meta({ width: 150 }), cell: ({ row }) => (row.original.ai_drafted ? "AI draft" : "Steward") },
  { id: "reviewed", header: "Reviewed", meta: meta({ width: 120 }), cell: ({ row }) => (row.original.last_reviewed_at ? relativeTime(row.original.last_reviewed_at) : <span className="ui-micro">Never</span>) },
];

export function GlossarySurface() {
  const [domain, setDomain] = useUrlState("domain", "all");
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.trim());
  const drawer = useDrawerParam("term");
  const q = useQuery({
    queryKey: ["glossary.terms", { domain, search: term }],
    queryFn: () => getGlossaryTerms({ per_page: 200, domain: domain === "all" ? undefined : domain, search: term || undefined }),
  });
  const terms = useMemo(() => q.data?.terms ?? [], [q.data]);
  const total = q.data?.total ?? terms.length;
  const domains = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of terms) c[t.domain] = (c[t.domain] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [terms]);
  const active = terms.filter((t) => t.status === "active").length;
  const review = terms.filter((t) => t.status === "under_review").length;
  const termsLinked = terms.filter((t) => t.linked_rules_count > 0).length;
  const linked = terms.reduce((a, t) => a + t.linked_rules_count, 0);
  const selected = drawer.value ? terms.find((t) => t.id === drawer.value) ?? null : null;
  const narrowed = Boolean(search || domain !== "all");

  return (
    <div className="ui-page">
      <PageHeader
        title="Glossary"
        summary="The business name and definition behind each SAP field, and the rules that depend on it."
        actions={<Link href="/relationships" className="ui-link">Open the relationship graph</Link>}
      />
      <Tally level={2} label="Glossary" figures={[
        { label: "Terms", value: q.isLoading ? null : total, loading: q.isLoading, verdict: `Across ${domains.length} domain${domains.length === 1 ? "" : "s"}.`, href: "/glossary" },
        { label: "Linked to checks", value: q.isLoading ? null : termsLinked, loading: q.isLoading, verdict: termsLinked ? `${linked} rules depend on them.` : "No terms tied to checks yet.", href: "/glossary" },
        { label: "Under review", value: q.isLoading ? null : review, loading: q.isLoading, tone: review ? "warning" : undefined, verdict: review ? "Waiting for a steward to approve." : "Nothing waiting for approval.", href: "/glossary" },
        { label: "Approved", value: q.isLoading ? null : active, loading: q.isLoading, verdict: active ? "Definitions in force." : "No definitions approved yet.", href: "/glossary" },
      ]} />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search terms" }}
        onClear={narrowed ? () => { setSearch(""); setDomain("all"); } : undefined}
      >
        <Chip selected={domain === "all"} onClick={() => setDomain("all")}>All domains<span className="ui-chip-count">{total}</span></Chip>
        {domains.map(([d, n]) => (
          <Chip key={d} selected={domain === d} onClick={() => setDomain(d)}>{label(d)}<span className="ui-chip-count">{n}</span></Chip>
        ))}
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={8} label="Loading the glossary" />
        : q.error ? <Banner tone="danger" title="The glossary could not be read">{(q.error as Error).message}</Banner>
        : terms.length ? (
          <DataTable columns={columns} data={terms} getRowId={(t) => t.id} onRowActivate={(t) => drawer.open(t.id)} ariaLabel="Glossary terms" maxHeight="60vh" />
        ) : (
          <EmptyState>
            {narrowed ? "No terms match these filters." : "The glossary is empty. The glossary seed builds terms from the rule library, and stewards name, define and approve them here."}
          </EmptyState>
        )}
      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Term details"
        header={selected ? (
          <div className="ui-drawer-head">
            <TermStatus status={selected.status} />
            <h2 className="ui-drawer-head__title">{selected.business_name}</h2>
          </div>
        ) : null}>
        {selected ? (
          <div className="ui-detail">
            <KeyValue rows={[
              { k: "Domain", v: label(selected.domain) },
              { k: "SAP field", v: <FieldChip table={selected.sap_table} field={selected.sap_field} /> },
              { k: "Technical name", v: selected.technical_name, mono: true },
              { k: "Mandatory for S/4HANA", v: selected.mandatory_for_s4hana ? "Yes" : "No" },
              { k: "Rules linked", v: selected.linked_rules_count },
              { k: "Definition", v: selected.ai_drafted ? "AI draft, waiting for a steward" : "Written by a steward" },
              { k: "Last reviewed", v: selected.last_reviewed_at ? relativeTime(selected.last_reviewed_at) : "Never" },
              { k: "Review cycle", v: `${selected.review_cycle_days} days` },
            ]} />
            <div className="ui-page-header__actions">
              <Link href={`/glossary/${selected.id}`} className="ui-link">Open the term</Link>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(selected.id, "Term ID copied")}>Copy term ID</Button>
            </div>
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

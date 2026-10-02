"use client";

/**
 * Workbench → Glossary: the business names and definitions behind SAP fields,
 * by domain, with the rules each term governs. A drawer shows the term; its
 * page edits the definition and dependents.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Banner, Button, Chip, DataTable, Drawer, EmptyState, Input, KpiRail, Stack, Stat, Text, useDrawerParam, type AuroraColumnMeta } from "@/components/aurora";
import { copyToClipboard } from "@/components/meridian/actions";
import { useUrlState } from "@/hooks/use-url-state";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { relativeTime } from "@/lib/format";
import type { GlossaryTermSummary } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const label = (s: string) => s.replace(/_/g, " ");

export function GlossarySurface() {
  const [domain, setDomain] = useUrlState("domain", "all");
  const [search, setSearch] = useState("");
  const drawer = useDrawerParam("term");
  const q = useQuery({
    queryKey: ["glossary.terms", { domain, search }],
    queryFn: () => getGlossaryTerms({ per_page: 200, domain: domain === "all" ? undefined : domain, search: search.trim() || undefined }),
  });
  const terms = useMemo(() => q.data?.terms ?? [], [q.data]);
  const total = q.data?.total ?? terms.length;
  const domains = useMemo(() => { const c: Record<string, number> = {}; for (const t of terms) c[t.domain] = (c[t.domain] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); }, [terms]);
  const active = terms.filter((t) => t.status === "active").length;
  const review = terms.filter((t) => t.status === "under_review").length;
  const linked = terms.reduce((a, t) => a + t.linked_rules_count, 0);
  const selected = drawer.value ? terms.find((t) => t.id === drawer.value) ?? null : null;

  const columns = useMemo<ColumnDef<GlossaryTermSummary, unknown>[]>(() => [
    { id: "term", header: "Term", meta: meta({ sticky: "start", width: 260 }), cell: ({ row }) => (
      <span><strong>{row.original.business_name}</strong><Text variant="text-micro" tone="muted" as="div" className="aurora-number">{row.original.sap_table}.{row.original.sap_field}</Text></span>) },
    { id: "domain", header: "Domain", meta: meta({ width: 130 }), cell: ({ row }) => row.original.domain },
    { id: "status", header: "Status", meta: meta({ width: 130 }), cell: ({ row }) => <Chip tone={row.original.status === "active" ? "success" : "warning"}>{label(row.original.status)}</Chip> },
    { id: "s4", header: "S/4 mandatory", meta: meta({ width: 120 }), cell: ({ row }) => (row.original.mandatory_for_s4hana ? "yes" : "—") },
    { id: "rules", header: "Rules", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => row.original.linked_rules_count },
    { id: "drafted", header: "Definition", meta: meta({ width: 120 }), cell: ({ row }) => (row.original.ai_drafted ? <Chip tone="info">AI draft</Chip> : "steward") },
    { id: "reviewed", header: "Reviewed", meta: meta({ width: 110 }), cell: ({ row }) => (row.original.last_reviewed_at ? relativeTime(row.original.last_reviewed_at) : "never") },
  ], []);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Terms" value={total} />
        <Stat label="Approved" value={active} tone={active ? "success" : "neutral"} />
        <Stat label="Under review" value={review} tone={review ? "warning" : "neutral"} />
        <Stat label="Rules linked" value={linked} />
        <Stat label="Domains" value={domains.length} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        <Chip selected={domain === "all"} onClick={() => setDomain("all")}>All · {total}</Chip>
        {domains.map(([d, n]) => <Chip key={d} selected={domain === d} onClick={() => setDomain(d)}>{d} · {n}</Chip>)}
        <span style={{ flex: 1 }} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search terms…" aria-label="Search terms" style={{ width: 220 }} />
        <Link href="/relationships" className="aurora-link">Relationship graph →</Link>
      </Stack>
      {q.isLoading ? <Text tone="muted">Reading the glossary.</Text>
        : q.error ? <Banner tone="danger" title="The glossary could not be read">{(q.error as Error).message}</Banner>
        : terms.length ? <DataTable columns={columns} data={terms} getRowId={(t) => t.id} onRowActivate={(t) => drawer.open(t.id)} ariaLabel="Glossary terms" maxHeight="60vh" />
        : <EmptyState title={search || domain !== "all" ? "No terms match." : "The glossary is empty."} body="The glossary seed builds terms from the rule library; stewards name, define and approve them here." />}
      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Term details"
        header={selected ? <Stack direction="row" gap={2} align="center"><Chip tone={selected.status === "active" ? "success" : "warning"}>{label(selected.status)}</Chip><Text variant="text-lead">{selected.business_name}</Text></Stack> : null}>
        {selected ? (
          <Stack gap={4}>
            <table className="aurora-exec__table"><tbody>
              {([["Domain", selected.domain], ["SAP table", selected.sap_table], ["Field", selected.sap_field], ["Technical name", selected.technical_name],
                ["Mandatory for S/4HANA", selected.mandatory_for_s4hana ? "yes" : "no"], ["Rules linked", String(selected.linked_rules_count)],
                ["Definition", selected.ai_drafted ? "AI draft, awaiting a steward" : "steward-written"],
                ["Last reviewed", selected.last_reviewed_at ? relativeTime(selected.last_reviewed_at) : "never"], ["Review cycle", `${selected.review_cycle_days} days`]] as [string, string][])
                .map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}
            </tbody></table>
            <Stack direction="row" gap={2} wrap>
              <Link href={`/glossary/${selected.id}`} className="aurora-link">Open the term: definition, approved values, dependents →</Link>
            </Stack>
            <Stack direction="row" gap={2} wrap>
              <Button variant="ghost" onClick={() => copyToClipboard(selected.id, "Term ID copied")}>Copy term ID</Button>
            </Stack>
          </Stack>
        ) : null}
      </Drawer>
    </Stack>
  );
}

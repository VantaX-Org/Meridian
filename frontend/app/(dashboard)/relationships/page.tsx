"use client";

/**
 * Relationships: record-to-record links between master data domains. The
 * matrix counts links from each domain (rows) to each domain (columns); the
 * register lists every link with its keys.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, Button, DataTable, EmptyState, FilterBar, Metric, MetricStrip, PageHeader, SectionCard, TableSkeleton,
  type AuroraColumnMeta,
} from "@/components/ui-core";
import { downloadCsv } from "@/components/meridian/actions";
import { getRelationships } from "@/lib/api/relationships";
import type { RecordRelationship } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;

const columns: ColumnDef<RecordRelationship, unknown>[] = [
  { id: "from", header: "From", meta: meta({ width: 200 }),
    cell: ({ row }) => <span className="ui-cell-stack"><span className="ui-cell-stack__main">{row.original.from_domain}</span><span className="ui-cell-stack__sub ui-mono">{row.original.from_key}</span></span> },
  { id: "to", header: "To", meta: meta({ width: 200 }),
    cell: ({ row }) => <span className="ui-cell-stack"><span className="ui-cell-stack__main">{row.original.to_domain}</span><span className="ui-cell-stack__sub ui-mono">{row.original.to_key}</span></span> },
  { id: "type", header: "Type", accessorFn: (r) => r.relationship_type.replace(/_/g, " ") },
  { id: "source", header: "Source", meta: meta({ width: 110 }), accessorFn: (r) => (r.ai_inferred ? "Inferred" : "SAP") },
  { id: "found", header: "Found", meta: meta({ width: 120, numeric: true }), accessorFn: (r) => r.discovered_at,
    cell: ({ row }) => new Date(row.original.discovered_at).toLocaleDateString() },
  { id: "active", header: "State", meta: meta({ width: 100 }), accessorFn: (r) => (r.active ? "Active" : "Inactive") },
];

export default function RelationshipsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["relationships.list"], queryFn: () => getRelationships({}) });
  const [q, setQ] = useState("");

  const rels = useMemo(() => data?.relationships ?? [], [data]);
  const total = data?.total ?? rels.length;

  // Domains ordered by how many links touch them; the matrix reads in that order.
  const { domains, cell } = useMemo(() => {
    const touch = new Map<string, number>();
    const pairs = new Map<string, number>();
    for (const r of rels) {
      touch.set(r.from_domain, (touch.get(r.from_domain) ?? 0) + 1);
      touch.set(r.to_domain, (touch.get(r.to_domain) ?? 0) + 1);
      const k = `${r.from_domain}\u0000${r.to_domain}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    return {
      domains: [...touch.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
      cell: (from: string, to: string) => pairs.get(`${from}\u0000${to}`) ?? 0,
    };
  }, [rels]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rels.filter((r) => [r.from_domain, r.from_key, r.to_domain, r.to_key, r.relationship_type].some((v) => v.toLowerCase().includes(s))) : rels;
  }, [rels, q]);

  const inferred = rels.filter((r) => r.ai_inferred).length;
  const inactive = rels.filter((r) => !r.active).length;
  const types = new Set(rels.map((r) => r.relationship_type)).size;

  const exportCsv = () => downloadCsv("meridian-relationships.csv", rels.map((r) => ({
    from_domain: r.from_domain, from_key: r.from_key, to_domain: r.to_domain, to_key: r.to_key,
    type: r.relationship_type, discovered_at: r.discovered_at, inferred: r.ai_inferred, active: r.active,
  })));

  return (
    <div className="ui-page">
      <PageHeader
        title="Relationships"
        summary={isLoading || error ? undefined
          : `${total.toLocaleString()} links between ${domains.length} domains, of ${types} relationship types. ${inactive ? `${inactive.toLocaleString()} inactive.` : ""}`}
        actions={rels.length ? <Button variant="secondary" onClick={exportCsv}>Export CSV</Button> : undefined}
      />

      {isLoading ? <TableSkeleton rows={8} label="Loading relationships" />
        : error ? <Banner tone="danger" title="Relationships could not be read">{(error as Error).message}</Banner>
        : !rels.length ? <EmptyState>No links recorded yet. Links appear once match and merge or an SAP sync relates two records.</EmptyState>
        : (
          <>
            <MetricStrip label="Relationship figures">
              <Metric label="Domains" value={domains.length} />
              <Metric label="Links" value={total.toLocaleString()} />
              <Metric label="Inferred" value={inferred.toLocaleString()} />
              <Metric label="From SAP" value={(rels.length - inferred).toLocaleString()} />
              <Metric label="Inactive" value={inactive.toLocaleString()} />
            </MetricStrip>

            <SectionCard title="Links by domain" meta="Rows link to columns" flush>
              <div className="ui-matrix-scroll">
                <table className="ui-matrix">
                  <thead>
                    <tr><th scope="col">From</th>{domains.map((d) => <th key={d} scope="col">{d}</th>)}</tr>
                  </thead>
                  <tbody>
                    {domains.map((from) => (
                      <tr key={from}>
                        <th scope="row">{from}</th>
                        {domains.map((to) => {
                          const n = cell(from, to);
                          return <td key={to}><span>{n ? n.toLocaleString() : ""}</span></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <FilterBar search={{ value: q, onChange: setQ, placeholder: "Search domain, key or type" }} />
            <SectionCard title="All links" meta={visible.length === rels.length && rels.length < total
              ? `First ${rels.length.toLocaleString()} of ${total.toLocaleString()}` : `${visible.length.toLocaleString()} shown`} flush>
              <div className="ui-table-stacked"><DataTable columns={columns} data={visible} getRowId={(r) => r.id} ariaLabel="Relationships" maxHeight="60vh"
                         empty={<EmptyState>No links match this search.</EmptyState>} /></div>
            </SectionCard>
          </>
        )}
    </div>
  );
}

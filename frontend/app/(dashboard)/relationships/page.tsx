"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getRelationships } from "@/lib/api/relationships";
import { downloadCsv } from "@/components/meridian/actions";
import type { RecordRelationship } from "@/types/api";

interface NodeRow {
  id: string;
  label: string;
  count: number;
  inbound: number;
  outbound: number;
}

export default function RelationshipsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["relationships.list"],
    queryFn: () => getRelationships({}),
  });

  const relationships: RecordRelationship[] = data?.relationships ?? [];
  const total = data?.total ?? relationships.length;

  const nodes = useMemo<NodeRow[]>(() => {
    const map = new Map<string, NodeRow>();
    const touch = (domain: string) => {
      const id = domain;
      if (!map.has(id)) {
        map.set(id, { id, label: domain, count: 0, inbound: 0, outbound: 0 });
      }
      return map.get(id)!;
    };
    for (const r of relationships) {
      const from = touch(r.from_domain);
      const to = touch(r.to_domain);
      from.outbound += 1;
      to.inbound += 1;
      from.count += 1;
      to.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [relationships]);

  const aiInferred = relationships.filter((r) => r.ai_inferred).length;
  const broken = relationships.filter((r) => !r.active).length;
  const types = new Set(relationships.map((r) => r.relationship_type)).size;

  if (isLoading) {
    return (
      <>
        <PageHead title="Relationships" route="Govern · /relationships" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Relationships" route="Govern · /relationships" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/relationships</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Relationships"
        route="Govern · /relationships"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{nodes.length} entities</strong> linked by{" "}
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} relationships</strong> across{" "}
            <strong>{types}</strong> types.{" "}
            {broken > 0 && (
              <>
                <strong style={{ color: "var(--mn-neg)" }}>{broken} inactive</strong>.
              </>
            )}
          </>
        }
        actions={
          <button
            type="button"
            className="mn-btn mn-btn-ghost"
            onClick={() =>
              downloadCsv(
                "meridian-relationships.csv",
                relationships.map((r) => ({
                  from_domain: r.from_domain,
                  from_key: r.from_key,
                  to_domain: r.to_domain,
                  to_key: r.to_key,
                  type: r.relationship_type,
                  discovered_at: r.discovered_at,
                  inferred: r.ai_inferred,
                  active: r.active,
                })),
              )
            }
          >
            Export
          </button>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Entities" value={nodes.length} />
        <KPI label="Links" value={total} tone="pos" />
        <KPI label="Auto-inferred" value={aiInferred} hint="discovered" />
        <KPI label="Inactive" value={broken} tone={broken > 0 ? "neg" : "pos"} />
      </div>

      <SectionHeader title="Entity map" caption="Domains and how often they are linked" />
      <div className="mn-card" style={{ padding: "16px", marginBottom: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {nodes.map((n) => {
            const max = Math.max(...nodes.map((x) => x.count), 1);
            const pct = (n.count / max) * 100;
            return (
              <div
                key={n.id}
                style={{ display: "grid", gridTemplateColumns: "160px 1fr 120px", alignItems: "center", gap: 14 }}
              >
                <span style={{ fontWeight: 600, color: "var(--mn-ink-900)" }}>{n.label}</span>
                <div style={{ height: 8, background: "rgba(15,23,42,0.05)", borderRadius: 4, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, var(--mn-primary), var(--mn-primary-600))",
                      borderRadius: 4,
                      transition: "width 900ms cubic-bezier(.2,.7,.2,1)",
                    }}
                  />
                </div>
                <span
                  className="mn-tabular"
                  style={{
                    font: "600 13px/1 'Inter Tight'",
                    color: "var(--mn-ink-900)",
                    textAlign: "right",
                  }}
                >
                  {n.outbound} out · {n.inbound} in
                </span>
              </div>
            );
          })}
          {nodes.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--mn-ink-400)", padding: 16 }}>
              No relationships recorded yet.
            </div>
          )}
        </div>
      </div>

      <SectionHeader title="All relationships" caption={`${total} record-to-record links`} />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>From</th>
                <th></th>
                <th>To</th>
                <th>Type</th>
                <th>Discovered</th>
                <th>Source</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {relationships.slice(0, 100).map((r) => (
                <tr key={r.id}>
                  <td style={{ paddingLeft: 20 }}>
                    <div>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)" }}>{r.from_domain}</div>
                      <div
                        className="mn-tabular"
                        style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)", marginTop: 2 }}
                      >
                        {r.from_key}
                      </div>
                    </div>
                  </td>
                  <td style={{ color: "var(--mn-ink-300)" }}>→</td>
                  <td>
                    <div>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)" }}>{r.to_domain}</div>
                      <div
                        className="mn-tabular"
                        style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)", marginTop: 2 }}
                      >
                        {r.to_key}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className="mn-tabular"
                      style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-primary-700)" }}
                    >
                      {r.relationship_type}
                    </span>
                  </td>
                  <td className="mn-tabular" style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                    {new Date(r.discovered_at).toLocaleDateString()}
                  </td>
                  <td>
                    {r.ai_inferred ? (
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: "var(--mn-primary-50)",
                          color: "var(--mn-primary-700)",
                          font: "700 9.5px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.1em",
                        }}
                      >
                        INFERRED
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "2px 6px",
                          borderRadius: 3,
                          background: "rgba(15,23,42,0.06)",
                          color: "var(--mn-ink-500)",
                          font: "700 9.5px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.1em",
                        }}
                      >
                        SAP
                      </span>
                    )}
                  </td>
                  <td>
                    {r.active ? (
                      <span style={{ color: "var(--mn-pos)" }}>✓</span>
                    ) : (
                      <span style={{ color: "var(--mn-neg)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

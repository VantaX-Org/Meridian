"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader, ModChip } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getFieldMappings, type FieldMapping } from "@/lib/api/field-mappings";
import { SearchField, matchesSearch } from "@/components/meridian/controls";

export default function SettingsFieldMappingPage() {
  const [moduleFilter, setModuleFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["field-mappings", { module: moduleFilter }],
    queryFn: () => getFieldMappings({ module: moduleFilter ?? undefined }),
  });

  // All hooks must run before any conditional return.
  const mappings: FieldMapping[] = data?.mappings ?? [];

  const modules = useMemo(() => {
    const map = new Map<string, { canonical: number; mapped: number }>();
    for (const m of mappings) {
      const cur = map.get(m.module) ?? { canonical: 0, mapped: 0 };
      cur.canonical += 1;
      if (m.is_mapped) cur.mapped += 1;
      map.set(m.module, cur);
    }
    return Array.from(map.entries());
  }, [mappings]);

  if (isLoading) {
    return (
      <>
        <PageHead title="Field Mapping" route="Settings · /settings/field-mapping" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Field Mapping" route="Settings · /settings/field-mapping" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/field-mappings</code>.
        </div>
      </>
    );
  }

  const total = data?.total ?? mappings.length;
  const selfServe = data?.self_service_enabled ?? false;
  const mapped = mappings.filter((m) => m.is_mapped).length;
  const unmapped = mappings.length - mapped;

  return (
    <>
      <PageHead
        title="Field Mapping"
        route="Settings · /settings/field-mapping"
        sub={
          <>
            <strong style={{ color: "var(--mn-pos)" }}>
              {mapped} of {total}
            </strong>{" "}
            canonical fields mapped ({total ? Math.round((mapped / total) * 100) : 0}%) across {modules.length} modules.
            {!selfServe && (
              <>
                {" "}<strong style={{ color: "var(--mn-warn)" }}>Self-service mapping is disabled</strong>.
              </>
            )}
          </>
        }
        actions={
          <SearchField value={search} onChange={setSearch} placeholder="Filter fields…" />
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Canonical fields" value={total} hint={`${modules.length} modules`} />
        <KPI
          label="Mapped"
          value={mapped}
          hint={total ? `${Math.round((mapped / total) * 100)}% coverage` : ""}
          tone="pos"
        />
        <KPI label="Unmapped" value={unmapped} tone={unmapped > 0 ? "warn" : "pos"} />
        <KPI label="Self-service" value={selfServe ? "ON" : "OFF"} tone={selfServe ? "pos" : "warn"} />
      </div>

      <SectionHeader title="Coverage by module" caption="Mapped / canonical fields per module" />
      <div className="mn-card mn-card-pad" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {modules.map(([name, m]) => {
            const pct = (m.mapped / Math.max(m.canonical, 1)) * 100;
            const col = pct >= 95 ? "var(--mn-pos)" : pct >= 85 ? "var(--mn-primary)" : "var(--mn-warn)";
            return (
              <div
                key={name}
                style={{ display: "grid", gridTemplateColumns: "200px 1fr 100px", alignItems: "center", gap: 16 }}
              >
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: 0,
                    padding: 0,
                    textAlign: "left",
                    fontWeight: 600,
                    color: moduleFilter === name ? "var(--mn-primary-700)" : "var(--mn-ink-900)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                  onClick={() => setModuleFilter(moduleFilter === name ? null : name)}
                >
                  {name}
                </button>
                <div style={{ height: 10, background: "rgba(15,23,42,0.05)", borderRadius: 5, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: col,
                      borderRadius: 5,
                      transition: "width 900ms cubic-bezier(.2,.7,.2,1)",
                    }}
                  />
                </div>
                <span
                  className="mn-tabular"
                  style={{
                    font: "500 12.5px/1 'JetBrains Mono', monospace",
                    color: "var(--mn-ink-700)",
                    textAlign: "right",
                    letterSpacing: "0.04em",
                  }}
                >
                  {m.mapped} / {m.canonical}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <SectionHeader
        title={moduleFilter ? `Mappings · ${moduleFilter}` : "All mappings"}
        caption={
          search.trim()
            ? `${mappings.filter((m) => matchesSearch(m, search)).length} of ${mappings.length} fields match`
            : `${mappings.length} fields`
        }
      />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Module</th>
                <th>Standard field</th>
                <th>Customer field</th>
                <th>Type</th>
                <th>Mapped</th>
              </tr>
            </thead>
            <tbody>
              {mappings.filter((m) => matchesSearch(m, search)).slice(0, 200).map((m) => (
                <tr key={m.id}>
                  <td style={{ paddingLeft: 20 }}>
                    <ModChip>{m.module}</ModChip>
                  </td>
                  <td>
                    <div
                      className="mn-tabular"
                      style={{ font: "600 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-700)" }}
                    >
                      {m.standard_field}
                    </div>
                    {m.standard_label && (
                      <div style={{ fontSize: 11.5, color: "var(--mn-ink-400)", marginTop: 2 }}>
                        {m.standard_label}
                      </div>
                    )}
                  </td>
                  <td>
                    {m.customer_field ? (
                      <span
                        className="mn-tabular"
                        style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-primary-700)" }}
                      >
                        {m.customer_field}
                      </span>
                    ) : (
                      <span style={{ color: "var(--mn-ink-300)" }}>—</span>
                    )}
                  </td>
                  <td
                    className="mn-tabular"
                    style={{ font: "500 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                  >
                    {m.data_type}
                  </td>
                  <td>
                    {m.is_mapped ? (
                      <span style={{ color: "var(--mn-pos)" }}>✓</span>
                    ) : (
                      <span style={{ color: "var(--mn-warn)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {mappings.filter((m) => matchesSearch(m, search)).length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    {mappings.length === 0 ? "No mappings found." : "No fields match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

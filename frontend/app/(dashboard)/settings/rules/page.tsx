"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader, ModChip } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getRules, getRulesSummary, updateRule, type Rule } from "@/lib/api/rules";
import { SearchField, matchesSearch } from "@/components/meridian/controls";

const CATEGORY_LABEL: Record<string, string> = {
  ecc: "ECC",
  successfactors: "SuccessFactors",
  warehouse: "Warehouse",
};

const SEVERITY_TONE: Record<string, { bg: string; fg: string }> = {
  critical: { bg: "var(--mn-neg-bg)",     fg: "var(--mn-neg)" },
  high:     { bg: "var(--mn-warn-bg)",    fg: "var(--mn-warn)" },
  medium:   { bg: "var(--mn-primary-50)", fg: "var(--mn-primary-700)" },
  low:      { bg: "rgba(15,23,42,0.06)",  fg: "var(--mn-ink-500)" },
  info:     { bg: "rgba(15,23,42,0.06)",  fg: "var(--mn-ink-500)" },
};

export default function SettingsRulesPage() {
  const qc = useQueryClient();
  const [category, setCategory] = useState<"all" | "ecc" | "successfactors" | "warehouse">("all");
  const [search, setSearch] = useState("");

  const summaryQ = useQuery({
    queryKey: ["rules.summary"],
    queryFn: getRulesSummary,
  });
  const rulesQ = useQuery({
    queryKey: ["rules.list", { category }],
    queryFn: () =>
      getRules({
        category: category === "all" ? undefined : category,
        limit: 200,
      }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateRule(id, { enabled }),
    onSuccess: (_d, vars) => {
      toast.success(vars.enabled ? "Rule enabled" : "Rule disabled");
      qc.invalidateQueries({ queryKey: ["rules.list"] });
      qc.invalidateQueries({ queryKey: ["rules.summary"] });
    },
    onError: () => toast.error("Could not update rule"),
  });

  // All hooks must run before any conditional return.
  const summary = summaryQ.data?.summary ?? [];
  const rules: Rule[] = rulesQ.data?.rules ?? [];
  const total = rulesQ.data?.total ?? rules.length;

  const totals = useMemo(() => {
    const t = { yaml: 0, hq: 0, enabled: 0, disabled: 0 };
    for (const r of rules) {
      if (r.source === "yaml") t.yaml++;
      else t.hq++;
      if (r.enabled) t.enabled++;
      else t.disabled++;
    }
    return t;
  }, [rules]);

  const summaryByCategory = useMemo(() => {
    const map = new Map<string, { count: number; enabled: number }>();
    for (const row of summary) {
      const cur = map.get(row.category) ?? { count: 0, enabled: 0 };
      cur.count += row.count;
      if (row.enabled) cur.enabled += row.count;
      map.set(row.category, cur);
    }
    return Array.from(map.entries());
  }, [summary]);

  if (summaryQ.isLoading || rulesQ.isLoading) {
    return (
      <>
        <PageHead title="Rules Engine" route="Settings · /settings/rules" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (summaryQ.error || rulesQ.error) {
    return (
      <>
        <PageHead title="Rules Engine" route="Settings · /settings/rules" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/rules</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Rules Engine"
        route="Settings · /settings/rules"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} rules</strong> ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{totals.yaml} built-in</strong>,{" "}
            <strong style={{ color: "var(--mn-primary-700)" }}>{totals.hq} custom</strong>,{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{totals.enabled} enabled</strong>.
          </>
        }
        actions={
          <SearchField value={search} onChange={setSearch} placeholder="Filter rules…" />
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Built-in rules" value={totals.yaml} hint="shipped" />
        <KPI label="Custom rules" value={totals.hq} hint="defined by your team" tone="pos" />
        <KPI label="Enabled" value={totals.enabled} tone="pos" />
        <KPI label="Disabled" value={totals.disabled} tone={totals.disabled > 0 ? "warn" : undefined} />
      </div>

      <div className="mn-segment" style={{ marginBottom: 14 }}>
        {(["all", "ecc", "successfactors", "warehouse"] as const).map((k) => (
          <button key={k} type="button" className={category === k ? "on" : ""} onClick={() => setCategory(k)}>
            {k === "all" ? "All" : CATEGORY_LABEL[k]}
          </button>
        ))}
      </div>

      <SectionHeader title="Categories" caption="Counts by source system" />
      <div className="mn-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", marginBottom: 18 }}>
        {summaryByCategory.map(([cat, t]) => (
          <div key={cat} className="mn-card mn-card-pad">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                className="mn-tabular"
                style={{
                  display: "inline-flex",
                  padding: "4px 9px",
                  borderRadius: 4,
                  background: "var(--mn-primary-50)",
                  color: "var(--mn-primary-700)",
                  font: "600 11.5px/1 'JetBrains Mono', monospace",
                  letterSpacing: "0.06em",
                }}
              >
                {CATEGORY_LABEL[cat] ?? cat}
              </span>
              <span
                className="mn-tabular"
                style={{
                  font: "600 22px/1 'Inter Tight'",
                  color: "var(--mn-ink-900)",
                  letterSpacing: "-0.02em",
                }}
              >
                {t.count}
              </span>
            </div>
            <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--mn-ink-500)" }}>
              {t.enabled} enabled · {t.count - t.enabled} disabled
            </p>
          </div>
        ))}
        {summaryByCategory.length === 0 && (
          <div className="mn-card mn-card-pad" style={{ color: "var(--mn-ink-400)", textAlign: "center" }}>
            No rules surfaced.
          </div>
        )}
      </div>

      <SectionHeader
        title="Rules"
        caption={
          search.trim()
            ? `${rules.filter((r) => matchesSearch(r, search)).length} of ${rules.length} match`
            : `${rules.length} of ${total}`
        }
      />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Rule</th>
                <th>Module</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Source</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {rules.filter((r) => matchesSearch(r, search)).map((r) => {
                const sev = SEVERITY_TONE[r.severity] ?? SEVERITY_TONE.info;
                return (
                  <tr key={r.id}>
                    <td style={{ paddingLeft: 20 }}>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)", fontSize: 13 }}>{r.name}</div>
                      {r.description && (
                        <div
                          style={{
                            font: "500 11.5px/1.4 'JetBrains Mono', monospace",
                            color: "var(--mn-ink-400)",
                            marginTop: 3,
                          }}
                        >
                          {r.description.length > 100 ? r.description.slice(0, 100) + "…" : r.description}
                        </div>
                      )}
                    </td>
                    <td><ModChip>{r.module}</ModChip></td>
                    <td
                      className="mn-tabular"
                      style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-700)" }}
                    >
                      {CATEGORY_LABEL[r.category] ?? r.category}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "3px 7px",
                          borderRadius: 4,
                          background: sev.bg,
                          color: sev.fg,
                          font: "700 9.5px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.1em",
                        }}
                      >
                        {r.severity.toUpperCase()}
                      </span>
                    </td>
                    <td
                      className="mn-tabular"
                      style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                    >
                      {r.source.toUpperCase()}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`mn-toggle ${r.enabled ? "on" : ""}`}
                        aria-pressed={r.enabled}
                        aria-label={r.enabled ? "Disable" : "Enable"}
                        onClick={() => toggle.mutate({ id: r.id, enabled: !r.enabled })}
                        disabled={toggle.isPending}
                      >
                        <span className="thumb" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rules.filter((r) => matchesSearch(r, search)).length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    No rules match this filter.
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

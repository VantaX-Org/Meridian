"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, StatusDot } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreH, SparklesIcon } from "@/components/meridian/icons";
import { getGlossaryTerms } from "@/lib/api/glossary";
import { copyToClipboard } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { GlossaryTermSummary } from "@/types/api";

const DOMAIN_COLORS: Record<string, { bg: string; fg: string }> = {
  Finance:      { bg: "var(--mn-primary-50)",    fg: "var(--mn-primary-700)" },
  Sales:        { bg: "rgba(124,58,237,0.12)",   fg: "#7C3AED" },
  Procurement:  { bg: "var(--mn-warn-bg)",       fg: "var(--mn-warn)" },
  HR:           { bg: "rgba(14,165,164,0.12)",   fg: "#0EA5A4" },
  Operations:   { bg: "rgba(236,72,153,0.10)",   fg: "#EC4899" },
  Logistics:    { bg: "rgba(20,184,166,0.12)",   fg: "#0D9488" },
  Quality:      { bg: "var(--mn-pos-bg)",        fg: "var(--mn-pos)" },
  IT:           { bg: "rgba(15,23,42,0.06)",     fg: "var(--mn-ink-500)" },
};
function domainPalette(name: string) {
  return DOMAIN_COLORS[name] ?? DOMAIN_COLORS.IT;
}

export default function GlossaryPage() {
  const [domain, setDomain] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["glossary.terms", { domain, search }],
    queryFn: () => getGlossaryTerms({
      per_page: 200,
      domain: domain === "all" ? undefined : domain,
      search: search.trim() || undefined,
    }),
  });

  const terms: GlossaryTermSummary[] = data?.terms ?? [];
  const selected = terms.find((t) => t.id === selectedId) ?? terms[0];
  const total = data?.total ?? terms.length;

  const facets = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of terms) {
      counts[t.domain] = (counts[t.domain] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [terms]);

  const approved = terms.filter((t) => t.status === "active").length;
  const draft = terms.filter((t) => t.status === "under_review").length;
  const linkedRules = terms.reduce((a, t) => a + t.linked_rules_count, 0);

  if (isLoading) {
    return (
      <>
        <PageHead title="Glossary" route="Govern · /glossary" sub="Loading terms…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Glossary" route="Govern · /glossary" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/glossary</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Glossary"
        route="Govern · /glossary"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} business terms</strong> across{" "}
            <strong style={{ color: "var(--mn-ink-700)" }}>{facets.length} domains</strong>.{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{approved} approved</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{draft} in draft</strong>.
          </>
        }
        actions={
          <>
            {searchOpen ? (
              <input
                autoFocus
                className="mn-input"
                style={{ width: 200 }}
                placeholder="Search terms…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearch("");
                    setSearchOpen(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="mn-btn mn-btn-ghost"
                onClick={() => setSearchOpen(true)}
              >
                Search
              </button>
            )}
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Total terms" value={total} hint={`${facets.length} domains`} />
        <KPI
          label="Approved"
          value={total ? `${Math.round((approved / total) * 100)}%` : "—"}
          hint={`${approved} of ${total}`}
          tone="pos"
        />
        <KPI label="Draft" value={draft} hint="awaiting review" tone="warn" />
        <KPI label="Linked to rules" value={linkedRules} hint={`across ${terms.length} terms`} tone="pos" />
      </div>

      <div className="mn-segment" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button" className={domain === "all" ? "on" : ""} onClick={() => setDomain("all")}>
          All <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>{total}</span>
        </button>
        {facets.map(([d, n]) => (
          <button key={d} type="button" className={domain === d ? "on" : ""} onClick={() => setDomain(d)}>
            {d} <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>{n}</span>
          </button>
        ))}
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            {terms.map((t) => {
              const tn = domainPalette(t.domain);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`mn-glossary-row ${t.id === selected?.id ? "active" : ""}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mn-glossary-term">{t.business_name}</div>
                    <div className="mn-glossary-def">
                      {t.sap_table}.{t.sap_field}
                    </div>
                  </div>
                  <div className="mn-glossary-meta">
                    <span
                      style={{
                        display: "inline-flex",
                        padding: "3px 8px",
                        borderRadius: 4,
                        background: tn.bg,
                        color: tn.fg,
                        font: "600 11px/1 'Inter'",
                      }}
                    >
                      {t.domain}
                    </span>
                    <div className="mn-glossary-counts">
                      <span>
                        <strong className="mn-tabular">{t.linked_rules_count}</strong> rules
                      </span>
                    </div>
                    <StatusDot status={t.status === "active" ? "healthy" : "in-review"} />
                  </div>
                </button>
              );
            })}
            {terms.length === 0 && (
              <div style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                No terms match this filter.
              </div>
            )}
          </div>
        </div>

        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          {selected ? (
            <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
              <div className="mn-detail-head">
                <div>
                  <div className="mn-eyebrow">Term · {selected.domain}</div>
                  <h3 className="mn-detail-title" style={{ marginTop: 6 }}>{selected.business_name}</h3>
                </div>
                <button
                  type="button"
                  className="mn-icon-btn"
                  aria-label="Copy term ID"
                  onClick={() => copyToClipboard(selected.id, "Term ID copied")}
                >
                  <MoreH size={14} />
                </button>
              </div>
              <div className="mn-detail-meta">
                <div><span className="k">SAP table</span><span className="v mn-tabular">{selected.sap_table}</span></div>
                <div><span className="k">Field</span><span className="v mn-tabular">{selected.sap_field}</span></div>
                <div><span className="k">Technical</span><span className="v mn-tabular">{selected.technical_name}</span></div>
                <div><span className="k">Mandatory S/4</span><span className="v">{selected.mandatory_for_s4hana ? "Yes" : "No"}</span></div>
                <div><span className="k">Last reviewed</span><span className="v mn-tabular">{selected.last_reviewed_at ? relativeTime(selected.last_reviewed_at) : "—"}</span></div>
                <div><span className="k">Cycle</span><span className="v mn-tabular">{selected.review_cycle_days}d</span></div>
              </div>
              <div className="mn-narrative" style={{ marginTop: 14, padding: 10 }}>
                <div className="ico"><SparklesIcon size={13} /></div>
                <div style={{ flex: 1, fontSize: 12.5, color: "var(--mn-ink-700)" }}>
                  Linked to <strong>{selected.linked_rules_count}</strong> data quality rule
                  {selected.linked_rules_count === 1 ? "" : "s"}. Open in glossary detail to edit definition + dependents.
                </div>
              </div>
              <div className="mn-detail-actions">
                <Link
                  href={`/glossary/${selected.id}`}
                  className="mn-btn mn-btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Open term
                </Link>
                <Link href="/relationships" className="mn-btn mn-btn-ghost">View graph</Link>
              </div>
            </div>
          ) : (
            <div className="mn-card mn-card-pad" style={{ color: "var(--mn-ink-400)" }}>
              No term selected.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

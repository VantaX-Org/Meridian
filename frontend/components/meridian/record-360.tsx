"use client";

/**
 * Record 360 — the one detail layout for a governed object (golden record,
 * glossary term): header, summary, then the same four sections in the same
 * order everywhere — where the data comes from (Sources), which value wins
 * (Survivorship), what is wrong with it now (Open findings) and how it got
 * here (History). Pages pass bodies; the layout owns order, labels and empty
 * states. Built on the Aurora ReportSurface (anchored nav + sections).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState, KpiRail, ReportSurface, Text, type ReportSurfaceSection } from "@/components/aurora";

export interface Record360Section {
  /** Overrides the default label ("Survivorship" → "Definition of record"). */
  label?: string;
  count?: number;
  /** Shown when `count` is 0. */
  empty?: string;
  loading?: boolean;
  body?: ReactNode;
}

export interface Record360Props {
  backHref: string;
  backLabel: string;
  eyebrow: ReactNode;
  title: ReactNode;
  support?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
  /** Banner(s) above the sections — write-back guidance, drafts. */
  notice?: ReactNode;
  /** Stat tiles for the summary rail. */
  kpis?: ReactNode;
  sources: Record360Section;
  survivorship: Record360Section;
  findings: Record360Section;
  history: Record360Section;
  /** Object-specific sections, rendered between Open findings and History. */
  extra?: ReadonlyArray<ReportSurfaceSection>;
}

function section(id: string, label: string, s: Record360Section): ReportSurfaceSection {
  const note = s.loading ? "Loading…" : s.count === 0 || s.body == null ? (s.empty ?? "Nothing recorded yet.") : null;
  return {
    id,
    label: s.label ?? label,
    count: s.loading ? undefined : s.count,
    body: note ? <Text variant="text-small" tone="tertiary">{note}</Text> : s.body,
  };
}

export function Record360(p: Record360Props) {
  return (
    <div className="aurora-page">
      <Link href={p.backHref} className="aurora-link">← {p.backLabel}</Link>
      {p.notice}
      <ReportSurface
        eyebrow={p.eyebrow}
        title={p.title}
        support={p.support}
        chips={p.chips}
        actions={p.actions}
        navLabel="Record sections"
        sections={[
          ...(p.kpis ? [{ id: "summary", label: "Summary", body: <KpiRail>{p.kpis}</KpiRail> }] : []),
          section("sources", "Sources", p.sources),
          section("survivorship", "Survivorship", p.survivorship),
          section("findings", "Open findings", p.findings),
          ...(p.extra ?? []),
          section("history", "History", p.history),
        ]}
      />
    </div>
  );
}

export function Record360Loading({ what }: { what: string }) {
  return <EmptyState title={`Loading ${what}…`} />;
}

/* Plain tables in the Aurora register — the sections are short and read-only. */
export const th = "px-3 py-2 text-left font-medium text-[var(--aurora-fg-tertiary)]";
export const td = "px-3 py-1.5 border-t border-[var(--aurora-canvas-line)] align-top";

export function Record360Table({ head, children }: { head: ReadonlyArray<string>; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr>{head.map((h) => <th key={h} className={th}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Aurora Command Centre surface — WS6.
 *
 * The verse home of Meridian (Part IV, §11 of the spec). Answers the
 * five-second CIO test in one view:
 *
 *   • Verdict (§12 moment 01) — one sentence that tells the operator
 *     what happened, why it matters, what to do next. Halo tints by
 *     semantic; the headline DQS + critical + high sit in the inline
 *     KPI rail so there is never a "fetch another screen" step.
 *   • Inbox — Linear-style action queue. Top-priority findings only;
 *     J/K navigable via <DataTable>. Click row → drills to Workbench.
 *   • Trends — DQS history sparkline across the analysis window and a
 *     small-multiples module breakdown for density without clutter.
 *   • Issues — severity distribution for the current version, rendered
 *     as a compact bar chart keyed to status tokens.
 *
 * This module is pure view — props in, render out. The Command Centre
 * page wires <CommandCentreClient> around it with react-query.
 */

"use client";

import type { ReactNode } from "react";
import {
  ArrivalBanner,
  DataTable,
  type AuroraColumnMeta,
  EmptyState,
  KpiRail,
  Sparkline,
  Stack,
  Stat,
  Text,
  VerdictCard,
  type VerdictSemantic,
} from "@/components/aurora";
import type { ColumnDef } from "@tanstack/react-table";
import { clsx } from "../primitives/internal";

/* -------------------------------------------------------------- Types --- */

export interface CommandCentreVerdict {
  /** Eyebrow, e.g. "OPEN · 14" — renders above the sentence. */
  eyebrow?: ReactNode;
  /** The verdict sentence — the opinionated "here's what's happening". */
  sentence: ReactNode;
  /** Optional support line (e.g. affected business processes). */
  support?: ReactNode;
  semantic: VerdictSemantic;
}

export interface CommandCentreKpi {
  id: string;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: {
    value: number;
    unit?: string;
    direction: "up" | "down" | "flat";
    /** Override semantic — "up" for a good-count delta passes success. */
    semantic?: "success" | "danger" | "neutral";
  };
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  sparkline?: ReactNode;
}

export interface CommandCentreInboxItem {
  id: string;
  headline: string;
  module: string;
  severity: "critical" | "high" | "medium" | "low";
  /** Human-readable age, e.g. "3h ago". Host formats. */
  age: string;
  /** Count of records the finding affects. */
  affected: number;
}

/**
 * Type alias (not interface) so the `Record<string, string | number>`
 * constraint on <Sparkline>'s `TDatum` generic is satisfied — interfaces
 * don't match index signatures in strict mode.
 */
export type CommandCentreTrendPoint = {
  date: string;
  dqs: number;
};

export interface CommandCentreIssueBucket {
  severity: "critical" | "high" | "medium" | "low";
  count: number;
}

export interface CommandCentreProps {
  /** Shown at the top when truthy. Host owns dismiss state. */
  arrival?: {
    eyebrow?: ReactNode;
    title: ReactNode;
    body?: ReactNode;
    actions?: ReactNode;
    onDismiss?: () => void;
  };
  verdict: CommandCentreVerdict;
  /** KPI rail inside the verdict card. Capped at 4 per the spec. */
  kpis: ReadonlyArray<CommandCentreKpi>;
  /** Verdict action row (typically <Button> instances). */
  verdictActions?: ReactNode;
  /** Inbox items — keep this pre-filtered to the top 10 priorities. */
  inbox: ReadonlyArray<CommandCentreInboxItem>;
  onInboxActivate?: (item: CommandCentreInboxItem) => void;
  /** Trend sparkline window. */
  trend: ReadonlyArray<CommandCentreTrendPoint>;
  /** Issue buckets for the severity strip. Order is fixed. */
  issues: ReadonlyArray<CommandCentreIssueBucket>;
  className?: string;
}

/* --------------------------------------------------------------- View --- */

const SEVERITY_LABEL: Record<CommandCentreInboxItem["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const inboxColumns: ColumnDef<CommandCentreInboxItem, unknown>[] = [
  {
    id: "severity",
    header: "Severity",
    accessorKey: "severity",
    cell: ({ row }) => (
      <span
        className="aurora-command-centre__severity"
        data-severity={row.original.severity}
      >
        {SEVERITY_LABEL[row.original.severity]}
      </span>
    ),
    meta: { width: 96 } satisfies AuroraColumnMeta,
  },
  {
    id: "headline",
    header: "Finding",
    accessorKey: "headline",
    cell: ({ row }) => (
      <span className="aurora-command-centre__inbox-headline">
        {row.original.headline}
      </span>
    ),
  },
  {
    id: "module",
    header: "Module",
    accessorKey: "module",
    cell: ({ row }) => (
      <Text variant="text-small" tone="secondary" as="span">
        {row.original.module}
      </Text>
    ),
    meta: { width: 160 } satisfies AuroraColumnMeta,
  },
  {
    id: "affected",
    header: "Records",
    accessorKey: "affected",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.affected.toLocaleString()}
      </Text>
    ),
    meta: { width: 96, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
  {
    id: "age",
    header: "Age",
    accessorKey: "age",
    cell: ({ row }) => (
      <Text variant="text-small" tone="tertiary" as="span">
        {row.original.age}
      </Text>
    ),
    meta: { width: 72, align: "end" } satisfies AuroraColumnMeta,
  },
];

export function CommandCentre({
  arrival,
  verdict,
  kpis,
  verdictActions,
  inbox,
  onInboxActivate,
  trend,
  issues,
  className,
}: CommandCentreProps) {
  return (
    <div className={clsx("aurora-command-centre", className)}>
      {arrival ? (
        <ArrivalBanner
          eyebrow={arrival.eyebrow}
          title={arrival.title}
          body={arrival.body}
          actions={arrival.actions}
          onDismiss={arrival.onDismiss}
        />
      ) : null}

      <VerdictCard
        eyebrow={verdict.eyebrow}
        verdict={verdict.sentence}
        support={verdict.support}
        semantic={verdict.semantic}
        actions={verdictActions}
        metrics={
          kpis.length > 0 ? (
            <KpiRail>
              {kpis.map((kpi) => (
                <Stat
                  key={kpi.id}
                  label={kpi.label}
                  value={kpi.value}
                  unit={kpi.unit}
                  delta={kpi.delta}
                  tone={kpi.tone}
                  sparkline={kpi.sparkline}
                />
              ))}
            </KpiRail>
          ) : null
        }
      />

      <div className="aurora-command-centre__grid">
        <section
          className="aurora-command-centre__panel"
          aria-label="Inbox — priority findings"
        >
          <header className="aurora-command-centre__panel-head">
            <Stack direction="column" gap={1}>
              <Text variant="text-micro" tone="tertiary">
                Inbox
              </Text>
              <Text variant="text-lead">Priority findings</Text>
            </Stack>
            <Text variant="text-small" tone="tertiary" as="span">
              {inbox.length} open
            </Text>
          </header>
          <div className="aurora-command-centre__inbox">
            {inbox.length === 0 ? (
              <EmptyState
                title="No open findings"
                body="DQS is clean across every module — nothing to escalate."
              />
            ) : (
              <DataTable
                columns={inboxColumns}
                // `.slice()` peels the ReadonlyArray wrapper without
                // copying semantics — `DataTable` types its data as
                // mutable to match TanStack Table's signature, not
                // because it mutates.
                data={inbox.slice()}
                getRowId={(row) => row.id}
                onRowActivate={onInboxActivate}
                ariaLabel="Inbox — priority findings"
                maxHeight={360}
              />
            )}
          </div>
        </section>

        <section
          className="aurora-command-centre__panel"
          aria-label="Trends — DQS history"
        >
          <header className="aurora-command-centre__panel-head">
            <Stack direction="column" gap={1}>
              <Text variant="text-micro" tone="tertiary">
                Trends
              </Text>
              <Text variant="text-lead">DQS across the window</Text>
            </Stack>
            {trend.length > 0 ? (
              <Text variant="text-small" tone="tertiary" as="span" numeric>
                {trend[trend.length - 1]!.dqs.toFixed(1)} now
              </Text>
            ) : null}
          </header>
          <div className="aurora-command-centre__trend">
            {trend.length === 0 ? (
              <EmptyState
                title="No history yet"
                body="Trends appear once a second analysis version lands."
              />
            ) : (
              <Sparkline
                data={trend.slice()}
                xKey="date"
                yKey="dqs"
                height={96}
                width="100%"
                fill
                ariaLabel="DQS over time"
              />
            )}
          </div>
          <IssuesStrip issues={issues} />
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------- IssuesStrip (internal) */

function IssuesStrip({
  issues,
}: {
  issues: ReadonlyArray<CommandCentreIssueBucket>;
}) {
  const total = issues.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) {
    return null;
  }
  return (
    <div className="aurora-command-centre__issues" role="group" aria-label="Issues by severity">
      {issues.map((bucket) => {
        const ratio = total === 0 ? 0 : bucket.count / total;
        return (
          <div
            key={bucket.severity}
            className="aurora-command-centre__issue"
            data-severity={bucket.severity}
          >
            <Text variant="text-micro" tone="tertiary">
              {SEVERITY_LABEL[bucket.severity]}
            </Text>
            <Text variant="text-body" numeric>
              {bucket.count.toLocaleString()}
            </Text>
            <div
              className="aurora-command-centre__issue-bar"
              style={{ "--aurora-ratio": ratio } as React.CSSProperties}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------- Verdict utility */

export interface BuildVerdictInput {
  /** Composite DQS across modules, 0-100. */
  dqs: number;
  /** Previous DQS for delta computation. null if unknown. */
  previousDqs: number | null;
  critical: number;
  high: number;
  topModule: string | null;
}

/**
 * Compose the one-sentence verdict from aggregated counts. Keeps the
 * logic pure + testable so the page can swap between live + demo data
 * without rewriting the narrative. Semantic thresholds:
 *   • danger  — any critical
 *   • warning — DQS < 75 or high > 10
 *   • success — otherwise
 */
export function buildVerdict({
  dqs,
  previousDqs,
  critical,
  high,
  topModule,
}: BuildVerdictInput): CommandCentreVerdict {
  const dqsStr = dqs.toFixed(1);
  const deltaCopy =
    previousDqs !== null
      ? (() => {
          const delta = dqs - previousDqs;
          if (Math.abs(delta) < 0.1) return "holding";
          return delta > 0 ? `up ${delta.toFixed(1)}` : `down ${Math.abs(delta).toFixed(1)}`;
        })()
      : null;

  if (critical > 0) {
    return {
      eyebrow: `Critical · ${critical}`,
      sentence:
        topModule !== null
          ? `${critical} critical finding${critical === 1 ? " is" : "s are"} blocking ${topModule} readiness.`
          : `${critical} critical finding${critical === 1 ? " is" : "s are"} blocking readiness.`,
      support: `DQS is ${dqsStr}${deltaCopy ? `, ${deltaCopy}` : ""}.`,
      semantic: "danger",
    };
  }
  if (dqs < 75 || high > 10) {
    return {
      eyebrow: high > 0 ? `High · ${high}` : "Watch",
      sentence: `DQS is ${dqsStr} — ${high} high-severity finding${high === 1 ? " needs" : "s need"} review.`,
      support:
        topModule !== null ? `${topModule} is driving the shortfall.` : undefined,
      semantic: "warning",
    };
  }
  return {
    eyebrow: "On track",
    sentence: `DQS is ${dqsStr}${deltaCopy ? ` and ${deltaCopy}` : ""}. Nothing blocking.`,
    support: "Inbox is clear of critical and high-severity findings.",
    semantic: "success",
  };
}

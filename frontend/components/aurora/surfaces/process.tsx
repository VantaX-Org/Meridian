/**
 * Aurora Process surface — WS7.
 *
 * Meridian's process-intelligence workspace (Part IV, §10 of the spec).
 * Composes the WS3 ProcessGraph + variant/cases tables + a Config Impact
 * panel under the standard Aurora shell. Reference calibration: Celonis
 * Process Intelligence, flatter and more confident — no skeuomorphism,
 * no drop-shadows-on-drop-shadows, one gradient (the verdict halo).
 *
 * Pure view. The live page wires `<Process>` against `/api/v1/mining`,
 * `/api/v1/business-process`, `/api/v1/relationships`, and
 * `/api/v1/config-impact`; the playground wires it with fixtures.
 *
 * Tabs:
 *   • Map          — ProcessGraph for the active process (materialisation
 *                    moment from WS5 plays on entry).
 *   • Variants     — Ranked variants with case count + quality score.
 *   • Cases        — Individual case traces (drills open Record Report).
 *   • Config Impact — SPRO ↔ findings mapping filtered to the process.
 *   • Report       — hosts the Process Report (rendered by caller).
 *
 * Shared:
 *   • Left rail surfaces a process picker — a ranked list of processes
 *     with readiness chips.
 *   • Top header is a VerdictCard bound to the current process.
 *   • Bottom (optional) is a BulkActionPanel for multi-select on Cases.
 */

"use client";

import type { ReactNode } from "react";
import {
  BulkActionPanel,
  type BulkActionPanelProps,
  DataTable,
  type AuroraColumnMeta,
  EmptyState,
  ProcessGraph,
  type ProcessGraphProps,
  Stack,
  Tabs,
  type TabsItem,
  Text,
  VerdictCard,
  type VerdictSemantic,
} from "@/components/aurora";
import type { ColumnDef } from "@tanstack/react-table";
import { clsx } from "../primitives/internal";

/* -------------------------------------------------------------- Types --- */

export type ProcessTabId =
  | "map"
  | "variants"
  | "cases"
  | "config-impact"
  | "report";

export type ProcessReadiness =
  | "ready"
  | "at-risk"
  | "blocked"
  | "unknown";

export interface ProcessPick {
  id: string;
  label: ReactNode;
  /** Readiness chip tint. */
  readiness: ProcessReadiness;
  /** 0-100 readiness score. */
  score?: number;
  /** Secondary label, e.g. "DE01 · 14m ago". */
  support?: ReactNode;
}

export interface ProcessVariant {
  id: string;
  /** Short label — "Standard", "Express with approval", etc. */
  label: string;
  /** Count of cases executing this variant. */
  cases: number;
  /** Quality score 0-100. */
  quality: number;
  /** Coverage fraction 0-1 of the total case volume. */
  coverage: number;
}

export interface ProcessCase {
  id: string;
  /** Case identifier — order number, document id, etc. */
  caseId: string;
  /** Variant label the case executed. */
  variant: string;
  /** Human-readable duration, e.g. "2d 4h". */
  duration: string;
  /** Quality score 0-100. */
  quality: number;
  /** Count of blocking findings. */
  blocking: number;
}

export interface ProcessConfigImpactRow {
  id: string;
  /** SPRO node path, e.g. "SD/Billing/Condition types". */
  spro: string;
  /** Affected feature, e.g. "Intercompany billing". */
  feature: string;
  status: "blocked" | "degraded" | "aligned";
  /** Count of findings contributing to the gap. */
  findings: number;
  /** Opportunity cost in USD, if estimated. */
  opportunity?: number;
}

export interface ProcessVerdict {
  eyebrow?: ReactNode;
  sentence: ReactNode;
  support?: ReactNode;
  semantic: VerdictSemantic;
  actions?: ReactNode;
}

export interface ProcessProps {
  verdict: ProcessVerdict;
  /** Left-rail process picker entries. */
  processes: ReadonlyArray<ProcessPick>;
  /** Currently selected process id. */
  selectedProcess: string;
  onSelectedProcessChange: (id: string) => void;
  /** Tab bar + active tab — host owns active-tab state. */
  tabs: ReadonlyArray<{
    id: ProcessTabId;
    label: ReactNode;
    count?: number;
    disabled?: boolean;
  }>;
  activeTab: ProcessTabId;
  onActiveTabChange: (tab: ProcessTabId) => void;
  /** ProcessGraph props for the Map tab — nodes + edges for the selected process. */
  graph?: Pick<
    ProcessGraphProps,
    "nodes" | "edges" | "direction" | "onNodeClick"
  >;
  /** Variant rows for the Variants tab. */
  variants?: ReadonlyArray<ProcessVariant>;
  onVariantActivate?: (variant: ProcessVariant) => void;
  /** Case rows for the Cases tab. */
  cases?: ReadonlyArray<ProcessCase>;
  onCaseActivate?: (c: ProcessCase) => void;
  /** Config impact rows for the Config Impact tab. */
  configImpact?: ReadonlyArray<ProcessConfigImpactRow>;
  onConfigImpactActivate?: (row: ProcessConfigImpactRow) => void;
  /** Report body for the Report tab — typically <ProcessReport>. */
  report?: ReactNode;
  /** Optional bulk-selection surface, e.g. re-run on selected cases. */
  bulkSelection?: BulkActionPanelProps;
  className?: string;
}

/* --------------------------------------------------------- Constants --- */

const READINESS_LABEL: Record<ProcessReadiness, string> = {
  ready: "Ready",
  "at-risk": "At risk",
  blocked: "Blocked",
  unknown: "Unknown",
};

const CONFIG_STATUS_LABEL: Record<ProcessConfigImpactRow["status"], string> = {
  blocked: "Blocked",
  degraded: "Degraded",
  aligned: "Aligned",
};

/* ----------------------------------------------------------- Columns --- */

const variantColumns: ColumnDef<ProcessVariant, unknown>[] = [
  {
    id: "label",
    header: "Variant",
    accessorKey: "label",
    cell: ({ row }) => <span>{row.original.label}</span>,
  },
  {
    id: "cases",
    header: "Cases",
    accessorKey: "cases",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.cases.toLocaleString()}
      </Text>
    ),
    meta: { width: 96, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
  {
    id: "coverage",
    header: "Coverage",
    accessorKey: "coverage",
    cell: ({ row }) => (
      <div className="aurora-process__coverage">
        <div
          className="aurora-process__coverage-bar"
          style={
            { "--aurora-ratio": row.original.coverage } as React.CSSProperties
          }
          aria-hidden
        />
        <Text variant="text-small" numeric as="span" tone="secondary">
          {(row.original.coverage * 100).toFixed(0)}%
        </Text>
      </div>
    ),
    meta: { width: 160 } satisfies AuroraColumnMeta,
  },
  {
    id: "quality",
    header: "Quality",
    accessorKey: "quality",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.quality.toFixed(1)}
      </Text>
    ),
    meta: { width: 96, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
];

const caseColumns: ColumnDef<ProcessCase, unknown>[] = [
  {
    id: "caseId",
    header: "Case",
    accessorKey: "caseId",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span">
        {row.original.caseId}
      </Text>
    ),
    meta: { width: 160 } satisfies AuroraColumnMeta,
  },
  {
    id: "variant",
    header: "Variant",
    accessorKey: "variant",
    cell: ({ row }) => <span>{row.original.variant}</span>,
  },
  {
    id: "duration",
    header: "Duration",
    accessorKey: "duration",
    cell: ({ row }) => (
      <Text variant="text-small" tone="secondary" as="span">
        {row.original.duration}
      </Text>
    ),
    meta: { width: 120 } satisfies AuroraColumnMeta,
  },
  {
    id: "quality",
    header: "Quality",
    accessorKey: "quality",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.quality.toFixed(1)}
      </Text>
    ),
    meta: { width: 96, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
  {
    id: "blocking",
    header: "Blocking",
    accessorKey: "blocking",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.blocking.toLocaleString()}
      </Text>
    ),
    meta: { width: 96, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
];

const configImpactColumns: ColumnDef<ProcessConfigImpactRow, unknown>[] = [
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => (
      <span
        className="aurora-process__status"
        data-status={row.original.status}
      >
        {CONFIG_STATUS_LABEL[row.original.status]}
      </span>
    ),
    meta: { width: 112 } satisfies AuroraColumnMeta,
  },
  {
    id: "spro",
    header: "SPRO",
    accessorKey: "spro",
    cell: ({ row }) => (
      <Text variant="text-small" tone="secondary" as="span">
        {row.original.spro}
      </Text>
    ),
  },
  {
    id: "feature",
    header: "Feature",
    accessorKey: "feature",
    cell: ({ row }) => <span>{row.original.feature}</span>,
  },
  {
    id: "findings",
    header: "Findings",
    accessorKey: "findings",
    cell: ({ row }) => (
      <Text variant="text-small" numeric as="span" tone="secondary">
        {row.original.findings.toLocaleString()}
      </Text>
    ),
    meta: { width: 96, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
  {
    id: "opportunity",
    header: "Opportunity",
    accessorKey: "opportunity",
    cell: ({ row }) =>
      typeof row.original.opportunity === "number" ? (
        <Text variant="text-small" numeric as="span" tone="secondary">
          USD {row.original.opportunity.toLocaleString()}
        </Text>
      ) : (
        <Text variant="text-small" tone="tertiary" as="span">
          —
        </Text>
      ),
    meta: { width: 128, align: "end", numeric: true } satisfies AuroraColumnMeta,
  },
];

/* ----------------------------------------------------------- Surface --- */

export function Process({
  verdict,
  processes,
  selectedProcess,
  onSelectedProcessChange,
  tabs,
  activeTab,
  onActiveTabChange,
  graph,
  variants,
  onVariantActivate,
  cases,
  onCaseActivate,
  configImpact,
  onConfigImpactActivate,
  report,
  bulkSelection,
  className,
}: ProcessProps) {
  const tabItems: TabsItem<ProcessTabId>[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    count: tab.count,
    disabled: tab.disabled,
  }));

  return (
    <div className={clsx("aurora-process", className)}>
      <VerdictCard
        eyebrow={verdict.eyebrow}
        verdict={verdict.sentence}
        support={verdict.support}
        semantic={verdict.semantic}
        actions={verdict.actions}
      />

      <div className="aurora-process__layout">
        <aside
          className="aurora-process__rail"
          aria-label="Processes"
        >
          <header className="aurora-process__rail-head">
            <Text variant="text-micro" tone="tertiary">
              Processes
            </Text>
            <Text variant="text-small" tone="tertiary" as="span" numeric>
              {processes.length}
            </Text>
          </header>
          <ul className="aurora-process__rail-list" role="listbox" aria-label="Process picker">
            {processes.map((pick) => {
              const selected = pick.id === selectedProcess;
              return (
                <li key={pick.id} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={clsx(
                      "aurora-process__pick",
                      "aurora-focus-ring",
                    )}
                    data-selected={selected ? "true" : undefined}
                    data-readiness={pick.readiness}
                    onClick={() => onSelectedProcessChange(pick.id)}
                  >
                    <Stack direction="column" gap={1}>
                      <span className="aurora-process__pick-label">
                        {pick.label}
                      </span>
                      {pick.support ? (
                        <Text
                          variant="text-micro"
                          tone="tertiary"
                          as="span"
                        >
                          {pick.support}
                        </Text>
                      ) : null}
                    </Stack>
                    <span className="aurora-process__pick-meta">
                      {typeof pick.score === "number" ? (
                        <Text
                          variant="text-small"
                          numeric
                          as="span"
                          tone="secondary"
                        >
                          {pick.score.toFixed(0)}
                        </Text>
                      ) : null}
                      <span
                        className="aurora-process__readiness"
                        data-readiness={pick.readiness}
                      >
                        {READINESS_LABEL[pick.readiness]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section
          className="aurora-process__content"
          aria-label="Process detail"
        >
          <Tabs
            items={tabItems}
            value={activeTab}
            onValueChange={onActiveTabChange}
            ariaLabel="Process sections"
          />

          <div className="aurora-process__tab-body">
            {activeTab === "map" ? (
              graph && graph.nodes.length > 0 ? (
                <ProcessGraph
                  nodes={graph.nodes}
                  edges={graph.edges}
                  direction={graph.direction}
                  onNodeClick={graph.onNodeClick}
                  height={480}
                />
              ) : (
                <EmptyState
                  title="No process graph yet"
                  body="Run an analysis to materialise this process from the transactional data."
                />
              )
            ) : null}

            {activeTab === "variants" ? (
              variants && variants.length > 0 ? (
                <DataTable
                  columns={variantColumns}
                  data={variants.slice()}
                  getRowId={(row) => row.id}
                  onRowActivate={onVariantActivate}
                  ariaLabel="Process variants"
                  maxHeight={480}
                />
              ) : (
                <EmptyState
                  title="No variants detected"
                  body="Once the mining job has enough cases, ranked variants appear here."
                />
              )
            ) : null}

            {activeTab === "cases" ? (
              cases && cases.length > 0 ? (
                <DataTable
                  columns={caseColumns}
                  data={cases.slice()}
                  getRowId={(row) => row.id}
                  onRowActivate={onCaseActivate}
                  ariaLabel="Process cases"
                  maxHeight={480}
                />
              ) : (
                <EmptyState
                  title="No cases in this window"
                  body="Extend the analysis window to surface individual case traces."
                />
              )
            ) : null}

            {activeTab === "config-impact" ? (
              configImpact && configImpact.length > 0 ? (
                <DataTable
                  columns={configImpactColumns}
                  data={configImpact.slice()}
                  getRowId={(row) => row.id}
                  onRowActivate={onConfigImpactActivate}
                  ariaLabel="Configuration impact"
                  maxHeight={480}
                />
              ) : (
                <EmptyState
                  title="Configuration is aligned"
                  body="No SPRO node is blocking or degrading this process in the current analysis."
                />
              )
            ) : null}

            {activeTab === "report" ? (
              report ?? (
                <EmptyState
                  title="Process report is loading"
                  body="Select a process from the rail to generate its L1–L5 readiness document."
                />
              )
            ) : null}
          </div>
        </section>
      </div>

      {bulkSelection ? <BulkActionPanel {...bulkSelection} /> : null}
    </div>
  );
}

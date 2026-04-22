/**
 * Aurora Process Report — WS7 §2.5.2.
 *
 * The L1–L5 readiness document for a single business process, rendered
 * as a long scrollable surface via `<ReportSurface>`. This is the view
 * a CFO or process owner receives ahead of a go-live review — it must
 * read like a Linear changelog, not a slide deck.
 *
 * Eight sections in order:
 *
 *   1. Verdict header            (ReportSurface header slot)
 *   2. L1–L5 hierarchy
 *   3. Process map
 *   4. Variants
 *   5. Config alignment
 *   6. Blocking findings
 *   7. Readiness history
 *   8. Recommendations
 *
 * Pure view. Live pages hydrate each slot. Deterministic sources only
 * (recommendations are NOT LLM-written — they come from the agent flow
 * and arrive as a flat list).
 */

"use client";

import type { ReactNode } from "react";
import {
  EmptyState,
  ProcessGraph,
  type ProcessGraphProps,
  Sparkline,
  Stack,
  Text,
} from "@/components/aurora";
import { clsx } from "../primitives/internal";
import { ReportSurface, type ReportSurfaceProps } from "./report-surface";

/* -------------------------------------------------------------- Types --- */

export type ProcessReportReadiness =
  | "ready"
  | "at-risk"
  | "blocked"
  | "unknown";

export interface ProcessReportHierarchyNode {
  /** L1 / L2 / L3 / L4 / L5 indicator. */
  level: 1 | 2 | 3 | 4 | 5;
  id: string;
  label: ReactNode;
  /** Owning SAP module, e.g. "SD". */
  module?: ReactNode;
  /** 0-100 readiness score. */
  score?: number;
  /** Count of blocking findings for this node. */
  blocking?: number;
  /** Child nodes — recursive. */
  children?: ReadonlyArray<ProcessReportHierarchyNode>;
}

export interface ProcessReportVariantRow {
  id: string;
  label: ReactNode;
  cases: number;
  /** Quality score 0-100. */
  quality: number;
  /** Coverage fraction 0-1. */
  coverage: number;
}

export interface ProcessReportConfigRow {
  id: string;
  spro: ReactNode;
  feature: ReactNode;
  status: "blocked" | "degraded" | "aligned";
  findings?: number;
}

export interface ProcessReportBlockingFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  checkId: ReactNode;
  title: ReactNode;
  /** L3 gate this finding blocks — used for grouping in the hierarchy. */
  gate?: ReactNode;
  /** Optional deep link to the Record Report. */
  href?: string;
  /** Affected record count. */
  affected?: number;
}

export interface ProcessReportReadinessPoint {
  version: string;
  /** 0-100. */
  score: number;
}

export interface ProcessReportRecommendation {
  id: string;
  label: ReactNode;
  /** Owning role / team. */
  owner?: ReactNode;
  /** Effort bucket — one of three tokens. */
  effort?: "low" | "medium" | "high";
  /** Short justification — deterministic, from the agent flow. */
  rationale?: ReactNode;
}

export interface ProcessReportProps {
  /** Process slug — "order-to-cash", "procure-to-pay". */
  processSlug: ReactNode;
  /** Process display name. */
  processName: ReactNode;
  /** Display-sm verdict sentence. */
  verdict: ReactNode;
  support?: ReactNode;
  /** Overall readiness, 0-100. */
  readiness: number;
  readinessSemantic: ProcessReportReadiness;
  owner?: ReactNode;
  lastUpdated?: ReactNode;
  actions?: ReactNode;

  hierarchy?: ReadonlyArray<ProcessReportHierarchyNode>;
  graph?: Pick<ProcessGraphProps, "nodes" | "edges" | "direction">;
  variants?: ReadonlyArray<ProcessReportVariantRow>;
  configAlignment?: ReadonlyArray<ProcessReportConfigRow>;
  blockingFindings?: ReadonlyArray<ProcessReportBlockingFinding>;
  readinessHistory?: ReadonlyArray<ProcessReportReadinessPoint>;
  recommendations?: ReadonlyArray<ProcessReportRecommendation>;

  className?: string;
}

/* --------------------------------------------------------- Constants --- */

const READINESS_LABEL: Record<ProcessReportReadiness, string> = {
  ready: "Ready",
  "at-risk": "At risk",
  blocked: "Blocked",
  unknown: "Unknown",
};

const CONFIG_STATUS_LABEL: Record<ProcessReportConfigRow["status"], string> = {
  blocked: "Blocked",
  degraded: "Degraded",
  aligned: "Aligned",
};

const SEVERITY_LABEL: Record<ProcessReportBlockingFinding["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const EFFORT_LABEL: Record<"low" | "medium" | "high", string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
};

/* ------------------------------------------------------------ Surface --- */

export function ProcessReport({
  processSlug,
  processName,
  verdict,
  support,
  readiness,
  readinessSemantic,
  owner,
  lastUpdated,
  actions,
  hierarchy,
  graph,
  variants,
  configAlignment,
  blockingFindings,
  readinessHistory,
  recommendations,
  className,
}: ProcessReportProps) {
  const sections: ReportSurfaceProps["sections"] = [
    {
      id: "hierarchy",
      label: "Hierarchy",
      count: countHierarchy(hierarchy),
      body: <HierarchySection nodes={hierarchy} />,
    },
    {
      id: "process-map",
      label: "Process map",
      body: <ProcessMapSection graph={graph} />,
    },
    {
      id: "variants",
      label: "Variants",
      count: variants?.length,
      body: <VariantsSection rows={variants} />,
    },
    {
      id: "config-alignment",
      label: "Config alignment",
      count: configAlignment?.length,
      body: <ConfigAlignmentSection rows={configAlignment} />,
    },
    {
      id: "blocking",
      label: "Blocking findings",
      count: blockingFindings?.length,
      body: <BlockingSection findings={blockingFindings} />,
    },
    {
      id: "readiness-history",
      label: "Readiness history",
      body: <ReadinessHistorySection points={readinessHistory} />,
    },
    {
      id: "recommendations",
      label: "Recommendations",
      count: recommendations?.length,
      body: <RecommendationsSection items={recommendations} />,
    },
  ];

  return (
    <div className={clsx("aurora-process-report", className)}>
      <ReportSurface
        eyebrow={
          <>
            PROCESS · <span>{processSlug}</span>
          </>
        }
        title={verdict}
        support={support}
        chips={
          <>
            <span
              className="aurora-process-report__readiness"
              data-readiness={readinessSemantic}
            >
              {READINESS_LABEL[readinessSemantic]}
            </span>
            <Text variant="text-small" numeric as="span">
              {readiness.toFixed(0)} / 100
            </Text>
            <Text variant="text-small" tone="tertiary" as="span">
              {processName}
            </Text>
            {owner ? (
              <Text variant="text-small" tone="tertiary" as="span">
                Owner · {owner}
              </Text>
            ) : null}
            {lastUpdated ? (
              <Text variant="text-small" tone="tertiary" as="span">
                Updated {lastUpdated}
              </Text>
            ) : null}
          </>
        }
        actions={actions}
        sections={sections}
        navLabel="Process report sections"
      />
    </div>
  );
}

/* ----------------------------------------------------------- Sections --- */

function countHierarchy(
  nodes: ReadonlyArray<ProcessReportHierarchyNode> | undefined,
): number | undefined {
  if (!nodes) return undefined;
  let count = 0;
  const walk = (ns: ReadonlyArray<ProcessReportHierarchyNode>) => {
    for (const n of ns) {
      count += 1;
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return count;
}

function HierarchySection({
  nodes,
}: {
  nodes?: ReadonlyArray<ProcessReportHierarchyNode>;
}) {
  if (!nodes || nodes.length === 0) {
    return (
      <EmptyState
        title="Hierarchy not yet generated"
        body="Run the process writer to materialise the L1–L5 tree for this process."
      />
    );
  }
  return (
    <ol className="aurora-process-report__hierarchy" role="tree">
      {nodes.map((n) => (
        <HierarchyNode key={n.id} node={n} />
      ))}
    </ol>
  );
}

function HierarchyNode({ node }: { node: ProcessReportHierarchyNode }) {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  return (
    <li
      className="aurora-process-report__hier-node"
      data-level={node.level}
      role="treeitem"
      aria-selected={false}
      aria-level={node.level}
      aria-expanded={hasChildren ? true : undefined}
    >
      <div className="aurora-process-report__hier-row">
        <span
          className="aurora-process-report__hier-level"
          data-numeric="true"
        >
          L{node.level}
        </span>
        <Text variant="text-body" as="span">
          {node.label}
        </Text>
        {node.module ? (
          <Text variant="text-small" tone="tertiary" as="span">
            {node.module}
          </Text>
        ) : null}
        <span className="aurora-process-report__hier-meta">
          {typeof node.score === "number" ? (
            <Text variant="text-small" numeric as="span" tone="secondary">
              {node.score.toFixed(0)}
            </Text>
          ) : null}
          {typeof node.blocking === "number" && node.blocking > 0 ? (
            <span
              className="aurora-process-report__hier-blocking"
              data-tone="danger"
            >
              {node.blocking.toLocaleString()} blocking
            </span>
          ) : null}
        </span>
      </div>
      {node.children && node.children.length > 0 ? (
        <ol className="aurora-process-report__hierarchy" role="group">
          {node.children.map((child) => (
            <HierarchyNode key={child.id} node={child} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function ProcessMapSection({
  graph,
}: {
  graph?: Pick<ProcessGraphProps, "nodes" | "edges" | "direction">;
}) {
  if (!graph || graph.nodes.length === 0) {
    return (
      <EmptyState
        title="No process map for this window"
        body="Once mining detects a process graph for this slug, it renders inline here."
      />
    );
  }
  return (
    <ProcessGraph
      nodes={graph.nodes}
      edges={graph.edges}
      direction={graph.direction}
      height={360}
    />
  );
}

function VariantsSection({
  rows,
}: {
  rows?: ReadonlyArray<ProcessReportVariantRow>;
}) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="No variants detected"
        body="Variants appear once the mining job sees enough cases to rank them."
      />
    );
  }
  return (
    <ul className="aurora-process-report__variants">
      {rows.map((row) => (
        <li
          key={row.id}
          className="aurora-process-report__variant-row"
        >
          <Stack direction="column" gap={1}>
            <Text variant="text-body">{row.label}</Text>
            <Text variant="text-micro" tone="tertiary">
              <span data-numeric="true">{row.cases.toLocaleString()}</span>{" "}
              cases · quality{" "}
              <span data-numeric="true">{row.quality.toFixed(1)}</span>
            </Text>
          </Stack>
          <div className="aurora-process-report__variant-bar">
            <div
              className="aurora-process-report__variant-fill"
              style={
                { "--aurora-ratio": row.coverage } as React.CSSProperties
              }
              aria-hidden
            />
            <Text variant="text-small" numeric as="span" tone="secondary">
              {(row.coverage * 100).toFixed(0)}%
            </Text>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConfigAlignmentSection({
  rows,
}: {
  rows?: ReadonlyArray<ProcessReportConfigRow>;
}) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        title="Configuration is aligned"
        body="No SPRO node is blocking or degrading this process in the current analysis."
      />
    );
  }
  return (
    <ul className="aurora-process-report__config">
      {rows.map((row) => (
        <li
          key={row.id}
          className="aurora-process-report__config-row"
          data-status={row.status}
        >
          <span
            className="aurora-process-report__config-chip"
            data-status={row.status}
          >
            {CONFIG_STATUS_LABEL[row.status]}
          </span>
          <Text variant="text-small" tone="secondary" as="span">
            {row.spro}
          </Text>
          <Text variant="text-body" as="span">
            {row.feature}
          </Text>
          {typeof row.findings === "number" ? (
            <Text variant="text-small" numeric as="span" tone="secondary">
              {row.findings.toLocaleString()}
            </Text>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function BlockingSection({
  findings,
}: {
  findings?: ReadonlyArray<ProcessReportBlockingFinding>;
}) {
  if (!findings || findings.length === 0) {
    return (
      <EmptyState
        title="Nothing blocking right now"
        body="No critical or high-severity finding is holding this process back."
      />
    );
  }
  return (
    <ol className="aurora-process-report__blocking">
      {findings.map((f) => {
        const inner = (
          <Stack direction="column" gap={1}>
            <div className="aurora-process-report__blocking-head">
              <span
                className="aurora-process-report__severity"
                data-severity={f.severity}
              >
                {SEVERITY_LABEL[f.severity]}
              </span>
              <Text variant="text-small" numeric as="span" tone="tertiary">
                {f.checkId}
              </Text>
              {f.gate ? (
                <Text variant="text-small" tone="tertiary" as="span">
                  · {f.gate}
                </Text>
              ) : null}
            </div>
            <Text variant="text-body">{f.title}</Text>
            {typeof f.affected === "number" ? (
              <Text variant="text-micro" tone="tertiary">
                <span data-numeric="true">{f.affected.toLocaleString()}</span>{" "}
                records affected
              </Text>
            ) : null}
          </Stack>
        );
        return (
          <li key={f.id} className="aurora-process-report__blocking-row">
            {f.href ? (
              <a
                className={clsx(
                  "aurora-process-report__blocking-link",
                  "aurora-focus-ring",
                )}
                href={f.href}
              >
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ReadinessHistorySection({
  points,
}: {
  points?: ReadonlyArray<ProcessReportReadinessPoint>;
}) {
  if (!points || points.length === 0) {
    return (
      <EmptyState
        title="Not enough history yet"
        body="Readiness trends surface after a second analysis version lands for this process."
      />
    );
  }
  return (
    <div className="aurora-process-report__history">
      <Sparkline<{ version: string; score: number }>
        data={points.map((p) => ({ version: p.version, score: p.score }))}
        xKey="version"
        yKey="score"
        height={72}
        width="100%"
        fill
        ariaLabel="Readiness score across analysis versions"
      />
      <Text variant="text-micro" tone="tertiary">
        <span data-numeric="true">{points.length}</span> analysis versions,
        latest{" "}
        <span data-numeric="true">{points.at(-1)?.version ?? ""}</span>
      </Text>
    </div>
  );
}

function RecommendationsSection({
  items,
}: {
  items?: ReadonlyArray<ProcessReportRecommendation>;
}) {
  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="No deterministic recommendations yet"
        body="Recommendations surface from the agent flow once the process has enough signal."
      />
    );
  }
  return (
    <ol className="aurora-process-report__recs">
      {items.map((item) => (
        <li key={item.id} className="aurora-process-report__rec">
          <Stack direction="column" gap={1}>
            <Text variant="text-body">{item.label}</Text>
            {item.rationale ? (
              <Text variant="text-small" tone="secondary">
                {item.rationale}
              </Text>
            ) : null}
            <Text variant="text-micro" tone="tertiary">
              {item.owner ? (
                <>
                  Owner · <span>{item.owner}</span>
                </>
              ) : null}
              {item.owner && item.effort ? " · " : null}
              {item.effort ? EFFORT_LABEL[item.effort] : null}
            </Text>
          </Stack>
        </li>
      ))}
    </ol>
  );
}

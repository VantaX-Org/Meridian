/**
 * Aurora Record Report — WS7 §2.5.1.
 *
 * The canonical document a steward or auditor reads to understand what
 * is wrong with a specific master-data record, why it matters, and what
 * to do about it. Built on top of `<ReportSurface>` — same anchored
 * scroll nav, same print-safe layout — with 8 sections:
 *
 *   1. Verdict header      (rendered by ReportSurface header slot)
 *   2. Context strip
 *   3. What's wrong        (per-check findings + FixPlaybook excerpt)
 *   4. Config impact
 *   5. Related records
 *   6. Fix history
 *   7. Activity
 *   8. Action bar          (rendered by ReportSurface actions slot +
 *                           duplicated as a sticky mobile footer)
 *
 * Pure view. Host hydrates each section with live data OR fixtures from
 * the playground. Missing sections render `<EmptyState>` per Aurora
 * copy rule: every string teaches / directs / confirms.
 */

"use client";

import type { ReactNode } from "react";
import {
  Chip,
  EmptyState,
  FixPlaybook,
  type FixPlaybookProps,
  Sparkline,
  Stack,
  Text,
} from "@/components/aurora";
import { clsx } from "../primitives/internal";
import { ReportSurface, type ReportSurfaceProps } from "./report-surface";

/* -------------------------------------------------------------- Types --- */

export type RecordReportSeverity = "critical" | "high" | "medium" | "low";
export type RecordReportStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "escalated";

/**
 * Root-cause classification attached to a failing finding by the backend
 * (checks/root_cause.py). Bridges the DQ-rule channel and Config
 * Intelligence: tells the steward whether a flagged value is a data
 * problem (value is valid SPRO config, records are wrong) or a config
 * problem (value isn't in SPRO at all — rule may be stricter than
 * reality, or config has drifted).
 */
export type RecordReportRootCauseType =
  | "bad_data"
  | "bad_config"
  | "bad_data_and_config"
  | "unknown";

export interface RecordReportRootCause {
  type: RecordReportRootCauseType;
  /** Human-readable reasoning, one sentence. */
  reasoning: string;
  /** The SAP element_type matched against (e.g. "KTOKK"). */
  elementType?: string;
  /** Flagged values that ARE in the tenant's SPRO config. */
  flaggedValuesInConfig?: ReadonlyArray<string>;
  /** Flagged values NOT in the tenant's SPRO config. */
  flaggedValuesNotInConfig?: ReadonlyArray<string>;
}

export interface RecordReportFinding {
  id: string;
  /** Check id, e.g. "BP.COMPLETENESS.TAX_NUMBER". */
  checkId: string;
  /** Human-readable check title. */
  title: ReactNode;
  severity: RecordReportSeverity;
  /** 0-1 pass rate for the check at the record scope. */
  passRate: number;
  /** Field-level evidence — short phrase. */
  evidence?: ReactNode;

  /** Root-cause classification from checks/root_cause.py. */
  rootCause?: RecordReportRootCause;
  /**
   * When populated the finding is a cross-module rule (P2P, OTC, etc.).
   * The list is the set of source modules joined to produce the finding.
   */
  sourceModules?: ReadonlyArray<string>;
  /**
   * "customer" for Z-table / Y-table findings (customer namespace),
   * "standard" or omitted for SAP-standard findings.
   */
  namespace?: "standard" | "customer";
  /**
   * Context predicate that scoped the rule (from applies_when in YAML).
   * Rendered as "When MTART in FERT, HALB" in the finding head.
   */
  appliesWhen?: Record<string, ReadonlyArray<string>>;
}

export interface RecordReportContextItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  /** Optional href for deep link (golden-record peers, process). */
  href?: string;
}

export interface RecordReportConfigImpactItem {
  id: string;
  feature: ReactNode;
  status: "blocked" | "degraded" | "aligned";
  rationale?: ReactNode;
  opportunity?: number;
}

export interface RecordReportRelatedItem {
  id: string;
  label: ReactNode;
  kind: "dedup" | "referenced-by" | "golden-peer";
  /** Optional secondary, e.g. "match 0.92" or "owns 14". */
  detail?: ReactNode;
  onOpen?: () => void;
}

export interface RecordReportFixHistory {
  checkId: string;
  label: ReactNode;
  /** Prior fix count for this tenant. */
  count: number;
  /** Average duration minutes. */
  avgMinutes: number;
  /** Success rate 0-1. */
  successRate: number;
  /** Trailing pass-rate series — 0-1 per analysis version. */
  series?: ReadonlyArray<{ version: string; rate: number }>;
}

export interface RecordReportActivityItem {
  id: string;
  /**
   * Machine-readable ISO-8601 timestamp for the `<time dateTime>` attribute.
   * e.g. "2026-04-22T12:30:00Z".
   */
  timestamp: string;
  /**
   * Optional display label for the timestamp — e.g. "14m ago" or
   * "Mar 12, 14:00". When omitted, the `timestamp` is rendered verbatim.
   */
  displayTime?: ReactNode;
  actor: ReactNode;
  action: ReactNode;
  /** Optional body, e.g. comment text or state transition. */
  body?: ReactNode;
}

export interface RecordReportProps {
  /** Record id — shown in eyebrow + chip row. */
  recordId: ReactNode;
  /** Owning module — "Business Partner", "Material Master", … */
  module: ReactNode;
  /** Verdict sentence (display-sm) — state the problem in one line. */
  verdict: ReactNode;
  /** Support line under the verdict. */
  support?: ReactNode;
  severity: RecordReportSeverity;
  status: RecordReportStatus;
  /** Human-readable last-updated label. */
  lastUpdated: ReactNode;
  /** Header action row — Copy link, Export PDF, Open drawer, New tab. */
  actions?: ReactNode;

  context?: ReadonlyArray<RecordReportContextItem>;
  findings?: ReadonlyArray<RecordReportFinding>;
  /** Fix playbook excerpt for the top finding. */
  fixPlaybook?: FixPlaybookProps;
  configImpact?: ReadonlyArray<RecordReportConfigImpactItem>;
  related?: ReadonlyArray<RecordReportRelatedItem>;
  fixHistory?: RecordReportFixHistory;
  activity?: ReadonlyArray<RecordReportActivityItem>;
  /** Sticky bottom action bar — Escalate / Reject / Approve. */
  actionBar?: ReactNode;

  className?: string;
}

/* --------------------------------------------------------- Constants --- */

const SEVERITY_LABEL: Record<RecordReportSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_LABEL: Record<RecordReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  escalated: "Escalated",
};

const CONFIG_STATUS_LABEL: Record<
  RecordReportConfigImpactItem["status"],
  string
> = {
  blocked: "Blocked",
  degraded: "Degraded",
  aligned: "Aligned",
};

const RELATED_KIND_LABEL: Record<RecordReportRelatedItem["kind"], string> = {
  dedup: "Dedup cluster",
  "referenced-by": "Referenced by",
  "golden-peer": "Golden record peer",
};

/* ------------------------------------------------------------ Surface --- */

export function RecordReport({
  recordId,
  module,
  verdict,
  support,
  severity,
  status,
  lastUpdated,
  actions,
  context,
  findings,
  fixPlaybook,
  configImpact,
  related,
  fixHistory,
  activity,
  actionBar,
  className,
}: RecordReportProps) {
  const sections: ReportSurfaceProps["sections"] = [
    {
      id: "context",
      label: "Context",
      count: context?.length,
      body: <ContextSection items={context} />,
    },
    {
      id: "whats-wrong",
      label: "What's wrong",
      count: findings?.length,
      body: (
        <WhatsWrongSection findings={findings} fixPlaybook={fixPlaybook} />
      ),
    },
    {
      id: "config-impact",
      label: "Config impact",
      count: configImpact?.length,
      body: <ConfigImpactSection items={configImpact} />,
    },
    {
      id: "related",
      label: "Related",
      count: related?.length,
      body: <RelatedSection items={related} />,
    },
    {
      id: "fix-history",
      label: "Fix history",
      body: <FixHistorySection history={fixHistory} />,
    },
    {
      id: "activity",
      label: "Activity",
      count: activity?.length,
      body: <ActivitySection items={activity} />,
    },
  ];

  return (
    <div className={clsx("aurora-record-report", className)}>
      <ReportSurface
        eyebrow={
          <>
            RECORD · <span data-numeric="true">{recordId}</span>
          </>
        }
        title={verdict}
        support={support}
        chips={
          <>
            <span
              className="aurora-record-report__severity"
              data-severity={severity}
            >
              {SEVERITY_LABEL[severity]}
            </span>
            <span
              className="aurora-record-report__status"
              data-status={status}
            >
              {STATUS_LABEL[status]}
            </span>
            <Text variant="text-small" tone="tertiary" as="span">
              {module}
            </Text>
            <Text variant="text-small" tone="tertiary" as="span">
              Updated {lastUpdated}
            </Text>
          </>
        }
        actions={actions}
        sections={sections}
        navLabel="Record report sections"
      />
      {actionBar ? (
        <div className="aurora-record-report__footer" role="toolbar" aria-label="Record actions">
          {actionBar}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- Sections --- */

function ContextSection({
  items,
}: {
  items?: ReadonlyArray<RecordReportContextItem>;
}) {
  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="Context is not yet linked"
        body="Connect the record to its owning module and process to enable this section."
      />
    );
  }
  return (
    <dl className="aurora-record-report__context">
      {items.map((item) => (
        <div key={item.id} className="aurora-record-report__context-row">
          <dt>
            <Text variant="text-micro" tone="tertiary" as="span">
              {item.label}
            </Text>
          </dt>
          <dd>
            {item.href ? (
              <a
                className={clsx(
                  "aurora-record-report__context-link",
                  "aurora-focus-ring",
                )}
                href={item.href}
              >
                {item.value}
              </a>
            ) : (
              <Text variant="text-body" as="span">
                {item.value}
              </Text>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function WhatsWrongSection({
  findings,
  fixPlaybook,
}: {
  findings?: ReadonlyArray<RecordReportFinding>;
  fixPlaybook?: FixPlaybookProps;
}) {
  if (!findings || findings.length === 0) {
    return (
      <EmptyState
        title="No open findings on this record"
        body="Previously-resolved findings move to the activity log below."
      />
    );
  }
  return (
    <Stack direction="column" gap={4}>
      <ol className="aurora-record-report__findings">
        {findings.map((f) => (
          <li
            key={f.id}
            className="aurora-record-report__finding"
            data-severity={f.severity}
          >
            <header className="aurora-record-report__finding-head">
              <span
                className="aurora-record-report__severity"
                data-severity={f.severity}
              >
                {SEVERITY_LABEL[f.severity]}
              </span>
              <Text variant="text-small" tone="tertiary" as="span" numeric>
                {f.checkId}
              </Text>
              <FindingOriginChips finding={f} />
            </header>
            <Text variant="text-lead">{f.title}</Text>
            {f.evidence ? (
              <Text variant="text-small" tone="secondary">
                {f.evidence}
              </Text>
            ) : null}
            {f.appliesWhen ? (
              <AppliesWhenBlock appliesWhen={f.appliesWhen} />
            ) : null}
            {f.rootCause && f.rootCause.type !== "unknown" ? (
              <RootCauseBlock rootCause={f.rootCause} />
            ) : null}
            <div
              className="aurora-record-report__passrate"
              role="meter"
              aria-label={`Pass rate for ${f.checkId}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(f.passRate * 100)}
            >
              <div
                className="aurora-record-report__passrate-bar"
                style={
                  { "--aurora-ratio": f.passRate } as React.CSSProperties
                }
                aria-hidden
              />
              <Text variant="text-small" numeric as="span" tone="secondary">
                {(f.passRate * 100).toFixed(0)}%
              </Text>
            </div>
          </li>
        ))}
      </ol>
      {fixPlaybook ? <FixPlaybook {...fixPlaybook} /> : null}
    </Stack>
  );
}

/* ------------------------------------------------------ Origin chips --- */
/**
 * Row of chips describing the provenance/context of a finding:
 *   - cross-module: rule joined data from multiple modules
 *   - customer namespace: Z-table / Y-table (customer customisation)
 *   - root-cause category: bad data vs bad config vs mixed
 *
 * Rendered in the finding head alongside severity + checkId.
 */
function FindingOriginChips({ finding }: { finding: RecordReportFinding }) {
  const chips: ReactNode[] = [];

  if (finding.sourceModules && finding.sourceModules.length > 0) {
    chips.push(
      <Chip key="cross-module" tone="info">
        Cross-module · {finding.sourceModules.join(" + ")}
      </Chip>,
    );
  }

  if (finding.namespace === "customer") {
    chips.push(
      <Chip key="customer-ns" tone="info">
        Customer namespace
      </Chip>,
    );
  }

  if (finding.rootCause && finding.rootCause.type !== "unknown") {
    const tone: "warning" | "info" =
      finding.rootCause.type === "bad_data" ? "info" : "warning";
    chips.push(
      <Chip key="root-cause" tone={tone}>
        {ROOT_CAUSE_LABEL[finding.rootCause.type]}
      </Chip>,
    );
  }

  if (chips.length === 0) {
    return null;
  }
  return (
    <span
      className="aurora-record-report__origin-chips"
      aria-label="Finding origin"
    >
      {chips}
    </span>
  );
}

const ROOT_CAUSE_LABEL: Record<RecordReportRootCauseType, string> = {
  bad_data: "Data issue",
  bad_config: "Config issue",
  bad_data_and_config: "Data + config",
  unknown: "",
};

/* ---------------------------------------------------- Applies-when --- */
/**
 * Renders the rule's context predicate: "When MARA.MTART in FERT, HALB".
 * Signals to the reader that this rule does NOT apply to every record —
 * the pass_rate is scoped to the matching population.
 */
function AppliesWhenBlock({
  appliesWhen,
}: {
  appliesWhen: Record<string, ReadonlyArray<string>>;
}) {
  const entries = Object.entries(appliesWhen);
  if (entries.length === 0) return null;
  return (
    <div className="aurora-record-report__applies-when">
      <Text variant="text-small" tone="tertiary" as="span">
        Applies when
      </Text>{" "}
      <Text variant="text-small" tone="secondary" as="span">
        {entries.map(([field, values], idx) => (
          <span key={field}>
            {idx > 0 ? " and " : ""}
            <span data-numeric="true">{field}</span> in{" "}
            {values.join(", ")}
          </span>
        ))}
      </Text>
    </div>
  );
}

/* ------------------------------------------------------ Root cause --- */
/**
 * Expanded block below the finding evidence that explains WHY the finding
 * exists — bridging to Config Intelligence. Only rendered when rootCause
 * is bad_data, bad_config, or bad_data_and_config; "unknown" is the
 * signal to show nothing.
 */
function RootCauseBlock({
  rootCause,
}: {
  rootCause: RecordReportRootCause;
}) {
  return (
    <div
      className="aurora-record-report__root-cause"
      data-cause={rootCause.type}
      role="group"
      aria-label="Root cause"
    >
      <Text variant="text-small" tone="tertiary" as="p">
        Root cause — {ROOT_CAUSE_LABEL[rootCause.type]}
      </Text>
      <Text variant="text-body" as="p">
        {rootCause.reasoning}
      </Text>
      {rootCause.flaggedValuesInConfig &&
      rootCause.flaggedValuesInConfig.length > 0 ? (
        <div className="aurora-record-report__root-cause-list">
          <Text variant="text-small" tone="tertiary" as="span">
            Valid in your SPRO config:
          </Text>{" "}
          <Text variant="text-small" as="span" numeric>
            {rootCause.flaggedValuesInConfig.join(", ")}
          </Text>
        </div>
      ) : null}
      {rootCause.flaggedValuesNotInConfig &&
      rootCause.flaggedValuesNotInConfig.length > 0 ? (
        <div className="aurora-record-report__root-cause-list">
          <Text variant="text-small" tone="tertiary" as="span">
            Not in your SPRO config:
          </Text>{" "}
          <Text variant="text-small" as="span" numeric>
            {rootCause.flaggedValuesNotInConfig.join(", ")}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

function ConfigImpactSection({
  items,
}: {
  items?: ReadonlyArray<RecordReportConfigImpactItem>;
}) {
  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="No downstream impact"
        body="No SAP feature is blocked or degraded by the open findings on this record."
      />
    );
  }
  return (
    <ul className="aurora-record-report__impact">
      {items.map((item) => (
        <li
          key={item.id}
          className="aurora-record-report__impact-row"
          data-status={item.status}
        >
          <span
            className="aurora-record-report__impact-chip"
            data-status={item.status}
          >
            {CONFIG_STATUS_LABEL[item.status]}
          </span>
          <div>
            <Text variant="text-body">{item.feature}</Text>
            {item.rationale ? (
              <Text variant="text-small" tone="secondary">
                {item.rationale}
              </Text>
            ) : null}
          </div>
          {typeof item.opportunity === "number" ? (
            <Text variant="text-small" numeric as="span" tone="secondary">
              USD {item.opportunity.toLocaleString()}
            </Text>
          ) : (
            <Text variant="text-small" tone="tertiary" as="span">
              —
            </Text>
          )}
        </li>
      ))}
    </ul>
  );
}

function RelatedSection({
  items,
}: {
  items?: ReadonlyArray<RecordReportRelatedItem>;
}) {
  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="No related records yet"
        body="Dedup, reference, and golden-record peers surface here once matching runs on this record."
      />
    );
  }
  return (
    <ul className="aurora-record-report__related">
      {items.map((item) => {
        const inner = (
          <>
            <Stack direction="column" gap={1}>
              <Text variant="text-micro" tone="tertiary" as="span">
                {RELATED_KIND_LABEL[item.kind]}
              </Text>
              <Text variant="text-body" as="span">
                {item.label}
              </Text>
            </Stack>
            {item.detail ? (
              <Text variant="text-small" tone="secondary" as="span">
                {item.detail}
              </Text>
            ) : null}
          </>
        );
        return (
          <li key={item.id} className="aurora-record-report__related-row">
            {item.onOpen ? (
              <button
                type="button"
                className={clsx(
                  "aurora-record-report__related-btn",
                  "aurora-focus-ring",
                )}
                onClick={item.onOpen}
              >
                {inner}
              </button>
            ) : (
              <div className="aurora-record-report__related-static">
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function FixHistorySection({
  history,
}: {
  history?: RecordReportFixHistory;
}) {
  if (!history) {
    return (
      <EmptyState
        title="No prior fixes for this check"
        body="Once stewards resolve a finding for this check on any record, the history surfaces here."
      />
    );
  }
  return (
    <div className="aurora-record-report__history">
      <Stack direction="row" gap={4} align="start">
        <Stack direction="column" gap={1}>
          <Text variant="text-micro" tone="tertiary">
            Prior fixes
          </Text>
          <Text variant="display-sm" numeric>
            {history.count.toLocaleString()}
          </Text>
        </Stack>
        <Stack direction="column" gap={1}>
          <Text variant="text-micro" tone="tertiary">
            Avg. time to fix
          </Text>
          <Text variant="display-sm" numeric>
            {history.avgMinutes.toFixed(0)}
            <Text
              variant="text-small"
              tone="secondary"
              as="span"
            >
              {" "}
              min
            </Text>
          </Text>
        </Stack>
        <Stack direction="column" gap={1}>
          <Text variant="text-micro" tone="tertiary">
            Success rate
          </Text>
          <Text variant="display-sm" numeric>
            {(history.successRate * 100).toFixed(0)}%
          </Text>
        </Stack>
      </Stack>
      {history.series && history.series.length > 0 ? (
        <Sparkline<{ version: string; rate: number }>
          data={history.series.map((p) => ({
            version: p.version,
            rate: Math.round(p.rate * 100),
          }))}
          xKey="version"
          yKey="rate"
          height={48}
          width="100%"
          fill
          ariaLabel="Pass rate across analysis versions"
        />
      ) : null}
      <Text variant="text-small" tone="tertiary">
        Based on <span data-numeric="true">{history.count}</span> previous fixes
        on{" "}
        <Text variant="text-small" numeric as="span">
          {history.checkId}
        </Text>
        {history.label ? (
          <>
            {" "}
            ({history.label})
          </>
        ) : null}
        .
      </Text>
    </div>
  );
}

function ActivitySection({
  items,
}: {
  items?: ReadonlyArray<RecordReportActivityItem>;
}) {
  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="No activity recorded yet"
        body="Assignments, status changes, and comments will appear here as stewards work the record."
      />
    );
  }
  return (
    <ol className="aurora-record-report__activity">
      {items.map((item) => (
        <li key={item.id} className="aurora-record-report__activity-row">
          <time
            className="aurora-text aurora-record-report__activity-time"
            data-variant="text-micro"
            data-tone="tertiary"
            dateTime={item.timestamp}
          >
            {item.displayTime ?? item.timestamp}
          </time>
          <Text variant="text-body">
            <Text variant="text-body" as="span">
              {item.actor}
            </Text>{" "}
            <Text variant="text-body" tone="secondary" as="span">
              {item.action}
            </Text>
          </Text>
          {item.body ? (
            <Text variant="text-small" tone="secondary">
              {item.body}
            </Text>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

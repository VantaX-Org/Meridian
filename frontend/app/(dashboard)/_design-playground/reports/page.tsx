/**
 * Aurora WS7 — Reports gallery.
 *
 * Exercises `<RecordReport>` and `<ProcessReport>` with fixtures so both
 * long-scroll documents can be reviewed without a backend. Toggle between
 * Record and Process to exercise the anchored scroll nav, the
 * section-observer that highlights the active section, and the print-
 * style rules (use the browser's Print preview to validate).
 */

"use client";

import { useState } from "react";
import {
  Button,
  ProcessReport,
  type ProcessReportBlockingFinding,
  type ProcessReportConfigRow,
  type ProcessReportHierarchyNode,
  type ProcessReportReadinessPoint,
  type ProcessReportRecommendation,
  type ProcessReportVariantRow,
  RecordReport,
  type RecordReportActivityItem,
  type RecordReportConfigImpactItem,
  type RecordReportContextItem,
  type RecordReportFinding,
  type RecordReportFixHistory,
  type RecordReportRelatedItem,
  Stack,
  Text,
} from "@/components/aurora";
import type {
  ProcessEdgeData,
  ProcessNodeData,
} from "@/components/aurora";

/* -------------------------------------------------------------- Fixtures */

const RECORD_CONTEXT: ReadonlyArray<RecordReportContextItem> = [
  { id: "c-module", label: "Module", value: "Business Partner" },
  { id: "c-system", label: "Source system", value: "ECC · DE01" },
  {
    id: "c-golden",
    label: "Golden record",
    value: "BP-Golden-01842",
    href: "#",
  },
  {
    id: "c-process",
    label: "Process",
    value: "Order to cash · Credit check",
    href: "#",
  },
];

const RECORD_FINDINGS: ReadonlyArray<RecordReportFinding> = [
  {
    id: "f-1",
    checkId: "AP035",
    title: "Vendor account group references a value that's not in your SPRO config",
    severity: "critical",
    passRate: 0.12,
    evidence: "LFA1.KTOKK='0099' · T077Y baseline = 0001, 0002, 0003, 0004, CPD, KRED.",
    rootCause: {
      type: "bad_config",
      reasoning:
        "Flagged values are not present in your SPRO config — the rule's reference list may be stricter than your configuration, or the config itself has drifted from what the rule expects. Review SPRO before cleaning records.",
      elementType: "KTOKK",
      flaggedValuesNotInConfig: ["0099"],
    },
  },
  {
    id: "f-2",
    checkId: "XP2P001",
    title: "PO payment terms do not match vendor master payment terms",
    severity: "high",
    passRate: 0.48,
    evidence: "EKKO.ZTERM='0009' vs LFA1.ZTERM='0001'.",
    sourceModules: ["mm_purchasing", "accounts_payable"],
    rootCause: {
      type: "bad_data",
      reasoning:
        "All flagged values are valid in your SPRO config — the records are the problem, not the configuration. Apply a cleaning rule.",
      elementType: "ZTERM",
      flaggedValuesInConfig: ["0009"],
    },
  },
  {
    id: "f-3",
    checkId: "ZT002",
    title: "Supplier risk score is out of the 0–100 range",
    severity: "medium",
    passRate: 0.83,
    evidence: "LFA1.ZZ_SUPPLIER_RISK_SCORE='185' — expected 0–100.",
    namespace: "customer",
  },
  {
    id: "f-4",
    checkId: "MM143",
    title: "Serial number missing on serialised material",
    severity: "high",
    passRate: 0.64,
    evidence: "MARA.SERNR empty on 127 of 354 serialised materials.",
    appliesWhen: {
      "MARA.MTART": ["FERT", "HALB"],
    },
  },
];

const RECORD_IMPACT: ReadonlyArray<RecordReportConfigImpactItem> = [
  {
    id: "i-1",
    feature: "Automated VAT reporting (Germany)",
    status: "blocked",
    rationale: "STCD1 missing blocks DATEV-compatible line-item export.",
    opportunity: 120_000,
  },
  {
    id: "i-2",
    feature: "Dynamic credit-limit review",
    status: "degraded",
    rationale: "Address mismatch biases the credit score model.",
    opportunity: 24_000,
  },
  {
    id: "i-3",
    feature: "Intercompany billing",
    status: "aligned",
  },
];

const RECORD_RELATED: ReadonlyArray<RecordReportRelatedItem> = [
  {
    id: "r-1",
    label: "BP-1187642",
    kind: "dedup",
    detail: "match 0.94",
    onOpen: () => undefined,
  },
  {
    id: "r-2",
    label: "SO-0019448",
    kind: "referenced-by",
    detail: "open order",
    onOpen: () => undefined,
  },
  {
    id: "r-3",
    label: "BP-Golden-01842",
    kind: "golden-peer",
    detail: "owns 14 records",
    onOpen: () => undefined,
  },
];

const RECORD_HISTORY: RecordReportFixHistory = {
  checkId: "BP.COMPLETENESS.TAX_NUMBER",
  label: "Tax number",
  count: 218,
  avgMinutes: 11,
  successRate: 0.94,
  series: [
    { version: "v18", rate: 0.78 },
    { version: "v19", rate: 0.81 },
    { version: "v20", rate: 0.85 },
    { version: "v21", rate: 0.89 },
    { version: "v22", rate: 0.91 },
    { version: "v23", rate: 0.93 },
    { version: "v24", rate: 0.94 },
  ],
};

const RECORD_ACTIVITY: ReadonlyArray<RecordReportActivityItem> = [
  {
    id: "a-1",
    timestamp: "2026-04-22T12:16:00Z",
    displayTime: "14m ago",
    actor: "R. Sato",
    action: "took the record",
    body: null,
  },
  {
    id: "a-2",
    timestamp: "2026-04-22T12:17:00Z",
    displayTime: "13m ago",
    actor: "R. Sato",
    action: "requested SPRO tax-number reference",
  },
  {
    id: "a-3",
    timestamp: "2026-04-22T10:30:00Z",
    displayTime: "2h ago",
    actor: "System",
    action: "flagged record — BP.COMPLETENESS.TAX_NUMBER",
  },
];

/* ---- Process fixtures ---- */

const PROCESS_HIERARCHY: ReadonlyArray<ProcessReportHierarchyNode> = [
  {
    level: 1,
    id: "h-1",
    label: "Order to cash",
    module: "SD",
    score: 72,
    blocking: 6,
    children: [
      {
        level: 2,
        id: "h-1-1",
        label: "Sales order management",
        module: "SD",
        score: 86,
        blocking: 0,
      },
      {
        level: 2,
        id: "h-1-2",
        label: "Credit & risk",
        module: "FI-AR",
        score: 58,
        blocking: 4,
        children: [
          {
            level: 3,
            id: "h-1-2-1",
            label: "Credit-limit check",
            module: "FI-AR",
            score: 52,
            blocking: 3,
            children: [
              {
                level: 4,
                id: "h-1-2-1-1",
                label: "Risk class assignment",
                score: 70,
                blocking: 1,
              },
              {
                level: 4,
                id: "h-1-2-1-2",
                label: "Dynamic credit calculation",
                score: 40,
                blocking: 2,
              },
            ],
          },
        ],
      },
      {
        level: 2,
        id: "h-1-3",
        label: "Billing & revenue",
        module: "SD",
        score: 64,
        blocking: 2,
      },
    ],
  },
];

const PROCESS_NODES: ReadonlyArray<{ id: string; data: ProcessNodeData }> = [
  {
    id: "p1",
    data: {
      label: "Order captured",
      kind: "source",
      alignment: "aligned",
      stepId: "VA01",
    },
  },
  {
    id: "p2",
    data: {
      label: "Credit gate",
      kind: "decision",
      alignment: "blocked",
      stepId: "FD32",
      secondary: "412 blocked",
    },
  },
  {
    id: "p3",
    data: {
      label: "Delivery",
      kind: "transform",
      alignment: "aligned",
      stepId: "VL01N",
    },
  },
  {
    id: "p4",
    data: {
      label: "Billing",
      kind: "approval",
      alignment: "drifting",
      stepId: "VF01",
    },
  },
  {
    id: "p5",
    data: {
      label: "Payment cleared",
      kind: "sink",
      alignment: "aligned",
      stepId: "F-28",
    },
  },
];

const PROCESS_EDGES: ReadonlyArray<{
  id: string;
  source: string;
  target: string;
  data?: ProcessEdgeData;
}> = [
  { id: "pe1", source: "p1", target: "p2" },
  { id: "pe2", source: "p2", target: "p3" },
  { id: "pe3", source: "p3", target: "p4" },
  { id: "pe4", source: "p4", target: "p5" },
];

const PROCESS_VARIANTS: ReadonlyArray<ProcessReportVariantRow> = [
  { id: "v1", label: "Standard", cases: 8_412, quality: 92.4, coverage: 0.68 },
  {
    id: "v2",
    label: "Credit-check loop",
    cases: 2_108,
    quality: 74.2,
    coverage: 0.17,
  },
  {
    id: "v3",
    label: "Drop ship",
    cases: 1_204,
    quality: 81.1,
    coverage: 0.1,
  },
];

const PROCESS_CONFIG: ReadonlyArray<ProcessReportConfigRow> = [
  {
    id: "pc1",
    spro: "SD/Billing/Condition types",
    feature: "Intercompany billing",
    status: "blocked",
    findings: 4,
  },
  {
    id: "pc2",
    spro: "FI/A/R/Dunning procedures",
    feature: "Automated dunning",
    status: "degraded",
    findings: 2,
  },
  {
    id: "pc3",
    spro: "SD/Credit mgmt/Risk classes",
    feature: "Dynamic credit",
    status: "aligned",
  },
];

const PROCESS_BLOCKING: ReadonlyArray<ProcessReportBlockingFinding> = [
  {
    id: "pb1",
    severity: "critical",
    checkId: "BP.COMPLETENESS.TAX_NUMBER",
    title: "Tax number gap blocks DE billing runs",
    gate: "Credit-limit check",
    affected: 412,
    href: "#",
  },
  {
    id: "pb2",
    severity: "high",
    checkId: "FI.CONSISTENCY.DUNNING_PROCEDURE",
    title: "Dunning procedure missing on 128 accounts",
    gate: "Credit-limit check",
    affected: 128,
    href: "#",
  },
];

const PROCESS_READINESS: ReadonlyArray<ProcessReportReadinessPoint> = [
  { version: "v14", score: 61 },
  { version: "v15", score: 63 },
  { version: "v16", score: 64 },
  { version: "v17", score: 65 },
  { version: "v18", score: 64 },
  { version: "v19", score: 67 },
  { version: "v20", score: 69 },
  { version: "v21", score: 70 },
  { version: "v22", score: 71 },
  { version: "v23", score: 70 },
  { version: "v24", score: 72 },
];

const PROCESS_RECOMMENDATIONS: ReadonlyArray<ProcessReportRecommendation> = [
  {
    id: "rec-1",
    label: "Backfill tax numbers on 412 DE partners",
    owner: "Master Data Ops",
    effort: "medium",
    rationale:
      "Unblocks the credit gate and restores automated DE billing runs.",
  },
  {
    id: "rec-2",
    label: "Assign dunning procedure to 128 AR accounts",
    owner: "AR Team",
    effort: "low",
    rationale:
      "Reinstates automated dunning on the affected accounts.",
  },
  {
    id: "rec-3",
    label: "Retune dynamic credit model on the cleaned sample",
    owner: "FI-AR",
    effort: "high",
    rationale:
      "Required after master-data cleanup — prior model biased by mismatches.",
  },
];

/* ------------------------------------------------------------------ Page */

type ReportKind = "record" | "process";

export default function ReportsPlayground() {
  const [kind, setKind] = useState<ReportKind>("record");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Stack direction="column" gap={2}>
        <Text variant="text-micro" tone="tertiary">
          AURORA · WS7 · REPORTS
        </Text>
        <Text variant="display-sm">
          Record Report and Process Report — long-scroll documents with
          anchored navigation.
        </Text>
        <Text variant="text-small" tone="secondary">
          Scroll to see the right-hand nav track the active section. Open
          your browser&apos;s Print preview to verify the print layout drops the
          nav and collapses to a single column.
        </Text>
      </Stack>

      <Stack direction="row" gap={2}>
        <Button
          variant={kind === "record" ? "primary" : "ghost"}
          size="sm"
          onClick={() => setKind("record")}
        >
          Record Report
        </Button>
        <Button
          variant={kind === "process" ? "primary" : "ghost"}
          size="sm"
          onClick={() => setKind("process")}
        >
          Process Report
        </Button>
      </Stack>

      {kind === "record" ? (
        <RecordReport
          recordId="BP-1203187"
          module="Business Partner · ECC · DE01"
          verdict="A missing tax number on this DE-registered partner blocks two billing runs."
          support="Apply the canonical SPRO reference, re-score, and notify AR."
          severity="critical"
          status="in_progress"
          lastUpdated="14m ago"
          actions={
            <>
              <Button variant="ghost" size="sm">
                Copy link
              </Button>
              <Button variant="ghost" size="sm">
                Export PDF
              </Button>
              <Button variant="ghost" size="sm">
                Open drawer
              </Button>
            </>
          }
          context={RECORD_CONTEXT}
          findings={RECORD_FINDINGS}
          fixPlaybook={{
            title: "Three-step remediation",
            steps: [
              {
                id: "s1",
                label: "Pull canonical tax number from SPRO reference",
                status: "done",
              },
              {
                id: "s2",
                label: "Apply to BP-1203187 and 10 sibling records",
                status: "running",
              },
              {
                id: "s3",
                label: "Re-score record and notify AR team",
                status: "pending",
              },
            ],
          }}
          configImpact={RECORD_IMPACT}
          related={RECORD_RELATED}
          fixHistory={RECORD_HISTORY}
          activity={RECORD_ACTIVITY}
          actionBar={
            <>
              <Button variant="ghost" size="sm">
                Escalate
              </Button>
              <Button variant="ghost" size="sm">
                Reject
              </Button>
              <Button variant="primary" size="sm">
                Approve
              </Button>
              <Button variant="ghost" size="sm">
                Apply to 10 siblings
              </Button>
            </>
          }
        />
      ) : (
        <ProcessReport
          processSlug="order-to-cash"
          processName="Order to cash"
          verdict="Order to cash is held back by a credit-gate config gap — 412 billing documents cannot close."
          support="Readiness is 72 / 100; the credit-limit gate is the only blocking step."
          readiness={72}
          readinessSemantic="at-risk"
          owner="Finance · AR"
          lastUpdated="this morning"
          actions={
            <>
              <Button variant="ghost" size="sm">
                Copy link
              </Button>
              <Button variant="ghost" size="sm">
                Export PDF
              </Button>
            </>
          }
          hierarchy={PROCESS_HIERARCHY}
          graph={{
            nodes: PROCESS_NODES.slice(),
            edges: PROCESS_EDGES.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              data: e.data,
            })),
          }}
          variants={PROCESS_VARIANTS}
          configAlignment={PROCESS_CONFIG}
          blockingFindings={PROCESS_BLOCKING}
          readinessHistory={PROCESS_READINESS}
          recommendations={PROCESS_RECOMMENDATIONS}
        />
      )}
    </div>
  );
}

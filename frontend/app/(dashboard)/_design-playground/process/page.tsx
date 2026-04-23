/**
 * Aurora WS7 — Process surface gallery.
 *
 * Exercises `<Process>` with realistic fixtures: a ranked process
 * picker on the left, a tabbed map / variants / cases / config-impact
 * view on the right. Use this page to smoke-test the shell before
 * hooking up `/api/v1/mining`, `/api/v1/business-process`, and
 * `/api/v1/config-impact` in pass 2.
 */

"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Process,
  type ProcessCase,
  type ProcessConfigImpactRow,
  type ProcessPick,
  type ProcessTabId,
  type ProcessVariant,
  Stack,
  Text,
} from "@/components/aurora";
import type { ProcessEdgeData, ProcessNodeData } from "@/components/aurora";

/* -------------------------------------------------------------- Fixtures */

const FIXTURE_PROCESSES: ReadonlyArray<ProcessPick> = [
  {
    id: "order-to-cash",
    label: "Order to cash",
    support: "SD · OTC · 12,418 cases",
    readiness: "at-risk",
    score: 72,
  },
  {
    id: "procure-to-pay",
    label: "Procure to pay",
    support: "MM · PTP · 9,214 cases",
    readiness: "blocked",
    score: 58,
  },
  {
    id: "record-to-report",
    label: "Record to report",
    support: "FI · RTR · 3,102 cases",
    readiness: "ready",
    score: 91,
  },
  {
    id: "hire-to-retire",
    label: "Hire to retire",
    support: "SF · HTR · 1,402 cases",
    readiness: "at-risk",
    score: 78,
  },
];

const FIXTURE_NODES: ReadonlyArray<{
  id: string;
  data: ProcessNodeData;
}> = [
  {
    id: "n1",
    data: {
      label: "Sales order created",
      kind: "source",
      alignment: "aligned",
      stepId: "VA01",
      secondary: "12,418 cases",
    },
  },
  {
    id: "n2",
    data: {
      label: "Credit check",
      kind: "decision",
      alignment: "drifting",
      stepId: "FD32",
      secondary: "3 variants",
    },
  },
  {
    id: "n3",
    data: {
      label: "Delivery scheduled",
      kind: "transform",
      alignment: "aligned",
      stepId: "VL01N",
      secondary: "11,004 cases",
    },
  },
  {
    id: "n4",
    data: {
      label: "Billing document",
      kind: "approval",
      alignment: "blocked",
      stepId: "VF01",
      secondary: "412 blocked",
    },
  },
  {
    id: "n5",
    data: {
      label: "Payment cleared",
      kind: "sink",
      alignment: "aligned",
      stepId: "F-28",
    },
  },
];

const FIXTURE_EDGES: ReadonlyArray<{
  id: string;
  source: string;
  target: string;
  data?: ProcessEdgeData;
}> = [
  { id: "e1", source: "n1", target: "n2" },
  { id: "e2", source: "n2", target: "n3", data: { label: "pass" } },
  { id: "e3", source: "n3", target: "n4" },
  { id: "e4", source: "n4", target: "n5" },
];

const FIXTURE_VARIANTS: ReadonlyArray<ProcessVariant> = [
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
  {
    id: "v4",
    label: "Return to sender",
    cases: 694,
    quality: 58.6,
    coverage: 0.05,
  },
];

const FIXTURE_CASES: ReadonlyArray<ProcessCase> = [
  {
    id: "c1",
    caseId: "SO-0019448",
    variant: "Standard",
    duration: "2d 4h",
    quality: 94.1,
    blocking: 0,
  },
  {
    id: "c2",
    caseId: "SO-0019432",
    variant: "Credit-check loop",
    duration: "6d 1h",
    quality: 71.3,
    blocking: 1,
  },
  {
    id: "c3",
    caseId: "SO-0019421",
    variant: "Standard",
    duration: "1d 22h",
    quality: 96.2,
    blocking: 0,
  },
  {
    id: "c4",
    caseId: "SO-0019402",
    variant: "Drop ship",
    duration: "4d 8h",
    quality: 78.9,
    blocking: 1,
  },
];

const FIXTURE_CONFIG: ReadonlyArray<ProcessConfigImpactRow> = [
  {
    id: "ci1",
    spro: "SD/Billing/Condition types",
    feature: "Intercompany billing",
    status: "blocked",
    findings: 4,
    opportunity: 280_000,
  },
  {
    id: "ci2",
    spro: "FI/A/R/Dunning procedures",
    feature: "Automated dunning",
    status: "degraded",
    findings: 2,
    opportunity: 42_000,
  },
  {
    id: "ci3",
    spro: "SD/Credit mgmt/Risk classes",
    feature: "Dynamic credit",
    status: "aligned",
    findings: 0,
  },
];

/* ------------------------------------------------------------------ Page */

export default function ProcessPlayground() {
  const [selected, setSelected] = useState("order-to-cash");
  const [activeTab, setActiveTab] = useState<ProcessTabId>("map");

  const activeProcess = useMemo(
    () => FIXTURE_PROCESSES.find((p) => p.id === selected) ?? FIXTURE_PROCESSES[0]!,
    [selected],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Stack direction="column" gap={2}>
        <Text variant="text-micro" tone="tertiary">
          AURORA · WS7 · PROCESS
        </Text>
        <Text variant="display-sm">
          Process map, variants, cases, and configuration impact.
        </Text>
        <Text variant="text-small" tone="secondary">
          Switch processes via the left rail; tabs keep their own selection
          per process. Celonis-style calibration with Aurora density.
        </Text>
      </Stack>

      <Process
        verdict={{
          eyebrow: `READINESS · ${activeProcess.score ?? 0}`,
          sentence:
            activeProcess.readiness === "blocked"
              ? `${activeProcess.label} is blocked — config gaps stop 412 billing documents from closing.`
              : activeProcess.readiness === "at-risk"
                ? `${activeProcess.label} is at risk — one variant exceeds the SLA envelope.`
                : `${activeProcess.label} is ready — no blocking gaps in this analysis window.`,
          support: `${(activeProcess.support ?? "") as string}`,
          semantic:
            activeProcess.readiness === "blocked"
              ? "danger"
              : activeProcess.readiness === "at-risk"
                ? "warning"
                : "success",
          actions: (
            <>
              <Button variant="primary" size="sm">
                Open process report
              </Button>
              <Button variant="ghost" size="sm">
                Export variants
              </Button>
            </>
          ),
        }}
        processes={FIXTURE_PROCESSES}
        selectedProcess={selected}
        onSelectedProcessChange={(id) => {
          setSelected(id);
          setActiveTab("map");
        }}
        tabs={[
          { id: "map", label: "Map" },
          { id: "variants", label: "Variants", count: FIXTURE_VARIANTS.length },
          { id: "cases", label: "Cases", count: FIXTURE_CASES.length },
          {
            id: "config-impact",
            label: "Config impact",
            count: FIXTURE_CONFIG.length,
          },
          { id: "report", label: "Report" },
        ]}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        graph={{
          nodes: FIXTURE_NODES.slice(),
          edges: FIXTURE_EDGES.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            data: e.data,
          })),
        }}
        variants={FIXTURE_VARIANTS}
        cases={FIXTURE_CASES}
        configImpact={FIXTURE_CONFIG}
        report={
          <Text variant="text-small" tone="secondary">
            Process report renders in the `/_design-playground/reports` page.
          </Text>
        }
      />
    </div>
  );
}

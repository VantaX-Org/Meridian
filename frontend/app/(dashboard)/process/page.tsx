/**
 * Aurora · Process — live-data route (WS8 complete).
 *
 * Fourth Aurora workspace. Wires the Process surface to the existing
 * business-process hierarchy API (/api/v1/business-process/<version>/<module>).
 * Mapping:
 *   BusinessProcessL1  → ProcessPick (left-rail entry)
 *   BusinessProcessL3  → ProcessVariant (each L3 process is a variant
 *                         of the parent L1, with readiness as quality)
 *   L2 → L3 sequence   → ProcessGraph nodes + edges (simple hierarchical
 *                         rendering; a full mining-graph API would
 *                         provide activity-level transitions, not
 *                         available yet)
 *   Cases / Config Impact tabs → honest empty states — the data for
 *                         those is a different API shape that hasn't
 *                         landed yet
 *
 * Completes the four-workspace Aurora set (§6.1). Process pass 2 — once
 * the mining-graph API exposes activity-level data — will replace this
 * hierarchical mapping with real cases and variants.
 */

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  Banner,
  EmptyState,
  Process,
  Stack,
  Text,
  type ProcessPick,
  type ProcessReadiness,
  type ProcessTabId,
  type ProcessVariant,
} from "@/components/aurora";
import { getVersions } from "@/lib/api/versions";
import { getBusinessProcess } from "@/lib/api/connectivity";
import type {
  BusinessProcessL1,
  BusinessProcessL3,
  Version,
} from "@/types/api";

const DEFAULT_MODULE = "business_partner";

/* -------------------------------------------------------- Helpers --- */

function readinessFromL1(l1: BusinessProcessL1): ProcessReadiness {
  const all = l1.l2_groups.flatMap((l2) => l2.l3_processes);
  if (all.length === 0) return "ready";
  const red = all.filter((l3) => l3.overall_readiness === "red").length;
  const amber = all.filter((l3) => l3.overall_readiness === "amber").length;
  if (red > 0) return "blocked";
  if (amber > 0) return "at-risk";
  return "ready";
}

function scoreFromL1(l1: BusinessProcessL1): number {
  const all = l1.l2_groups.flatMap((l2) => l2.l3_processes);
  if (all.length === 0) return 100;
  const green = all.filter((l3) => l3.overall_readiness === "green").length;
  return Math.round((green / all.length) * 100);
}

function variantsFromL1(l1: BusinessProcessL1): ReadonlyArray<ProcessVariant> {
  const l3s: BusinessProcessL3[] = l1.l2_groups.flatMap((l2) => l2.l3_processes);
  const total = l3s.length || 1;
  return l3s.map((l3) => ({
    id: l3.l3_id,
    label: l3.l3_name + (l3.tcode ? ` (${l3.tcode})` : ""),
    cases: l3.l4_steps.length,
    quality:
      l3.overall_readiness === "green"
        ? 100
        : l3.overall_readiness === "amber"
        ? 60
        : 25,
    coverage: 1 / total,
  }));
}

type GraphNode = {
  id: string;
  data: {
    label: string;
    kind: "source" | "transform" | "decision" | "approval" | "sink";
    alignment: "aligned" | "drifting" | "blocked" | "unknown";
    secondary?: string;
  };
};
type GraphEdge = { id: string; source: string; target: string };

function alignmentFromReadiness(
  r: "green" | "amber" | "red",
): "aligned" | "drifting" | "blocked" {
  if (r === "green") return "aligned";
  if (r === "amber") return "drifting";
  return "blocked";
}

function nodesAndEdgesFromL1(
  l1: BusinessProcessL1,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Synthesise a left-to-right process graph: root = L1 → L2 groups →
  // L3 processes. A real mining-graph API would expose activity-level
  // transitions; this structural view still gives the user a sense of
  // the process shape.
  const nodes: GraphNode[] = [
    {
      id: l1.l1_id,
      data: { label: l1.l1_name, kind: "source", alignment: "aligned" },
    },
  ];
  const edges: GraphEdge[] = [];

  l1.l2_groups.forEach((l2) => {
    nodes.push({
      id: l2.l2_id,
      data: { label: l2.l2_name, kind: "transform", alignment: "aligned" },
    });
    edges.push({
      id: `${l1.l1_id}->${l2.l2_id}`,
      source: l1.l1_id,
      target: l2.l2_id,
    });
    l2.l3_processes.forEach((l3) => {
      nodes.push({
        id: l3.l3_id,
        data: {
          label: l3.tcode || l3.l3_name,
          kind: "transform",
          alignment: alignmentFromReadiness(l3.overall_readiness),
          secondary: l3.l3_name !== l3.tcode ? l3.l3_name : undefined,
        },
      });
      edges.push({
        id: `${l2.l2_id}->${l3.l3_id}`,
        source: l2.l2_id,
        target: l3.l3_id,
      });
    });
  });

  return { nodes, edges };
}

/* ---------------------------------------------------------- Page --- */

export default function ProcessPage() {
  const [activeTab, setActiveTab] = useState<ProcessTabId>("map");

  const versionsQuery = useQuery({
    queryKey: ["aurora.process.versions"],
    queryFn: () => getVersions({ limit: 20 }),
    retry: (n, e) => !(e instanceof AxiosError) || n < 1,
  });

  const completedVersions: Version[] = (versionsQuery.data?.versions ?? []).filter(
    (v: Version) => v.status === "complete",
  );
  const versionId = completedVersions[0]?.id ?? "";

  const processQuery = useQuery({
    queryKey: ["aurora.process.business-process", versionId, DEFAULT_MODULE],
    queryFn: () => getBusinessProcess(versionId, DEFAULT_MODULE),
    enabled: Boolean(versionId),
    retry: (n, e) => !(e instanceof AxiosError) || n < 1,
  });

  const l1List: ReadonlyArray<BusinessProcessL1> = processQuery.data ?? [];
  const picks: ReadonlyArray<ProcessPick> = useMemo(
    () =>
      l1List.map((l1) => ({
        id: l1.l1_id,
        label: l1.l1_name,
        readiness: readinessFromL1(l1),
        score: scoreFromL1(l1),
        support: l1.l1_description?.slice(0, 80),
      })),
    [l1List],
  );

  const [selectedProcess, setSelectedProcess] = useState<string>("");
  // Default selection = first pick once data arrives.
  const effectiveSelected =
    selectedProcess || picks[0]?.id || "";

  const selectedL1 = l1List.find((l1) => l1.l1_id === effectiveSelected);
  const variants = selectedL1 ? variantsFromL1(selectedL1) : [];
  const graph = selectedL1
    ? {
        ...nodesAndEdgesFromL1(selectedL1),
        direction: "LR" as const,
      }
    : undefined;

  // Versions not ready or no complete version → friendly empty state.
  if (!versionsQuery.isLoading && completedVersions.length === 0) {
    return (
      <div style={{ padding: "var(--aurora-space-6)" }}>
        <EmptyState
          title="No completed analyses yet"
          body="Process discovery requires a completed analysis. Run one from Import to get started."
        />
      </div>
    );
  }
  if (processQuery.isError) {
    return (
      <div style={{ padding: "var(--aurora-space-6)" }}>
        <Banner tone="danger">
          <Text variant="text-body">
            Couldn&apos;t reach the business-process API. Confirm the
            most recent analysis completed successfully.
          </Text>
        </Banner>
      </div>
    );
  }
  if (!processQuery.isLoading && l1List.length === 0) {
    return (
      <div style={{ padding: "var(--aurora-space-6)" }}>
        <EmptyState
          title="No processes discovered for this module"
          body="Process discovery runs during each analysis. Try selecting a different module or running a fresh analysis."
        />
      </div>
    );
  }

  const casesEmpty = (
    <EmptyState
      title="Case-level view pending"
      body="Per-case activity timelines require the mining-graph API (activity-level events). Hierarchical data alone doesn't expose case traces. Pass 2 wires this tab once that API ships."
    />
  );
  const configImpactEmpty = (
    <EmptyState
      title="Config impact view is on the Config Impact page"
      body="A consolidated Process-scoped config-impact breakdown is planned for pass 2. Meanwhile, open the Config Impact legacy page from the sidebar."
    />
  );

  return (
    <Process
      verdict={{
        sentence:
          l1List.length > 0
            ? `${l1List.length} process area${l1List.length === 1 ? "" : "s"} discovered`
            : "No processes yet",
        support: selectedL1?.l1_description ?? "Pick a process on the left to inspect its variants and structure.",
        semantic:
          picks.some((p) => p.readiness === "blocked")
            ? "warning"
            : picks.some((p) => p.readiness === "at-risk")
            ? "warning"
            : "success",
      }}
      processes={picks}
      selectedProcess={effectiveSelected}
      onSelectedProcessChange={setSelectedProcess}
      tabs={[
        { id: "map", label: "Map" },
        {
          id: "variants",
          label: "Variants",
          count: variants.length,
        },
        { id: "cases", label: "Cases" },
        { id: "config-impact", label: "Config Impact" },
      ]}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      graph={graph}
      variants={variants}
      cases={activeTab === "cases" ? [] : undefined}
      configImpact={activeTab === "config-impact" ? [] : undefined}
      report={
        activeTab === "cases"
          ? casesEmpty
          : activeTab === "config-impact"
          ? configImpactEmpty
          : undefined
      }
    />
  );
}

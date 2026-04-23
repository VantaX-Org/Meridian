/**
 * Aurora · Process — live-data route.
 *
 * Primary source: /api/v1/process/mining/graph/{version}/{module} — returns
 * activity-level nodes + transitions + variants derived from the L4 steps
 * of the business-process document. Case-level traces stay empty until a
 * real event log pipeline lands (cases_supported=false).
 *
 * Fallback: if the mining-graph endpoint is unreachable or returns an
 * empty body, we fall back to synthesising nodes from the business-process
 * hierarchy so the page still renders a useful shape.
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
import {
  getMiningGraph,
  type MiningActivity,
  type MiningGraphResponse,
  type MiningTransition,
} from "@/lib/api/process-mining";
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

/* --- Mining-graph → Aurora graph helpers (preferred data path) --- */

function nodesAndEdgesFromMining(
  activities: ReadonlyArray<MiningActivity>,
  transitions: ReadonlyArray<MiningTransition>,
  selectedL3Id?: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const scoped = selectedL3Id
    ? activities.filter((a) => a.l3_id === selectedL3Id)
    : activities;
  const scopedIds = new Set(scoped.map((a) => a.id));
  const nodes: GraphNode[] = scoped.map((a) => ({
    id: a.id,
    data: {
      label: a.label,
      kind: "transform",
      alignment: alignmentFromReadiness(a.step_status as "green" | "amber" | "red"),
      secondary: a.affected_records > 0 ? `${a.affected_records} affected` : undefined,
    },
  }));
  const edges: GraphEdge[] = transitions
    .filter((t) => scopedIds.has(t.from) && scopedIds.has(t.to))
    .map((t) => ({ id: `${t.from}->${t.to}`, source: t.from, target: t.to }));
  return { nodes, edges };
}

function variantsFromMining(
  variants: MiningGraphResponse["variants"],
): ReadonlyArray<ProcessVariant> {
  return variants.map((v) => ({
    id: v.id,
    label: v.label + (v.tcode ? ` (${v.tcode})` : ""),
    cases: v.activity_count,
    quality: v.quality,
    coverage: v.coverage,
  }));
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

  // Preferred source: activity-level mining graph. Falls back silently to
  // the L1 hierarchy if the endpoint returns an error.
  const miningQuery = useQuery({
    queryKey: ["aurora.process.mining-graph", versionId, DEFAULT_MODULE],
    queryFn: () => getMiningGraph(versionId, DEFAULT_MODULE),
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

  // Prefer mining graph data when the endpoint returned a non-empty payload.
  // L1s in this module all share the activity set; we scope by variants tied
  // to L3s within the selected L1 (the hierarchy knows which L3 belongs where).
  const miningGraph = miningQuery.data;
  const miningAvailable =
    !!miningGraph && miningGraph.activities.length > 0;

  const l3IdsInSelectedL1 = selectedL1
    ? new Set(
        selectedL1.l2_groups.flatMap((l2) =>
          l2.l3_processes.map((l3) => l3.l3_id),
        ),
      )
    : new Set<string>();

  const variants: ReadonlyArray<ProcessVariant> = miningAvailable
    ? variantsFromMining(
        miningGraph!.variants.filter((v) => l3IdsInSelectedL1.has(v.id)),
      )
    : selectedL1
    ? variantsFromL1(selectedL1)
    : [];

  const graph = miningAvailable
    ? {
        ...nodesAndEdgesFromMining(
          miningGraph!.activities.filter((a) => l3IdsInSelectedL1.has(a.l3_id)),
          miningGraph!.transitions,
        ),
        direction: "LR" as const,
      }
    : selectedL1
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
      body={
        miningGraph && !miningGraph.cases_supported
          ? "Per-case activity timelines require an event-log pipeline that captures real transaction traces. The mining-graph surfaces activities and variants today; individual cases land once change-log ingestion ships."
          : "Per-case activity timelines need the event-log ingestion path. Activity and variant data are already live; cases will follow."
      }
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

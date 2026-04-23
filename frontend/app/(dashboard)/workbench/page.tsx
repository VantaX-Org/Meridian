/**
 * Aurora · Workbench — live-data route (WS8 part 4).
 *
 * The steward's home: triage table wired to `/api/v1/findings` with the
 * new backend signals surfaced inline — root_cause / cross_module /
 * customer-namespace origin markers on each row (via
 * findingOriginForWorkbench), full context in the record drawer (via
 * findingsToRecordReport).
 *
 * Per Aurora spec §8 the Workbench is where the work gets done. Keeps
 * the existing `/stewardship` route untouched so users bookmarked there
 * are not disrupted; `/workbench` is the Aurora URL going forward.
 */

"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  Banner,
  Button,
  EmptyState,
  RecordReport,
  Text,
  Workbench,
  type WorkbenchTabId,
  type WorkbenchTabState,
} from "@/components/aurora";
import { findingsToRecordReport } from "@/lib/aurora";
import { composeWorkbenchRows } from "@/lib/api/workbench";
import { getFindings } from "@/lib/api/findings";

export default function WorkbenchPage() {
  const findingsQuery = useQuery({
    queryKey: ["aurora.workbench.findings"],
    queryFn: () => getFindings({ limit: 200 }),
    retry: (count, err) => !(err instanceof AxiosError) || count < 1,
  });

  const [activeTab, setActiveTab] = useState<WorkbenchTabId>("triage");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(
    () => composeWorkbenchRows(findingsQuery.data),
    [findingsQuery.data],
  );

  const selectedFinding = useMemo(() => {
    if (!selectedId) return null;
    return findingsQuery.data?.findings?.find((f) => f.id === selectedId) ?? null;
  }, [selectedId, findingsQuery.data]);

  const drawerFindings = useMemo(
    () =>
      selectedFinding ? findingsToRecordReport([selectedFinding]) : [],
    [selectedFinding],
  );

  // Empty-state per spec §11: never "No data" alone; teach + direct.
  if (!findingsQuery.isLoading && rows.length === 0) {
    return (
      <div style={{ padding: "var(--aurora-space-6)" }}>
        <EmptyState
          title="No open findings on any module"
          body="Run a new analysis on an SAP extract to surface findings here."
          actions={<Button variant="primary">Run analysis</Button>}
        />
      </div>
    );
  }

  if (findingsQuery.isError) {
    return (
      <div style={{ padding: "var(--aurora-space-6)" }}>
        <Banner tone="danger">
          <Text variant="text-body">
            Couldn&apos;t reach the findings API. Confirm the analysis
            worker is running and retry.
          </Text>
        </Banner>
      </div>
    );
  }

  const tabs: ReadonlyArray<WorkbenchTabState> = [
    { id: "triage", label: "Triage", count: rows.length },
    { id: "golden-records", label: "Golden records" },
    { id: "glossary", label: "Glossary" },
    { id: "analyses", label: "Analyses" },
    { id: "reports", label: "Reports" },
  ];

  return (
    <Workbench
      verdict={{
        sentence:
          rows.length > 0
            ? `${rows.length} open findings across your modules`
            : "Queue is clear",
        support: "Triage by severity; drawer shows root-cause classification.",
        semantic: rows.length > 0 ? "warning" : "success",
      }}
      tabs={tabs}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      rows={rows}
      onRowActivate={(row) => setSelectedId(row.id)}
      selected={selectedId}
      onSelectedChange={setSelectedId}
      onSelectedStep={(delta) => {
        if (!selectedId) return;
        const idx = rows.findIndex((r) => r.id === selectedId);
        if (idx < 0) return;
        const next = rows[idx + delta];
        if (next) setSelectedId(next.id);
      }}
      drawer={
        selectedFinding ? (
          <RecordReport
            recordId={selectedFinding.check_id}
            module={selectedFinding.module}
            verdict={
              (selectedFinding.details as { message?: string } | undefined)
                ?.message ?? selectedFinding.check_id
            }
            severity={
              (selectedFinding.severity as
                | "critical"
                | "high"
                | "medium"
                | "low") ?? "medium"
            }
            status="open"
            lastUpdated={new Date(selectedFinding.created_at).toLocaleString()}
            findings={drawerFindings}
          />
        ) : null
      }
    />
  );
}

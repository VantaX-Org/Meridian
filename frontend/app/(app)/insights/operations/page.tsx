"use client";

/** Insights › Operations: team throughput, bottlenecks, capacity and sprint plans. */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Card, DataTable, ReportPage, Select, Stat } from "@/design";
import { getAssignableUsers } from "@/lib/api/users";
import {
  getOperational, getSprints, getTeamPerformance, type Bottleneck, type SprintPlan,
} from "@/lib/api/analytics";
import { apiErrorMessage, isListFailure } from "@/lib/error";

const bottleneckColumns: ColumnDef<Bottleneck>[] = [
  { accessorKey: "stage", header: "Stage" },
  { accessorKey: "count", header: "Items" },
  { accessorKey: "avg_age_hours", header: "Average age (h)" },
  { accessorKey: "recommendation", header: "Recommendation" },
];

const sprintColumns: ColumnDef<SprintPlan>[] = [
  { accessorKey: "name", header: "Sprint" },
  { accessorKey: "total_effort_hours", header: "Effort (h)" },
  { accessorKey: "records_fixed", header: "Records fixed" },
  { accessorKey: "critical_cleared", header: "Criticals cleared" },
  { id: "dqs", header: "DQS", cell: ({ row }) => `${row.original.dqs_now ?? "—"} to ${row.original.dqs_projected ?? "—"}` },
  { id: "cost", header: "Estimated cost", cell: ({ row }) => row.original.estimated_cost == null ? "—" : `${row.original.estimated_cost.toLocaleString()} ${row.original.currency}` },
];

function TeamCard() {
  const [userId, setUserId] = useState("");
  const users = useQuery({ queryKey: ["assignable-users"], queryFn: getAssignableUsers });
  const perf = useQuery({ queryKey: ["analytics", "team", userId], queryFn: () => getTeamPerformance(userId), enabled: userId !== "" });
  const s = perf.data?.summary;
  return (
    <Card title="Team member">
      <div className="flex flex-col gap-3">
        <Select
          value={userId}
          onValueChange={setUserId}
          placeholder="Choose a team member"
          options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name || u.email }))}
        />
        {s ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Processed" value={s.total_processed} />
            <Stat label="Approval rate" value={`${s.approval_rate}%`} />
            <Stat label="Review hours" value={s.total_review_hours} />
            <Stat label="Hours per item" value={s.avg_review_hours} />
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Pick someone to see their throughput and approval rate.</p>
        )}
      </div>
    </Card>
  );
}

export default function OperationsPage() {
  const ops = useQuery({ queryKey: ["analytics", "operational"], queryFn: getOperational });
  const sprints = useQuery({ queryKey: ["analytics", "sprints"], queryFn: () => getSprints() });
  const k = ops.data?.kpis;
  const bottlenecks = ops.data?.bottlenecks ?? [];
  const plans = sprints.data?.sprints ?? [];
  const cap = ops.data?.capacity;
  const loading = ops.isLoading || sprints.isLoading;
  const failed = isListFailure(ops) ? ops : isListFailure(sprints) ? sprints : null;
  const empty = !loading && !failed && bottlenecks.length === 0 && plans.length === 0 && !k?.items_in_flight;

  return (
    <ReportPage
      narrative={cap?.recommendation ?? ""}
      charts={
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Throughput" value={k?.throughput ?? "—"} />
            <Stat label="Automation rate" value={k ? `${k.automation_rate}%` : "—"} />
            <Stat label="Time to resolve (h)" value={k?.mttr_hours ?? "—"} />
            <Stat label="SLA compliance" value={k ? `${k.sla_compliance_pct}%` : "—"} />
            <Stat label="In flight" value={k?.items_in_flight ?? "—"} />
            <Stat label="Average queue age (h)" value={k?.avg_queue_age_hours ?? "—"} />
            <Stat label="Stewards needed" value={cap?.needed ?? "—"} hint={cap ? `${cap.current} now` : undefined} />
            <Stat label="Capacity gap" value={cap?.surplus_deficit ?? "—"} />
          </div>
          <Bar data={bottlenecks.map((b) => ({ x: b.stage, y: b.avg_age_hours }))} label="Average age by stage (hours)" />
        </div>
      }
      tables={
        <div className="flex flex-col gap-6">
          <TeamCard />
          <DataTable columns={bottleneckColumns} data={bottlenecks} getRowId={(r) => r.stage} />
          <DataTable columns={sprintColumns} data={plans} getRowId={(r) => String(r.sprint_number)} />
        </div>
      }
      state={loading ? "loading" : failed ? "error" : empty ? "empty" : undefined}
      emptyProps={{ title: "No queue activity to analyse yet.", detail: "Throughput, bottlenecks and sprint plans appear once cleaning items exist." }}
      errorProps={{ message: apiErrorMessage(failed?.error), onRetry: () => { void ops.refetch(); void sprints.refetch(); } }}
    />
  );
}

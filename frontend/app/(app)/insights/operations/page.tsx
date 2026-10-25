"use client";

/** Insights › Operations: team throughput, bottlenecks, capacity and sprint plans. */

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Button, Card, DataTable, DrillLink, EmptyState, Mono, Select, Stat } from "@/design";
import { getAssignableUsers } from "@/lib/api/users";
import {
  getOperational, getSprints, getTeamPerformance, type Bottleneck, type SprintPlan,
} from "@/lib/api/analytics";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { fixHref } from "@/lib/drill";
import { labelOf, plural } from "@/lib/format";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { Section } from "../_components/Section";
import { useInsightScope } from "../_components/useInsightScope";
import { PAGE_PURPOSE } from "../_components/InsightViews";

/** Queue stage ids as the steward sees them. */
export const STAGE_LABEL: Record<string, string> = {
  detected: "Detected",
  proposed: "Proposed",
  pending_review: "Pending review",
  in_review: "In review",
  approved: "Approved",
  applied: "Applied",
  rejected: "Rejected",
  rolled_back: "Rolled back",
};
export const stageLabel = (stage: string) => STAGE_LABEL[stage] ?? labelOf(stage);

/** "330 h": queue ages are whole hours. */
const hours = (h: number) => `${Math.round(h).toLocaleString()} h`;
const pct = (p: number) => `${Math.round(p)}%`;
/** The cleaning queue these figures count: Fix work's Cleaning proposals tab, not the steward inbox. */
const CLEANING = "/fix?tab=cleaning";

const bottleneckColumns: ColumnDef<Bottleneck>[] = [
  { id: "stage", header: "Stage", accessorFn: (b) => stageLabel(b.stage) },
  { accessorKey: "count", header: "Items", meta: { numeric: true }, cell: ({ row }) => row.original.count.toLocaleString() },
  { accessorKey: "avg_age_hours", header: "Average age", meta: { numeric: true }, cell: ({ row }) => hours(row.original.avg_age_hours) },
  { id: "recommendation", header: "Recommendation", accessorFn: (b) => b.recommendation.replace(/\b([a-z_]+) stage\b/, (_, s: string) => `${stageLabel(s)} stage`) },
];

const sprintColumns: ColumnDef<SprintPlan>[] = [
  { accessorKey: "name", header: "Sprint" },
  { accessorKey: "total_effort_hours", header: "Effort (h)", meta: { numeric: true } },
  { accessorKey: "records_fixed", header: "Records fixed", meta: { numeric: true } },
  { accessorKey: "critical_cleared", header: "Critical findings cleared", meta: { numeric: true } },
  { id: "dqs", header: "Score, now to after", cell: ({ row }) => `${row.original.dqs_now ?? "—"} to ${row.original.dqs_projected ?? "—"}` },
  { id: "cost", header: "Estimated cost", cell: ({ row }) => row.original.estimated_cost == null ? "—" : `${row.original.estimated_cost.toLocaleString()} ${row.original.currency}` },
];

function TeamCard() {
  const [userId, setUserId] = useState("");
  const users = useQuery({ queryKey: ["assignable-users"], queryFn: getAssignableUsers });
  const perf = useQuery({ queryKey: ["analytics", "team", userId], queryFn: () => getTeamPerformance(userId), enabled: userId !== "" });
  const s = perf.data?.summary;
  return (
    <Card title="Team member" meta="One person's throughput and approval rate">
      <div className="flex flex-col gap-3">
        <Select
          label="Team member"
          value={userId}
          onValueChange={setUserId}
          placeholder="Choose a team member"
          options={(users.data ?? []).map((u) => ({ value: u.id, label: u.name || u.email }))}
        />
        {s ? (
          <div className="m-stat-grid">
            <Stat label="Processed" value={s.total_processed} />
            <Stat label="Approval rate" value={`${s.approval_rate}%`} />
            <Stat label="Review hours" value={s.total_review_hours} />
            <Stat label="Hours per item" value={s.avg_review_hours} />
          </div>
        ) : (
          <p className="m-text-body m-ink-3">Pick someone to see their throughput and approval rate.</p>
        )}
      </div>
    </Card>
  );
}

/** One secondary queue figure: the label, the value (a drill link when it opens rows) and an optional hint. */
function QueueFigure({ label, value, hint, href, critical = false }: { label: string; value: ReactNode; hint?: string; href?: string; critical?: boolean }) {
  return (
    <>
      <dt className="m-ink-3">{label}</dt>
      <dd className={clsx("m-numeric font-medium", critical ? "m-ink-critical" : "m-ink")}>
        {href ? <DrillLink href={href}>{value}</DrillLink> : value}
        {hint ? <span className="ml-2 m-text-meta font-normal m-ink-3">{hint}</span> : null}
      </dd>
    </>
  );
}

export default function OperationsPage() {
  const { run } = useInsightScope();
  const ops = useQuery({ queryKey: ["analytics", "operational"], queryFn: getOperational });
  const sprints = useQuery({ queryKey: ["analytics", "sprints"], queryFn: () => getSprints() });
  const k = ops.data?.kpis;
  const bottlenecks = ops.data?.bottlenecks ?? [];
  const plans = sprints.data?.sprints ?? [];
  const cap = ops.data?.capacity;
  // The page frame waits only while nothing has answered, and errors only when both queries failed: a slow or
  // failed query holds its own cards (skeleton, then inline error with Retry), the rest of the page renders.
  const loading = ops.isLoading && sprints.isLoading;
  const failed = isListFailure(ops) && isListFailure(sprints) ? ops : null;
  const settled = !ops.isLoading && !sprints.isLoading && !ops.isError && !sprints.isError;
  const empty = settled && bottlenecks.length === 0 && plans.length === 0 && !k?.items_in_flight;

  const worst = [...bottlenecks].sort((x, y) => y.avg_age_hours - x.avg_age_hours)[0];
  // Capacity: the gap is the one number that cannot contradict itself ("needed 0, 1 now" would).
  const gap = cap ? cap.current - cap.needed : null;
  const gapText = gap === null ? "—" : gap === 0 ? "Balanced" : gap > 0 ? `+${plural(gap, "steward")}` : `${plural(Math.abs(gap), "steward")} short`;
  const topRule = k?.top_rule_by_volume && k.top_rule_by_volume !== "N/A" ? k.top_rule_by_volume : null;

  return (
    <InsightFrame
      title="Operations"
      purpose={PAGE_PURPOSE["/insights/operations"]}
      run={run}
      insight={{
        loading: ops.isLoading,
        situation: { sentence: `${plural(k?.items_in_flight ?? 0, "item")} in progress, ${k ? pct(k.sla_compliance_pct) : "—"} handled within the agreed time` },
        changed: { sentence: bottlenecks.length ? `${plural(bottlenecks.length, "stage is", "stages are")} holding work` : "No stage is holding work" },
        why: { sentence: cap?.recommendation || "—" },
        next: { sentence: worst ? `Unblock ${stageLabel(worst.stage)} first` : "Nothing is blocked", action: { label: "Open cleaning proposals", href: CLEANING } },
      }}
      skeleton={
        <>
          <CardSkeleton height={160} />
          <CardSkeleton height={240} />
          <CardSkeleton height={160} />
        </>
      }
      state={loading ? "loading" : failed ? "error" : empty ? "empty" : undefined}
      emptyProps={{ title: "No queue activity yet", detail: "Throughput, bottlenecks and sprint plans appear once cleaning items exist.", ghost: "chart", action: <Button render={<Link href={CLEANING}>Open cleaning proposals</Link>} /> }}
      errorProps={{ message: apiErrorMessage(failed?.error), onRetry: () => { void ops.refetch(); void sprints.refetch(); } }}
    >
      <Section title="Throughput and capacity" height={160} query={ops}>
        <div className="flex flex-col gap-4">
          <div className="m-stat-grid">
            <Stat label="Processed" href={CLEANING} value={k?.total_processed ?? "—"} hint={k?.total_detected != null ? `of ${k.total_detected.toLocaleString()} detected` : undefined} />
            <Stat label="In progress" href={CLEANING} value={k?.items_in_flight ?? "—"} />
            <Stat label="Within agreed time (SLA)" value={k ? pct(k.sla_compliance_pct) : "—"} />
            <Stat label="Capacity" value={gapText} hint={cap ? `${plural(cap.current, "steward")} now, ${cap.needed.toLocaleString()} needed` : undefined} tone={gap === null ? undefined : gap < 0 ? "no-go" : "go"} />
          </div>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 m-text-body border-t pt-4 [border-color:var(--m-line)]" aria-label="Queue figures">
            <QueueFigure label="Throughput" href={CLEANING} value={k?.throughput ?? "—"} hint="Items per day" />
            <QueueFigure label="Time to resolve" href={CLEANING} value={k ? hours(k.mttr_hours) : "—"} />
            <QueueFigure label="Average queue age" href={CLEANING} value={k ? hours(k.avg_queue_age_hours) : "—"} />
            <QueueFigure label="Automation rate" value={k ? pct(k.automation_rate) : "—"} />
            <QueueFigure label="Rejection rate" value={k ? pct(k.rejection_rate) : "—"} />
            <QueueFigure label="Rollback rate" value={k ? pct(k.rollback_rate) : "—"} critical={!!k && k.rollback_rate > 0} />
            <QueueFigure label="Top rule by volume" value={topRule ? <Mono>{topRule}</Mono> : "—"} hint={topRule ? undefined : "Nothing processed yet"} href={topRule ? fixHref({ check: topRule }) : undefined} />
          </dl>
        </div>
      </Section>
      <Section title="Queue age by stage" height={160} query={ops}>
        {bottlenecks.length === 0 ? (
          <EmptyState title="No stage is holding work" detail="Queue age shows here once items wait in a stage." action={<Button render={<Link href={CLEANING}>Open cleaning proposals</Link>} />} />
        ) : (
          <>
            <Bar data={bottlenecks.map((b) => ({ x: b.stage, label: stageLabel(b.stage), y: Math.round(b.avg_age_hours) }))} label="Average age by stage in hours" height={Math.max(120, bottlenecks.length * 40)} />
            {worst && <p className="mt-2 m-text-body m-ink-2">{`${stageLabel(worst.stage)} holds work longest, at ${hours(worst.avg_age_hours)} on average.`}</p>}
          </>
        )}
      </Section>
      <TeamCard />
      {bottlenecks.length > 0 && (
        <Section title="Bottlenecks" height={120} query={ops} meta="Each waiting stage and what would clear it">
          <DataTable columns={bottleneckColumns} data={bottlenecks} getRowId={(r) => r.stage} hideToolbar height="auto" />
        </Section>
      )}
      <Section title="Sprint plans" height={120} query={sprints} meta="Suggested batches of fixes and what each would do to the score">
        {plans.length === 0 ? (
          <EmptyState variant="inline" title="No sprint plan yet" detail="Plans are suggested once Fix work holds open records." action={<Link href="/fix" className="underline-offset-2 hover:underline">Open Fix work</Link>} />
        ) : (
          <DataTable columns={sprintColumns} data={plans} getRowId={(r) => String(r.sprint_number)} hideToolbar height="auto" />
        )}
      </Section>
    </InsightFrame>
  );
}

"use client";

/** Insights › Operations: team throughput, bottlenecks, capacity and sprint plans. */

import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Button, Card, DataTable, DrillLink, EmptyState, Mono, Select, Stat } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getAssignableUsers } from "@/lib/api/users";
import {
  getOperational, getSprints, getTeamPerformance, type Bottleneck, type SprintPlan,
} from "@/lib/api/analytics";
import { getTriageMetrics, type TriageMetrics } from "@/lib/api/triage";
import { isListFailure } from "@/lib/error";
import { fixHref } from "@/lib/drill";
import { formatNumber, labelOf, plural } from "@/lib/format";
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
const CLEANING = fixHref({ sugg: true });

const bottleneckColumns: ColumnDef<Bottleneck>[] = [
  { id: "stage", header: "Stage", accessorFn: (b) => stageLabel(b.stage) },
  { accessorKey: "count", header: "Items", meta: { numeric: true }, cell: ({ row }) => num(row.original.count) },
  { accessorKey: "avg_age_hours", header: "Average age", meta: { numeric: true }, cell: ({ row }) => hours(row.original.avg_age_hours) },
  { id: "recommendation", header: "Recommendation", accessorFn: (b) => b.recommendation.replace(/\b([a-z_]+) stage\b/, (_, s: string) => `${stageLabel(s)} stage`) },
];

const num = (n: number) => formatNumber(n);

/**
 * Sprint plan columns. The score and cost columns are left out when no plan has anything to say in them (the
 * score never moves, no cost is estimated): the page then says so once above the table instead of on every row.
 */
function sprintColumnsFor(plans: SprintPlan[]): ColumnDef<SprintPlan>[] {
  const moves = plans.some((p) => p.dqs_now != null && p.dqs_projected != null && p.dqs_now !== p.dqs_projected);
  const priced = plans.some((p) => p.estimated_cost != null);
  const cols: ColumnDef<SprintPlan>[] = [
    { accessorKey: "name", header: "Sprint" },
    { accessorKey: "total_effort_hours", header: "Effort (h)", meta: { numeric: true }, cell: ({ row }) => num(row.original.total_effort_hours) },
    { accessorKey: "records_fixed", header: "Records fixed", meta: { numeric: true }, cell: ({ row }) => num(row.original.records_fixed) },
    { accessorKey: "critical_cleared", header: "Critical failing rules cleared", meta: { numeric: true }, cell: ({ row }) => num(row.original.critical_cleared) },
  ];
  if (moves) cols.push({ id: "dqs", header: "Score, now to after", cell: ({ row }) => `${row.original.dqs_now ?? "—"} to ${row.original.dqs_projected ?? "—"}` });
  if (priced) cols.push({ id: "cost", header: "Estimated cost", cell: ({ row }) => row.original.estimated_cost == null ? "—" : `${formatNumber(row.original.estimated_cost)} ${row.original.currency}` });
  return cols;
}

type OwnerRow = TriageMetrics["backlog_by_owner"][number];

const ownerColumns: ColumnDef<OwnerRow>[] = [
  { accessorKey: "email", header: "Owner" },
  { accessorKey: "open", header: "Open", meta: { numeric: true }, cell: ({ row }) => <DrillLink href={`/inbox?assignee=${encodeURIComponent(row.original.user_id)}`}>{row.original.open.toLocaleString()}</DrillLink> },
  { accessorKey: "at_risk", header: "At risk", meta: { numeric: true }, cell: ({ row }) => row.original.at_risk.toLocaleString() },
  { accessorKey: "breached", header: "Past due", meta: { numeric: true }, cell: ({ row }) => <span className={row.original.breached ? "m-ink-critical" : undefined}>{row.original.breached.toLocaleString()}</span> },
];

/** Hours as words: "3.5 h", or "—" before anything was acknowledged or resolved. */
const hoursOrDash = (h: number | null) => (h == null ? "—" : `${h.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`);

/**
 * Steward work against its SLA over the last eight weeks (GET /triage/metrics): issues and stewardship tasks
 * together, with the open backlog per owner. The SLA policies themselves are set in Settings › Triage.
 */
function SlaSection() {
  const q = useQuery({ queryKey: ["triage", "metrics", 8], queryFn: () => getTriageMetrics(8) });
  const m = q.data;
  const owners = m?.backlog_by_owner ?? [];
  return (
    <Section title="Steward work against the SLA" height={160} query={q} meta={`Issues and stewardship tasks, the last ${m?.weeks ?? 8} weeks`}
      actions={<Link href="/admin/triage" className="m-text-meta underline underline-offset-2">SLA policies</Link>}>
      <div className="flex flex-col gap-4">
        <div className="m-stat-grid">
          <Stat label="Resolved in time" value={m?.sla_attainment_pct == null ? "—" : pct(m.sla_attainment_pct)}
            hint={m && m.resolved_total ? `${m.resolved_in_sla.toLocaleString()} of ${m.resolved_total.toLocaleString()} with a due date` : "Nothing with a due date resolved yet"} />
          <Stat label="Time to acknowledge" value={hoursOrDash(m?.mtta_hours ?? null)} hint="Average, from the SLA start" />
          <Stat label="Time to close" value={hoursOrDash(m?.mttr_hours ?? null)} hint="Average, from the SLA start" />
          <Stat label="Breaches" value={m ? m.breach_count.toLocaleString() : "—"} href="/inbox?due=overdue" tone={m && m.breach_count > 0 ? "no-go" : undefined} hint="Open past due, or resolved late" />
          <Stat label="Unassigned" value={m ? m.unassigned.toLocaleString() : "—"} href="/inbox?view=unassigned" />
        </div>
        {owners.length ? <DataTable columns={ownerColumns} data={owners} getRowId={(r) => r.user_id} hideToolbar height="auto" /> : null}
      </div>
    </Section>
  );
}

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
  const { can } = useRole();
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

  // Nothing processed: throughput, times, rates and capacity have nothing to be computed from. They read "—", never 0 or 100%.
  const measured = !!k && ((k.total_processed ?? 0) > 0 || k.throughput > 0);
  const worst = [...bottlenecks].sort((x, y) => y.avg_age_hours - x.avg_age_hours)[0];
  // Capacity: the gap is the one number that cannot contradict itself ("needed 0, 1 now" would).
  const gap = cap ? cap.current - cap.needed : null;
  const gapText = gap === null || !measured ? "—" : gap === 0 ? "Balanced" : gap > 0 ? `${plural(gap, "steward")} to spare` : `${plural(Math.abs(gap), "steward")} short`;
  const capacityHint = !cap ? undefined : !measured ? "Not measured until items are processed" : `Team of ${formatNumber(cap.current)}; the queue needs ${formatNumber(cap.needed)}`;
  // A surplus is not a win to colour green: only balance is. A shortfall is the no-go.
  const capacityTone = gap === null || !measured || gap > 0 ? undefined : gap < 0 ? "no-go" : "go";
  const sprintColumns = sprintColumnsFor(plans);
  const scoreMoves = sprintColumns.some((c) => "id" in c && c.id === "dqs");
  const topRule = k?.top_rule_by_volume && k.top_rule_by_volume !== "N/A" ? k.top_rule_by_volume : null;

  return (
    <InsightFrame
      title="Operations"
      purpose={PAGE_PURPOSE["/insights/operations"]}
      run={run}
      insight={{
        loading: ops.isLoading,
        situation: { sentence: `${plural(k?.items_in_flight ?? 0, "item")} in progress, ${k && measured ? `${pct(k.sla_compliance_pct)} handled within the agreed time` : "nothing handled yet, so no agreed-time figure"}` },
        changed: { sentence: bottlenecks.length ? `${plural(bottlenecks.length, "stage is", "stages are")} holding work` : "No stage is holding work" },
        why: { sentence: !measured && cap ? "Capacity cannot be judged until items are processed" : cap?.recommendation || "—" },
        next: { sentence: worst ? `Unblock ${stageLabel(worst.stage)} first` : "Nothing is blocked", action: { label: "Open records with a suggested value", href: CLEANING } },
      }}
      skeleton={
        <>
          <CardSkeleton height={160} />
          <CardSkeleton height={240} />
          <CardSkeleton height={160} />
        </>
      }
      state={loading ? "loading" : failed ? "error" : empty ? "empty" : undefined}
      emptyProps={{ title: "No queue activity yet", detail: "Throughput, bottlenecks and sprint plans appear once cleaning items exist.", ghost: "chart", action: <Button render={<Link href={CLEANING}>Open records with a suggested value</Link>} /> }}
      errorProps={{ error: failed?.error, onRetry: () => { void ops.refetch(); void sprints.refetch(); } }}
    >
      <Section title="Throughput and capacity" height={160} query={ops}>
        <div className="flex flex-col gap-4">
          <div className="m-stat-grid">
            <Stat label="Processed" href={CLEANING} value={k?.total_processed ?? "—"} hint={k?.total_detected ? `of ${formatNumber(k.total_detected)} detected` : undefined} />
            <Stat label="In progress" href={CLEANING} value={k?.items_in_flight ?? "—"} />
            <Stat label="Within agreed time (SLA)" value={k && measured ? pct(k.sla_compliance_pct) : "—"} hint={k && !measured ? "Nothing processed yet" : undefined} />
            <Stat label="Capacity" value={gapText} hint={capacityHint} tone={capacityTone} />
          </div>
          {k && !measured ? (
            <p className="border-t pt-4 m-text-body m-ink-3 [border-color:var(--m-line)]">Nothing processed yet, so throughput, times to resolve, rates and the top rule are not measured.</p>
          ) : (
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 m-text-body border-t pt-4 [border-color:var(--m-line)]" aria-label="Queue figures">
              <QueueFigure label="Throughput" href={CLEANING} value={k?.throughput ?? "—"} hint="Items per day" />
              <QueueFigure label="Time to resolve" href={CLEANING} value={k ? hours(k.mttr_hours) : "—"} />
              <QueueFigure label="Average queue age" href={CLEANING} value={k ? hours(k.avg_queue_age_hours) : "—"} />
              <QueueFigure label="Automation rate" value={k ? pct(k.automation_rate) : "—"} />
              <QueueFigure label="Rejection rate" value={k ? pct(k.rejection_rate) : "—"} />
              <QueueFigure label="Rollback rate" value={k ? pct(k.rollback_rate) : "—"} critical={!!k && k.rollback_rate > 0} />
              <QueueFigure label="Top rule by volume" value={topRule ? <Mono>{topRule}</Mono> : "—"} hint={topRule ? undefined : "Nothing processed yet"} href={topRule ? fixHref({ check: topRule }) : undefined} />
            </dl>
          )}
        </div>
      </Section>
      <Section title="Queue age by stage" height={160} query={ops}>
        {bottlenecks.length === 0 ? (
          <EmptyState title="No stage is holding work" detail="Queue age shows here once items wait in a stage." action={<Button render={<Link href={CLEANING}>Open records with a suggested value</Link>} />} />
        ) : (
          <>
            <Bar data={bottlenecks.map((b) => ({ x: b.stage, label: stageLabel(b.stage), y: Math.round(b.avg_age_hours) }))} label="Average age by stage in hours" height={Math.max(120, bottlenecks.length * 40)} />
            {worst && <p className="mt-2 m-text-body m-ink-2">{`${stageLabel(worst.stage)} holds work longest, at ${hours(worst.avg_age_hours)} on average.`}</p>}
          </>
        )}
      </Section>
      <SlaSection />
      {/* The member list is /users/assignable, which needs assign: without it the card has nobody to pick. */}
      {can("assign") && <TeamCard />}
      {bottlenecks.length > 0 && (
        <Section title="Bottlenecks" height={120} query={ops} meta="Each waiting stage and what would clear it">
          <DataTable columns={bottleneckColumns} data={bottlenecks} getRowId={(r) => r.stage} hideToolbar height="auto" />
        </Section>
      )}
      <Section title="Sprint plans" height={120} query={sprints} meta="Suggested batches of fixes and what each would do to the score">
        {plans.length === 0 ? (
          <EmptyState variant="inline" title="No sprint plan yet" detail="Plans are suggested once Fix work holds open records." action={<Link href="/fix" className="underline-offset-2 hover:underline">Open Fix work</Link>} />
        ) : (
          <div className="flex flex-col gap-3">
            {scoreMoves ? null : <p className="m-text-body m-ink-3">No score change projected.</p>}
            <DataTable columns={sprintColumns} data={plans} getRowId={(r) => String(r.sprint_number)} hideToolbar height="auto" />
          </div>
        )}
      </Section>
    </InsightFrame>
  );
}

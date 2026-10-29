"use client";

/**
 * Insights › Progress › Team: how the cleaning team keeps up. Capacity, where work waits by stage, steward work
 * against the SLA and sprint plans. It was the Operations page; throughput, time to fix and work per person are
 * Progress's own sections above, so they are not repeated here. Live figures, not tied to one run.
 */

import type { ReactNode } from "react";
import { clsx } from "clsx";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Button, DataTable, DrillLink, EmptyState, Mono, Stat } from "@/design";
import { getOperational, getSprints, type Bottleneck, type SprintPlan } from "@/lib/api/analytics";
import { getTriageMetrics, type TriageMetrics } from "@/lib/api/triage";
import { fixHref } from "@/lib/drill";
import { labelOf, plural } from "@/lib/format";
import { Section } from "../_components/Section";

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
  { accessorKey: "count", header: "Items", meta: { numeric: true }, cell: ({ row }) => row.original.count.toLocaleString() },
  { accessorKey: "avg_age_hours", header: "Average age", meta: { numeric: true }, cell: ({ row }) => hours(row.original.avg_age_hours) },
  { id: "recommendation", header: "Recommendation", accessorFn: (b) => b.recommendation.replace(/\b([a-z_]+) stage\b/, (_, s: string) => `${stageLabel(s)} stage`) },
];

const sprintColumns: ColumnDef<SprintPlan>[] = [
  { accessorKey: "name", header: "Sprint" },
  { accessorKey: "total_effort_hours", header: "Effort (h)", meta: { numeric: true } },
  { accessorKey: "records_fixed", header: "Records fixed", meta: { numeric: true } },
  { accessorKey: "critical_cleared", header: "Critical failing rules cleared", meta: { numeric: true } },
  { id: "dqs", header: "Score, now to after", cell: ({ row }) => `${row.original.dqs_now ?? "—"} to ${row.original.dqs_projected ?? "—"}` },
  { id: "cost", header: "Estimated cost", cell: ({ row }) => row.original.estimated_cost == null ? "—" : `${row.original.estimated_cost.toLocaleString()} ${row.original.currency}` },
];

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

/** The Team section: a heading, then capacity, queue age by stage, the SLA, bottlenecks and sprint plans. */
export function TeamSection() {
  const ops = useQuery({ queryKey: ["analytics", "operational"], queryFn: getOperational });
  const sprints = useQuery({ queryKey: ["analytics", "sprints"], queryFn: () => getSprints() });
  const k = ops.data?.kpis;
  const bottlenecks = ops.data?.bottlenecks ?? [];
  const plans = sprints.data?.sprints ?? [];
  const cap = ops.data?.capacity;
  const worst = [...bottlenecks].sort((x, y) => y.avg_age_hours - x.avg_age_hours)[0];
  // Capacity: the gap is the one number that cannot contradict itself ("needed 0, 1 now" would).
  const gap = cap ? cap.current - cap.needed : null;
  const gapText = gap === null ? "—" : gap === 0 ? "Balanced" : gap > 0 ? `+${plural(gap, "steward")}` : `${plural(Math.abs(gap), "steward")} short`;
  const topRule = k?.top_rule_by_volume && k.top_rule_by_volume !== "N/A" ? k.top_rule_by_volume : null;

  return (
    <div id="team" className="scroll-mt-24 flex flex-col gap-4">
      <div>
        <h2 className="m-text-h font-semibold m-ink">Team</h2>
        <p className="m-text-body m-ink-3">How the cleaning team is keeping up: where items wait longest, capacity and the next sprints. Live, not tied to one run.</p>
      </div>
      <Section title="Capacity and queue" height={160} query={ops}>
        <div className="flex flex-col gap-4">
          <div className="m-stat-grid">
            <Stat label="In progress" href={CLEANING} value={k?.items_in_flight ?? "—"} />
            <Stat label="Within agreed time (SLA)" value={k ? pct(k.sla_compliance_pct) : "—"} />
            <Stat label="Capacity" value={gapText} hint={cap ? `${plural(cap.current, "steward")} now, ${cap.needed.toLocaleString()} needed` : undefined} tone={gap === null ? undefined : gap < 0 ? "no-go" : "go"} />
          </div>
          {cap?.recommendation ? <p className="m-text-body m-ink-2">{cap.recommendation}</p> : null}
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 m-text-body border-t pt-4 [border-color:var(--m-line)]" aria-label="Queue figures">
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
          <EmptyState title="No stage is holding work" detail="Queue age shows here once items wait in a stage." action={<Button render={<Link href={CLEANING}>Open records with a suggested value</Link>} />} />
        ) : (
          <>
            <Bar data={bottlenecks.map((b) => ({ x: b.stage, label: stageLabel(b.stage), y: Math.round(b.avg_age_hours) }))} label="Average age by stage in hours" height={Math.max(120, bottlenecks.length * 40)} />
            {worst && <p className="mt-2 m-text-body m-ink-2">{`${stageLabel(worst.stage)} holds work longest, at ${hours(worst.avg_age_hours)} on average.`}</p>}
          </>
        )}
      </Section>
      <SlaSection />
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
    </div>
  );
}

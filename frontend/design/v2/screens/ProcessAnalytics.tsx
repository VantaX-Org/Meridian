"use client";

import { useQuery } from "@tanstack/react-query";
import { getProcessAnalytics, type Aging, type RequestObject } from "@/lib/api/v2/process-analytics";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { DASH, f1, int, pct1 } from "@/lib/v2/score";
import { ChartFrame, ChartTable, StackedBar, TrendChart, type StackPart } from "../charts";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Guide } from "./Guide";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Process analytics: how change requests move through approval. Cycle time runs from submission to the SAP record
 * being created; approval time from submission to the decision; a step's dwell from the moment it became active to
 * its decision. Every figure is counted from the tenant's own requests and workflow tasks, and percentiles are
 * nearest-rank, so each one is a real request or task.
 */

const DAYS = ["30", "90", "180", "365"] as const;
const OBJECTS = ["", "material", "customer", "vendor", "business_partner"] as const;

const OBJECT_TEXT: Record<string, () => string> = {
  "": () => t("All objects"),
  material: () => t("Material"),
  customer: () => t("Customer"),
  vendor: () => t("Supplier"),
  business_partner: () => t("Business partner"),
};
const objectText = (o: string): string => OBJECT_TEXT[o]?.() ?? o;

/** Hours as hours under two days, else days, one decimal. */
function duration(h: number | null | undefined): string {
  if (h == null) return DASH;
  return h < 48 ? t("{n} h", { n: f1(h) }) : t("{n} d", { n: f1(h / 24) });
}

function agingParts(a: Aging): StackPart[] {
  return [
    { key: "lt_1d", label: t("Under 1 day"), value: a.lt_1d, colour: "var(--m2-chart-1)", title: t("Under 1 day") },
    { key: "d1_3", label: t("1 to 3 days"), value: a.d1_3, colour: "var(--m2-chart-2)", title: t("1 to 3 days") },
    { key: "d3_7", label: t("3 to 7 days"), value: a.d3_7, colour: "var(--m2-sev-high)", title: t("3 to 7 days") },
    { key: "gt_7d", label: t("Over 7 days"), value: a.gt_7d, colour: "var(--m2-sev-crit)", title: t("Over 7 days") },
  ];
}

export function ProcessAnalytics() {
  const fixture = useFixture();
  const [days, setDays] = useUrlParam<(typeof DAYS)[number]>("days", "90", DAYS);
  const [obj, setObj] = useUrlParam<(typeof OBJECTS)[number]>("object", "", OBJECTS);
  const q = useQuery({
    queryKey: ["process-analytics", days, obj, fixture],
    queryFn: () => getProcessAnalytics(Number(days), (obj || undefined) as RequestObject | undefined),
    staleTime: 60_000,
  });
  const title = t("Process analytics");
  const filters = (
    <span className="m2-meta">
      <select value={days} onChange={(e) => setDays(e.target.value as (typeof DAYS)[number])} aria-label={t("Window")} data-testid="pa-days">
        {DAYS.map((d) => <option key={d} value={d}>{t("Last {n} days", { n: d })}</option>)}
      </select>{" "}
      <select value={obj} onChange={(e) => setObj(e.target.value as (typeof OBJECTS)[number])} aria-label={t("Object")} data-testid="pa-object">
        {OBJECTS.map((o) => <option key={o} value={o}>{objectText(o)}</option>)}
      </select>
    </span>
  );
  if (q.isPending) return <CcPage title={title}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={title}><ErrorFrame onRetry={() => void q.refetch()}>{t("The process analytics could not be read.")}</ErrorFrame></CcPage>;
  const a = q.data;
  const open = a.aging.lt_1d + a.aging.d1_3 + a.aging.d3_7 + a.aging.gt_7d;
  const verdict = a.sla.rate == null ? undefined : a.sla.rate > 0.1 ? "no-go" : a.sla.rate > 0 ? "at-risk" : "go";
  const points = a.weekly.map((w) => ({ id: w.week, label: formatDate(w.week, "date"), title: t("{n} submitted in the week of {week}", { n: w.submitted, week: formatDate(w.week, "date") }), value: w.submitted }));
  const top = Math.max(1, ...a.weekly.map((w) => Math.max(w.submitted, w.created)));
  return (
    <CcPage title={title}>
      <Guide
        steps={{ labels: [t("Pick the window"), t("Find the slow step"), t("Clear the old backlog"), t("Watch the trend")], current: a.bottleneck ? 1 : 3 }}
        shows={t("Shows how change requests move through approval, where they wait, and which steps miss their SLA.")}
        next={{ href: "/requests", label: t("Open the change requests") }}
        means={[
          [t("Cycle time"), t("From submission until the record is created in SAP.")],
          [t("Approval time"), t("From submission until the last approver decides.")],
          [t("Dwell"), t("How long one step held the request, from activation to decision.")],
          [t("Bottleneck"), t("The step with the longest median dwell; ties go to the most SLA breaches.")],
        ]}
      />
      <CcBanner
        testId="process-analytics"
        label={title}
        eyebrow={title}
        verdict={verdict}
        headline={a.total === 0 ? t("No change request in this window") : a.bottleneck
          ? t("{step} is the slowest step", { step: a.bottleneck })
          : t("{n, plural, one {# change request} other {# change requests}}", { n: a.total })}
        why={t("Counted from {n} change requests created in the last {d} days. Percentiles are nearest-rank, so each is a real request.", { n: a.total, d: a.days })}
        figs={[
          { label: t("Median cycle"), value: duration(a.cycle.median_hours), note: t("p90 {v}", { v: duration(a.cycle.p90_hours) }) },
          { label: t("Median approval"), value: duration(a.approval.median_hours), note: t("p90 {v}", { v: duration(a.approval.p90_hours) }) },
          { label: t("SLA breached"), value: a.sla.rate == null ? DASH : pct1(a.sla.rate), note: t("{b} of {n} tasks", { b: int(a.sla.breached), n: int(a.sla.with_sla) }) },
          { label: t("Rejected"), value: a.rates.rejection == null ? DASH : pct1(a.rates.rejection), note: t("of {n} closed", { n: int(a.rates.closed) }) },
          { label: t("Open"), value: int(open) },
        ]}
        action={filters}
      />
      {a.total === 0 ? <EmptyFrame>{t("No change request was created in this window. Pick a longer window or another object.")}</EmptyFrame> : (
        <>
          <Panel title={t("Steps")} meta={t("Every approval step, in workflow order. The bottleneck is marked.")} testId="pa-steps">
            <ScrollFrame label={t("Steps, scrollable")}>
              <table className="m2-tbl">
                <caption className="m2-sr">{t("Approval steps with dwell time and SLA breaches")}</caption>
                <thead><tr><th scope="col">{t("Step")}</th><th scope="col">{t("Tasks")}</th><th scope="col">{t("Decided")}</th><th scope="col">{t("Pending")}</th><th scope="col">{t("Median dwell")}</th><th scope="col">{t("p90 dwell")}</th><th scope="col">{t("SLA breached")}</th><th scope="col">{t("Overdue now")}</th></tr></thead>
                <tbody>
                  {a.steps.map((s) => (
                    <tr key={s.step} data-testid={`pa-step-${s.step}`} data-bottleneck={s.step === a.bottleneck ? "1" : undefined}>
                      <td>{s.step}{s.step === a.bottleneck ? <strong> {t("Bottleneck")}</strong> : null}</td>
                      <td>{int(s.tasks)}</td>
                      <td>{int(s.decided)}</td>
                      <td>{int(s.pending)}</td>
                      <td>{duration(s.median_dwell_hours)}</td>
                      <td>{duration(s.p90_dwell_hours)}</td>
                      <td>{int(s.breached)}</td>
                      <td>{int(s.overdue_open)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          </Panel>
          <Panel title={t("Open backlog by age")} meta={t("Open requests by time since submission.")} testId="pa-aging">
            {open === 0 ? <EmptyFrame>{t("No request is open.")}</EmptyFrame> : <StackedBar parts={agingParts(a.aging)} label={t("Open requests by age")} format={int} testId="pa-aging-bar" />}
          </Panel>
          <Panel title={t("Weekly flow")} meta={t("Requests submitted and records created, per week.")} testId="pa-weekly">
            <ChartFrame
              title={t("Submitted per week")}
              sub={t("The table also lists the records created each week")}
              height={140}
              level={2}
              state={points.length < 2 ? "empty" : "ready"}
              empty={t("Two weeks are needed to draw a trend.")}
              testId="pa-weekly-trend"
              table={<ChartTable caption={t("Requests per week")} head={[t("Week"), t("Submitted"), t("Created")]} rows={a.weekly.map((w) => [formatDate(w.week, "date"), int(w.submitted), int(w.created)])} />}
            >
              <TrendChart points={points} domain={[0, top] as const} ticks={[0, top / 2, top]} height={140} label={t("Submitted per week")} yLabel={t("requests")} format={int} />
            </ChartFrame>
          </Panel>
          <Panel title={t("Objects")} meta={t("Requests per object, with cycle time to the created record.")} testId="pa-objects">
            <ScrollFrame label={t("Objects, scrollable")}>
              <table className="m2-tbl">
                <caption className="m2-sr">{t("Change requests per object")}</caption>
                <thead><tr><th scope="col">{t("Object")}</th><th scope="col">{t("Requests")}</th><th scope="col">{t("Open")}</th><th scope="col">{t("Created")}</th><th scope="col">{t("Rejected")}</th><th scope="col">{t("Failed")}</th><th scope="col">{t("Cancelled")}</th><th scope="col">{t("Median cycle")}</th><th scope="col">{t("p90 cycle")}</th></tr></thead>
                <tbody>
                  {a.objects.map((o) => (
                    <tr key={o.object} data-testid={`pa-object-${o.object}`}>
                      <td>{objectText(o.object)}</td>
                      <td>{int(o.total)}</td>
                      <td>{int(o.open)}</td>
                      <td>{int(o.created)}</td>
                      <td>{int(o.rejected)}</td>
                      <td>{int(o.failed)}</td>
                      <td>{int(o.cancelled)}</td>
                      <td>{duration(o.median_cycle_hours)}</td>
                      <td>{duration(o.p90_cycle_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          </Panel>
        </>
      )}
    </CcPage>
  );
}

"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getApprovalForecast, getProcessAnalytics, type Aging, type ForecastRow, type ObjectRow, type RequestObject, type StepRow, type Week } from "@/lib/api/v2/process-analytics";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { DASH, f1, int, pct1 } from "@/lib/v2/score";
import { DataTable, EmptyState, ErrorState, Skeleton, StatCard, type Column } from "../kit";
import { AreaTrend, StackedBar, type Seg } from "../viz";
import "./queue.css";

/**
 * Process analytics: how change requests move through approval. Cycle time runs from submission to the SAP record
 * being created; approval time from submission to the decision; a step's dwell from activation to its decision.
 * Percentiles are nearest-rank, so each one is a real request or task.
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

function agingSegs(a: Aging): Seg[] {
  return [
    { id: "lt_1d", label: t("Under 1 day"), value: a.lt_1d, tone: "good" },
    { id: "d1_3", label: t("1 to 3 days"), value: a.d1_3, tone: "chart2" },
    { id: "d3_7", label: t("3 to 7 days"), value: a.d3_7, tone: "warn" },
    { id: "gt_7d", label: t("Over 7 days"), value: a.gt_7d, tone: "bad" },
  ];
}

/** One headline figure: a StatCard when the API returned a number, else a dash. */
function Fig({ label, value, format, note }: { label: string; value: number | null | undefined; format?: (n: number) => string; note?: string }) {
  return (
    <div className="nx-wq-cell">
      {value == null ? (
        <div className="nx-wq-card">
          <span>{label}</span>
          <strong>{DASH}</strong>
        </div>
      ) : (
        <StatCard label={label} value={value} format={format} />
      )}
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export function WorkProcessAnalytics() {
  const fixture = useFixture();
  const [days, setDays] = useUrlParam<(typeof DAYS)[number]>("days", "90", DAYS);
  const [obj, setObj] = useUrlParam<(typeof OBJECTS)[number]>("object", "", OBJECTS);
  const q = useQuery({
    queryKey: ["process-analytics", days, obj, fixture],
    queryFn: () => getProcessAnalytics(Number(days), (obj || undefined) as RequestObject | undefined),
    staleTime: 60_000,
  });
  const a = q.data;
  const open = a ? a.aging.lt_1d + a.aging.d1_3 + a.aging.d3_7 + a.aging.gt_7d : 0;

  const steps: Column<StepRow>[] = [
    { id: "step", label: t("Step"), cell: (s) => (a && s.step === a.bottleneck ? <span className="nx-wq-row">{s.step}<strong>{t("Bottleneck")}</strong></span> : s.step) },
    { id: "tasks", label: t("Tasks"), align: "end", cell: (s) => int(s.tasks), compare: (x, y) => x.tasks - y.tasks },
    { id: "decided", label: t("Decided"), align: "end", cell: (s) => int(s.decided) },
    { id: "pending", label: t("Pending"), align: "end", cell: (s) => int(s.pending) },
    { id: "median", label: t("Median dwell"), align: "end", cell: (s) => duration(s.median_dwell_hours), compare: (x, y) => (x.median_dwell_hours ?? -1) - (y.median_dwell_hours ?? -1) },
    { id: "p90", label: t("p90 dwell"), align: "end", cell: (s) => duration(s.p90_dwell_hours) },
    { id: "breached", label: t("SLA breached"), align: "end", cell: (s) => int(s.breached), compare: (x, y) => x.breached - y.breached },
    { id: "overdue", label: t("Overdue now"), align: "end", cell: (s) => int(s.overdue_open) },
  ];
  const objects: Column<ObjectRow>[] = [
    { id: "object", label: t("Object"), cell: (o) => objectText(o.object) },
    { id: "total", label: t("Requests"), align: "end", cell: (o) => int(o.total), compare: (x, y) => x.total - y.total },
    { id: "open", label: t("Open"), align: "end", cell: (o) => int(o.open) },
    { id: "created", label: t("Created"), align: "end", cell: (o) => int(o.created) },
    { id: "rejected", label: t("Rejected"), align: "end", cell: (o) => int(o.rejected) },
    { id: "failed", label: t("Failed"), align: "end", cell: (o) => int(o.failed) },
    { id: "cancelled", label: t("Cancelled"), align: "end", cell: (o) => int(o.cancelled) },
    { id: "median", label: t("Median cycle"), align: "end", cell: (o) => duration(o.median_cycle_hours) },
    { id: "p90", label: t("p90 cycle"), align: "end", cell: (o) => duration(o.p90_cycle_hours) },
  ];
  const weeks: Column<Week>[] = [
    { id: "week", label: t("Week"), cell: (w) => formatDate(w.week, "date") },
    { id: "submitted", label: t("Submitted"), align: "end", cell: (w) => int(w.submitted) },
    { id: "created", label: t("Created"), align: "end", cell: (w) => int(w.created) },
  ];

  return (
    <div className="nx-wq" data-testid="process-analytics">
      <h1 className="nx-wq-h">{t("Process analytics")}</h1>
      <p className="nx-wq-meta">{t("Shows how change requests move through approval, where they wait, and which steps miss their SLA.")}</p>
      <div className="nx-wq-bar">
        <label>
          {t("Window")}
          <select value={days} onChange={(e) => setDays(e.target.value as (typeof DAYS)[number])} data-testid="pa-days">
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t("Last {n} days", { n: d })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Object")}
          <select value={obj} onChange={(e) => setObj(e.target.value as (typeof OBJECTS)[number])} data-testid="pa-object">
            {OBJECTS.map((o) => (
              <option key={o} value={o}>
                {objectText(o)}
              </option>
            ))}
          </select>
        </label>
        <Link className="nx-wq-link" href="/requests">
          {t("Open the change requests")}
        </Link>
      </div>
      {q.isPending ? (
        <Skeleton lines={8} />
      ) : q.isError || !a ? (
        <ErrorState sentence={errorSentence(q.error, t("The process analytics could not be read."))} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <h2 className="nx-wq-h">
            {a.total === 0
              ? t("No change request in this window")
              : a.bottleneck
                ? t("{step} is the slowest step", { step: a.bottleneck })
                : t("{n, plural, one {# change request} other {# change requests}}", { n: a.total })}
          </h2>
          <p className="nx-wq-meta">{t("Counted from {n} change requests created in the last {d} days. Percentiles are nearest-rank, so each is a real request.", { n: a.total, d: a.days })}</p>
          <div className="nx-wq-stats">
            <Fig label={t("Median cycle")} value={a.cycle.median_hours} format={duration} note={t("p90 {v}", { v: duration(a.cycle.p90_hours) })} />
            <Fig label={t("Median approval")} value={a.approval.median_hours} format={duration} note={t("p90 {v}", { v: duration(a.approval.p90_hours) })} />
            <Fig label={t("SLA breached")} value={a.sla.rate} format={pct1} note={t("{b} of {n} tasks", { b: int(a.sla.breached), n: int(a.sla.with_sla) })} />
            <Fig label={t("Rejected")} value={a.rates.rejection} format={pct1} note={t("of {n} closed", { n: int(a.rates.closed) })} />
            <Fig label={t("Open")} value={open} />
          </div>
          <dl className="nx-wq-dl">
            <dt>{t("Cycle time")}</dt>
            <dd>{t("From submission until the record is created in SAP.")}</dd>
            <dt>{t("Approval time")}</dt>
            <dd>{t("From submission until the last approver decides.")}</dd>
            <dt>{t("Dwell")}</dt>
            <dd>{t("How long one step held the request, from activation to decision.")}</dd>
            <dt>{t("Bottleneck")}</dt>
            <dd>{t("The step with the longest median dwell; ties go to the most SLA breaches.")}</dd>
          </dl>
          <Forecast />
          {a.total === 0 ? (
            <EmptyState heading={t("No change request was created in this window. Pick a longer window or another object.")} />
          ) : (
            <>
              <section className="nx-wq-card" data-testid="pa-steps">
                <h2 className="nx-wq-h">{t("Steps")}</h2>
                <p className="nx-wq-meta">{t("Every approval step, in workflow order. The bottleneck is marked.")}</p>
                <DataTable rows={a.steps} columns={steps} rowKey={(s) => s.step} rowLabel={(s) => s.step} caption={t("Approval steps with dwell time and SLA breaches")} empty={{ heading: t("No request is open.") }} />
              </section>
              <section className="nx-wq-card" data-testid="pa-aging">
                <h2 className="nx-wq-h">{t("Open backlog by age")}</h2>
                <p className="nx-wq-meta">{t("Open requests by time since submission.")}</p>
                {open === 0 ? <EmptyState heading={t("No request is open.")} /> : <StackedBar segs={agingSegs(a.aging)} label={t("Open requests by age")} />}
              </section>
              <section className="nx-wq-card" data-testid="pa-weekly">
                <h2 className="nx-wq-h">{t("Weekly flow")}</h2>
                <p className="nx-wq-meta">{t("Requests submitted and records created, per week.")}</p>
                <AreaTrend points={a.weekly.map((w) => ({ label: formatDate(w.week, "date"), value: w.submitted }))} label={t("Submitted per week")} height={140} empty={t("Two weeks are needed to draw a trend.")} />
                <DataTable rows={a.weekly} columns={weeks} rowKey={(w) => w.week} rowLabel={(w) => formatDate(w.week, "date")} caption={t("Requests per week")} empty={{ heading: t("Two weeks are needed to draw a trend.") }} />
              </section>
              <section className="nx-wq-card" data-testid="pa-objects">
                <h2 className="nx-wq-h">{t("Objects")}</h2>
                <p className="nx-wq-meta">{t("Requests per object, with cycle time to the created record.")}</p>
                <DataTable rows={a.objects} columns={objects} rowKey={(o) => o.object} rowLabel={(o) => objectText(o.object)} caption={t("Change requests per object")} empty={{ heading: t("No change request in this window") }} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

const BASIS: Record<string, () => string> = {
  object_kind_step: () => t("Same object, kind and step"),
  step: () => t("Same step, any object"),
  none: () => t("No history"),
};

/** For each open request: when its waiting step is likely decided and how likely it misses its SLA, with the decided tasks it rests on. */
function Forecast() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["approval-forecast", fixture], queryFn: () => getApprovalForecast(), staleTime: 60_000 });
  const columns: Column<ForecastRow>[] = [
    { id: "request", label: t("Request"), cell: (r) => <span className="nx-wq-cell">{r.title || r.request_id}<small>{objectText(r.object)}</small></span> },
    { id: "step", label: t("Waiting step"), cell: (r) => r.step },
    { id: "waited", label: t("Waited"), align: "end", cell: (r) => duration(r.elapsed_hours), compare: (x, y) => (x.elapsed_hours ?? 0) - (y.elapsed_hours ?? 0) },
    { id: "eta", label: t("Likely decided"), cell: (r) => (r.eta ? formatDate(r.eta, "date") : DASH) },
    { id: "p90", label: t("Late case (p90)"), cell: (r) => (r.p90_eta ? formatDate(r.p90_eta, "date") : DASH) },
    {
      id: "risk",
      label: t("Breach risk"),
      align: "end",
      cell: (r) => (r.breached ? <strong>{t("SLA missed")}</strong> : r.breach_probability == null ? DASH : r.breach_probability >= 0.5 ? <strong>{pct1(r.breach_probability)}</strong> : pct1(r.breach_probability)),
      compare: (x, y) => (x.breach_probability ?? -1) - (y.breach_probability ?? -1),
    },
    {
      id: "done",
      label: t("Request done"),
      cell: (r) => (
        <span className="nx-wq-cell">
          {r.request_eta ? formatDate(r.request_eta, "date") : DASH}
          {r.remaining.length ? <small>{t("then {steps}", { steps: r.remaining.map((x) => x.step).join(", ") })}</small> : null}
        </span>
      ),
    },
    {
      id: "basis",
      label: t("Based on"),
      cell: (r) => (
        <details data-testid={`pa-evidence-${r.request_id}`}>
          <summary>
            {BASIS[r.basis]?.() ?? r.basis} <small>{t("{n, plural, one {# decided task} other {# decided tasks}}", { n: r.n })}</small>
          </summary>
          {r.conditioned ? <small>{t("Only tasks that waited longer than this one has already.")}</small> : null}
          {r.evidence.length === 0 ? null : (
            <ul>
              {r.evidence.map((e) => (
                <li key={`${e.request_id}-${e.decided_at}`}>
                  {e.title || e.request_id}: {duration(e.dwell_hours)} <small>{formatDate(e.decided_at, "date")}</small>
                </li>
              ))}
            </ul>
          )}
        </details>
      ),
    },
  ];
  return (
    <section className="nx-wq-card" data-testid="pa-forecast">
      <h2 className="nx-wq-h">{t("Forecast")}</h2>
      <p className="nx-wq-meta">{t("When each waiting step is likely decided, and the chance it misses its SLA, from how long the same step took on decided requests.")}</p>
      {q.data && q.data.requests.length > 0 ? (
        <p className="nx-wq-meta" data-testid="pa-forecast-summary">
          {t("{n, plural, one {# open request} other {# open requests}}: {r} likely to miss the SLA, {b} already past it.", { n: q.data.open, r: int(q.data.at_risk), b: int(q.data.breached) })}
        </p>
      ) : null}
      <DataTable
        rows={q.data?.requests ?? []}
        columns={columns}
        rowKey={(r) => r.request_id}
        rowLabel={(r) => r.title || r.request_id}
        caption={t("Open requests with the forecast decision of the waiting step")}
        loading={q.isPending}
        error={q.isError ? { sentence: errorSentence(q.error, t("The forecast could not be read.")), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No request is waiting for a decision.") }}
      />
    </section>
  );
}

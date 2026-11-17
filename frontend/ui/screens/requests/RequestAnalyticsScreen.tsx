"use client";

import { useState } from "react";
import { getApprovalForecast, getProcessAnalytics, type ForecastRow, type ObjectRow, type RequestObject, type StepRow } from "@/lib/api/v2/process-analytics";
import { t } from "@/lib/v2/i18n";
import { BarList, Card, Code, DataTable, Field, Select, StatTile } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, when } from "../mdm/catalogue/shared";
import { objectText } from "./RequestsScreen";

const hrs = (n: number | null | undefined) => (n === null || n === undefined ? t("n/a") : n >= 48 ? `${(n / 24).toFixed(1)} ${t("days")}` : `${n.toFixed(1)} ${t("hours")}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? t("n/a") : `${Math.round(n * 100)}%`);

export function RequestAnalyticsScreen() {
  const [days, setDays] = useState("90");
  const [obj, setObj] = useState("");
  const a = useRead(["pa", days, obj], () => getProcessAnalytics(Number(days), (obj || undefined) as RequestObject | undefined));
  const f = useRead(["pa", "forecast"], () => getApprovalForecast(365));
  useScreenScope("request-analytics", t("Process analytics"), [
    { prompt: t("Where is the bottleneck?"), answer: () => ({ text: a.data?.bottleneck ?? t("No bottleneck found") }) },
  ]);
  return (
    <>
      <Head title={t("Process analytics")} context={<>
        <Field label={t("Period")}><Select value={days} onChange={(e) => setDays(e.target.value)} options={["30", "90", "180", "365"].map((d) => ({ value: d, label: `${d} ${t("days")}` }))} /></Field>
        <Field label={t("Object")}><Select value={obj} onChange={(e) => setObj(e.target.value)} options={[{ value: "", label: t("All objects") }, ...(["material", "customer", "vendor", "business_partner"] as const).map((o) => ({ value: o, label: objectText(o) }))]} /></Field>
      </>} />
      <Async q={a}>
        {(d) => d.total === 0 ? <Empty heading={t("No requests in this period")} /> : (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Requests")} value={num(d.total)} />
              <StatTile label={t("Median cycle time")} value={hrs(d.cycle.median_hours)} note={`${t("Slowest tenth")} ${hrs(d.cycle.p90_hours)}`} />
              <StatTile label={t("Median approval time")} value={hrs(d.approval.median_hours)} note={`${t("Slowest tenth")} ${hrs(d.approval.p90_hours)}`} />
              <StatTile label={t("SLA breaches")} value={num(d.sla.breached)} note={`${t("of")} ${num(d.sla.with_sla)}, ${pct(d.sla.rate)}`} />
              <StatTile label={t("Rejection rate")} value={pct(d.rates.rejection)} />
            </dl>
            <div className="mx-split">
              <Card title={t("Backlog age")}>
                <BarList label={t("Backlog age")} items={[
                  { id: "a", label: t("Under 1 day"), value: d.aging.lt_1d }, { id: "b", label: t("1 to 3 days"), value: d.aging.d1_3 },
                  { id: "c", label: t("3 to 7 days"), value: d.aging.d3_7 }, { id: "d", label: t("Over 7 days"), value: d.aging.gt_7d, sev: "high" },
                ]} />
              </Card>
              <Card title={t("Submitted and created by week")}>
                <BarList label={t("Weekly requests")} items={d.weekly.map((w) => ({ id: w.week, label: w.week, value: w.submitted, display: `${w.submitted} / ${w.created}` }))} />
              </Card>
            </div>
            <Card title={t("By object")}>
              <DataTable<ObjectRow> label={t("By object")} rows={d.objects} rowKey={(o) => o.object} height={200}
                columns={[
                  { key: "o", label: t("Object"), render: (o) => objectText(o.object) },
                  { key: "t", label: t("Total"), align: "end", sort: (o) => o.total, render: (o) => num(o.total) },
                  { key: "op", label: t("Open"), align: "end", render: (o) => num(o.open) },
                  { key: "c", label: t("Created"), align: "end", render: (o) => num(o.created) },
                  { key: "r", label: t("Rejected"), align: "end", render: (o) => num(o.rejected) },
                  { key: "m", label: t("Median cycle time"), align: "end", render: (o) => hrs(o.median_cycle_hours) },
                ]} />
            </Card>
            <Card title={t("Approval steps")} sub={d.bottleneck ? `${t("Bottleneck")}: ${d.bottleneck}` : undefined}>
              <DataTable<StepRow> label={t("Approval steps")} rows={d.steps} rowKey={(s) => `${s.index}-${s.step}`} height={220}
                columns={[
                  { key: "s", label: t("Step"), render: (s) => s.step },
                  { key: "t", label: t("Tasks"), align: "end", render: (s) => num(s.tasks) },
                  { key: "p", label: t("Pending"), align: "end", render: (s) => num(s.pending) },
                  { key: "b", label: t("SLA breaches"), align: "end", sort: (s) => s.breached, render: (s) => num(s.breached) },
                  { key: "m", label: t("Median wait"), align: "end", render: (s) => hrs(s.median_dwell_hours) },
                  { key: "p9", label: t("Slowest tenth"), align: "end", render: (s) => hrs(s.p90_dwell_hours) },
                ]} />
            </Card>
          </>
        )}
      </Async>
      <Card title={t("Approval forecast")} sub={t("When each open request is likely decided")}>
        <Async q={f}>
          {(d) => d.requests.length ? (
            <>
              <dl className="mx-tiles">
                <StatTile label={t("Open")} value={num(d.open)} /><StatTile label={t("At risk")} value={num(d.at_risk)} /><StatTile label={t("Past due")} value={num(d.breached)} />
              </dl>
              <DataTable<ForecastRow> label={t("Approval forecast")} rows={d.requests} rowKey={(r) => r.request_id} height={260}
                columns={[
                  { key: "r", label: t("Request"), render: (r) => <Code code={r.request_id} description={r.title ?? undefined} /> },
                  { key: "s", label: t("Waiting step"), render: (r) => r.step },
                  { key: "e", label: t("Likely decided"), sort: (r) => r.eta ?? "", render: (r) => when(r.eta) },
                  { key: "p", label: t("Chance of missing SLA"), align: "end", sort: (r) => r.breach_probability ?? -1, render: (r) => pct(r.breach_probability) },
                  { key: "n", label: t("Based on"), align: "end", render: (r) => `${num(r.n)} ${t("decisions")}` },
                ]} />
            </>
          ) : <Empty heading={t("No open requests to forecast")} />}
        </Async>
      </Card>
    </>
  );
}

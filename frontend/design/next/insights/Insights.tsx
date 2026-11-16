"use client";

import { useState } from "react";
import Link from "next/link";
import { getEngineDrivers, type EngineDrivers } from "@/lib/api/v2/aletheia-engine";
import {
  getCauseClusters, getCleansing, getDuplicateCluster, getExec, getImpact, getOverview, getOwners, getProvenCost, getTrends,
  type CauseCluster, type DuplicateCluster, type ImpactRow, type OwnerRow, type ProvenCostRow, type TrendRun,
} from "@/lib/api/v2/insights";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { moneyCompactText } from "@/lib/v2/labels";
import { f1, int, pct1 } from "@/lib/v2/score";
import { Button, Code, DataTable, type Column } from "../kit";
import { ChartCard, cardState } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend, StackedBar } from "../viz";
import { Banner, Block, ENGINE_OFF, HBars, Mark, MetricName, pctOf, RuleList, runTrend, Sev, status, useLift, useRuleName } from "./parts";

/**
 * Cost and causes (api/routes/insights.py): what bad data costs per business area, which SAP features it puts at risk,
 * which fields the failing rules share, the executive read and the cleansing pipeline. Money is shown per business area
 * only, never added across areas. The engine panel learns from run-level scores and counts; it never sees a record.
 */

const L1: Record<string, () => string> = {
  hire_to_retire: () => t("Hire to retire"),
  master_data: () => t("Master data"),
  order_to_cash: () => t("Order to cash"),
  plan_to_produce: () => t("Plan to produce"),
  procure_to_pay: () => t("Procure to pay"),
  record_to_report: () => t("Record to report"),
  unassigned: () => t("No business area"),
};
const area = (k: string | null) => L1[k ?? "unassigned"]?.() ?? k ?? f1(null);

const METRIC: Record<string, () => string> = {
  late_po: () => t("Late purchase orders (lead time and info record defects)"),
  grir_uom_variance: () => t("GR/IR variance (unit of measure defects)"),
  duplicate_payment: () => t("Duplicate vendor payments"),
  blocked_sales: () => t("Sales orders blocked (customer master)"),
};

const FEATURE_STATUS: Record<string, () => string> = {
  blocked: () => t("Blocked"),
  degraded: () => t("Degraded"),
  at_risk: () => t("At risk"),
};

/** blocking_findings carry check ids, or objects with a check_id. */
const ruleIds = (items: unknown[]) =>
  items.map((x) => (typeof x === "string" ? x : (x as { check_id?: string } | null)?.check_id)).filter((x): x is string => !!x);

const costText = (r: ProvenCostRow) =>
  r.currency ? money(r.amount, r.currency) : Object.entries(r.by_currency ?? {}).map(([c, n]) => money(n, c)).join(", ") || f1(null);

const runDay = (r: TrendRun) => (r.run_at ? formatDate(r.run_at, "date") : (r.label ?? r.version_id));

type AreaRow = { l1: string; cost: number | null; risk: number | null };

export function Insights() {
  const cost = useLift(["insights", "proven-cost"], getProvenCost, { currency: null, rows: [], cost_by_l1: [], value_at_risk_by_l1: [] });
  const impact = useLift(["insights", "impact"], getImpact, { rows: [] as ImpactRow[] });
  const causes = useLift(["insights", "root-causes"], getCauseClusters, { clusters: [] as CauseCluster[] });
  const trends = useLift(["insights", "trends"], getTrends, { runs: [] as TrendRun[] });
  const denied = cost.isError && status(cost.error) === 403;
  const c = cost.data;
  const cur = c?.currency ?? null;
  const risk = [...(c?.value_at_risk_by_l1 ?? [])].sort((a, b) => b.value_at_risk - a.value_at_risk);
  const lost = [...(c?.cost_by_l1 ?? [])].sort((a, b) => b.amount - a.amount);
  const areas: AreaRow[] = [...new Set([...risk.map((r) => r.l1), ...lost.map((r) => r.l1)])].map((l1) => ({
    l1, cost: lost.find((r) => r.l1 === l1)?.amount ?? null, risk: risk.find((r) => r.l1 === l1)?.value_at_risk ?? null,
  }));
  const top = risk[0];
  const m = (n: number) => (cur ? moneyCompactText(n, cur) : int(n));
  const trend = runTrend(trends.data?.runs ?? []);
  const featureMix = (impact.data?.rows ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const areaCols: Column<AreaRow>[] = [
    { id: "area", label: t("Business area"), cell: (r) => area(r.l1) },
    { id: "cost", label: t("Proven cost"), align: "end", cell: (r) => (r.cost != null && cur ? money(r.cost, cur) : f1(null)), compare: (a, b) => (a.cost ?? 0) - (b.cost ?? 0) },
    { id: "risk", label: t("Value at risk"), align: "end", cell: (r) => (r.risk != null && cur ? money(r.risk, cur) : f1(null)), compare: (a, b) => (a.risk ?? 0) - (b.risk ?? 0) },
  ];
  return (
    <div className="nx-body" data-testid="ins-insights">
      <p className="nx-sub">{t("Shows where failing rules put money at risk, what has already been lost in posted documents, and the fields behind the failures.")}</p>
      {denied ? <p className="nx-sub" role="alert">{t("Your role cannot read what bad data costs.")}</p> : (
        <QueryView loading={cost.isPending} error={cost.isError ? t("What bad data costs could not be read.") : null} onRetry={() => void cost.refetch()} empty={false} emptyHeading="" label={t("Cost and causes")}>
          {c ? (
            <>
              <Banner
                eyebrow={t("Cost and causes")}
                headline={top && top.value_at_risk > 0 ? t("{area} carries the most value at risk", { area: area(top.l1) }) : t("No priced SAP feature is at risk")}
                why={t("Value at risk is what the SAP features blocked or degraded by failing rules are worth. Proven cost is money already lost in posted documents. Each is shown per business area and never added across areas.")}
                figs={[
                  { label: t("Largest value at risk"), value: top ? top.value_at_risk : null, format: m, note: top ? area(top.l1) : undefined },
                  { label: t("Largest proven cost"), value: lost[0] ? lost[0].amount : null, format: m, note: lost[0] ? area(lost[0].l1) : undefined },
                  { label: t("SAP features at risk"), value: impact.data ? impact.data.rows.length : null },
                  { label: t("Root causes"), value: causes.data ? causes.data.clusters.length : null },
                ]}
                testId="ins-banner"
              />
              <div className="nx-chartcards">
                <ChartCard title={t("Score run by run")} state={cardState(trends, trend.length < 2)} figure={trend.length ? f1(trend[trend.length - 1].value) : undefined}
                  emptyLine={t("Two scored runs are needed to draw a trend.")} testId="ins-trend"
                  chart={<AreaTrend points={trend} label={t("Score run by run")} empty={t("Two scored runs are needed to draw a trend.")} />} />
                <ChartCard title={t("SAP features at risk")} state={cardState(impact, !impact.data?.rows.length)} figure={impact.data ? int(impact.data.rows.length) : undefined}
                  emptyLine={t("No priced SAP feature is blocked or degraded.")}
                  chart={<StackedBar label={t("SAP features at risk")} segs={[
                    { id: "blocked", label: t("Blocked"), value: featureMix.blocked ?? 0, tone: "bad" },
                    { id: "degraded", label: t("Degraded"), value: featureMix.degraded ?? 0, tone: "warn" },
                    { id: "at_risk", label: t("At risk"), value: featureMix.at_risk ?? 0, tone: "chart1" },
                  ]} />} />
              </div>
              <Block title={t("By business area")} meta={cur ? t("In {currency}", { currency: cur }) : undefined} testId="ins-areas">
                {areas.length === 0 ? <p className="nx-sub">{t("No cost or value at risk has been measured yet.")}</p> : (
                  <>
                    <HBars label={t("Value at risk")} bars={areas.filter((r) => r.risk != null).map((r) => ({ key: r.l1, label: area(r.l1), value: r.risk as number, text: m(r.risk as number), tone: "warn" }))} />
                    <DataTable rows={areas} columns={areaCols} rowKey={(r) => r.l1} rowLabel={(r) => area(r.l1)} caption={t("By business area")} />
                  </>
                )}
              </Block>
              <Impact rows={impact.data?.rows} q={impact} cur={cur} />
              <Causes clusters={causes.data?.clusters} q={causes} />
              <Proven rows={c.rows} />
              <Trend runs={trends.data?.runs ?? []} />
              <ExecRead />
              <Cleansing />
              <Drivers />
              <Duplicates />
              <p><Link href="/more/insights?tab=value">{t("Open value delivered")}</Link></p>
            </>
          ) : null}
        </QueryView>
      )}
    </div>
  );
}

type Q = { isPending: boolean; error: unknown; refetch: () => unknown };

function Impact({ rows, q, cur }: { rows: ImpactRow[] | undefined; q: Q; cur: string | null }) {
  const rule = useRuleName();
  const m = (n: number) => (cur ? money(n, cur) : int(n));
  const cols: Column<ImpactRow>[] = [
    { id: "feature", label: t("Feature"), cell: (r) => r.feature },
    { id: "area", label: t("Business area"), cell: (r) => area(r.l1) },
    { id: "status", label: t("Status"), cell: (r) => FEATURE_STATUS[r.status]?.() ?? r.status },
    { id: "records", label: t("Records"), align: "end", cell: (r) => int(r.record_count), compare: (a, b) => a.record_count - b.record_count },
    { id: "vpr", label: t("Value a record"), align: "end", cell: (r) => m(r.value_per_record) },
    { id: "var", label: t("Value at risk"), align: "end", cell: (r) => m(r.value_at_risk), compare: (a, b) => a.value_at_risk - b.value_at_risk },
    { id: "rules", label: t("Rules"), cell: (r) => <RuleList ids={ruleIds(r.causing_rules)} name={rule} /> },
  ];
  return (
    <Block title={t("SAP features at risk")} meta={t("Features the failing rules block or degrade, worth the records they touch")} testId="ins-impact">
      <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={!rows?.length} emptyHeading={t("No priced SAP feature is blocked or degraded.")} label={t("SAP features at risk")}>
        <DataTable rows={[...(rows ?? [])].sort((a, b) => b.value_at_risk - a.value_at_risk)} columns={cols} rowKey={(r) => r.feature} rowLabel={(r) => r.feature} caption={t("SAP features at risk")} />
      </QueryView>
    </Block>
  );
}

function Causes({ clusters, q }: { clusters: CauseCluster[] | undefined; q: Q }) {
  const rule = useRuleName();
  const cols: Column<CauseCluster>[] = [
    {
      id: "field", label: t("Field"), cell: (k) => (
        <span className="nx-cell-stack">
          {k.kind === "field" && k.table && k.field ? <Code code={`${k.table}-${k.field}`} text={null} /> : t("No single field")}
          <span className="nx-sub">{formatModuleName(k.module)}</span>
        </span>
      ),
    },
    { id: "rules", label: t("Rules"), cell: (k) => <RuleList ids={k.rules} name={rule} /> },
    { id: "sev", label: t("Severity"), cell: (k) => <Sev severity={k.severity} /> },
    { id: "records", label: t("Records"), align: "end", cell: (k) => (k.records_estimated ? t("about {n}", { n: int(k.records) }) : int(k.records)), compare: (a, b) => a.records - b.records },
    { id: "auto", label: t("Fixable automatically"), align: "end", cell: (k) => pctOf(k.auto_fix_pct) },
    { id: "origin", label: t("Where it comes from"), cell: (k) => (k.origin?.status === "computed" && k.origin.top ? <span className="nx-cell-stack">{k.origin.top}<span className="nx-sub">{pct1(k.origin.share)}</span></span> : f1(null)) },
  ];
  return (
    <Block title={t("Root causes")} meta={t("Failing rules grouped by the field they fail on, worst first")} testId="ins-causes">
      <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={!clusters?.length} emptyHeading={t("No failing rule to group yet.")} label={t("Root causes")}>
        <HBars label={t("Records per root cause")} bars={(clusters ?? []).slice(0, 8).map((k) => ({ key: k.key, label: k.table && k.field ? `${k.table}-${k.field}` : t("No single field"), value: k.records, text: int(k.records), tone: "bad" }))} />
        <DataTable rows={clusters ?? []} columns={cols} rowKey={(k) => k.key} rowLabel={(k) => k.field ?? k.key} caption={t("Root causes")} />
      </QueryView>
    </Block>
  );
}

function Proven({ rows }: { rows: ProvenCostRow[] }) {
  const rule = useRuleName();
  const cols: Column<ProvenCostRow>[] = [
    { id: "cost", label: t("Cost"), cell: (r) => METRIC[r.metric]?.() ?? r.label },
    { id: "area", label: t("Business area"), cell: (r) => area(r.l1) },
    { id: "amount", label: t("Amount"), align: "end", cell: costText },
    { id: "docs", label: t("Documents"), align: "end", cell: (r) => (r.documents == null ? f1(null) : int(r.documents)) },
    { id: "rules", label: t("Rules"), cell: (r) => <RuleList ids={r.check_ids} name={rule} /> },
  ];
  return (
    <Block title={t("Money already lost")} meta={t("Measured in posted documents and traced to the rules behind them")} testId="ins-proven">
      {rows.length === 0 ? <p className="nx-sub">{t("No posted document shows a cost from bad data yet.")}</p>
        : <DataTable rows={rows} columns={cols} rowKey={(r) => r.metric} rowLabel={(r) => r.label} caption={t("Money already lost")} />}
    </Block>
  );
}

function Trend({ runs }: { runs: TrendRun[] }) {
  const cols: Column<TrendRun>[] = [
    { id: "run", label: t("Run"), cell: runDay },
    { id: "score", label: t("Score"), align: "end", cell: (r) => f1(r.composite) },
    { id: "change", label: t("Change"), align: "end", cell: (r) => f1(r.change) },
    { id: "fixed", label: t("Rules fixed"), align: "end", cell: (r) => (r.rules_fixed == null ? f1(null) : int(r.rules_fixed)) },
    { id: "new", label: t("Rules newly failing"), align: "end", cell: (r) => (r.rules_new == null ? f1(null) : int(r.rules_new)) },
  ];
  return (
    <Block title={t("Trend over time")} meta={t("The last {n} runs, with the rules each one fixed and found", { n: int(runs.length) })} testId="ins-trend-table">
      {runs.length === 0 ? <p className="nx-sub">{t("Two scored runs are needed to draw a trend.")}</p>
        : <DataTable rows={runs} columns={cols} rowKey={(r) => r.version_id} rowLabel={runDay} caption={t("Score run by run")} />}
    </Block>
  );
}

function ExecRead() {
  const overview = useLift(["insights", "overview"], getOverview, null);
  const exec = useLift(["insights", "exec"], getExec, null);
  const owners = useLift(["insights", "owners"], getOwners, { owners: [] as OwnerRow[] });
  const o = overview.data;
  const e = exec.data;
  type Row = { id: string; label: string; value: string; before: string };
  const rows: Row[] = o?.dqs ? [
    { id: "dqs", label: t("Data quality score"), value: `${f1(o.dqs.composite)}${o.dqs.tier ? ` ${labelOf(o.dqs.tier)}` : ""}`, before: f1(o.dqs.previous) },
    ...(o.blockers ? [{ id: "blockers", label: t("Migration blockers"), value: int(o.blockers.count), before: o.blockers.previous == null ? f1(null) : int(o.blockers.previous) }] : []),
    ...(o.auto_fixable ? [{ id: "fix", label: t("Records with a suggested fix"), value: t("{a} of {b}", { a: int(o.auto_fixable.records), b: int(o.auto_fixable.failing_records) }), before: f1(null) }] : []),
  ] : [];
  const cols: Column<Row>[] = [
    { id: "m", label: t("Measure"), cell: (r) => r.label },
    { id: "v", label: t("Value"), align: "end", cell: (r) => r.value },
    { id: "b", label: t("Before"), align: "end", cell: (r) => r.before },
  ];
  const ownerCols: Column<OwnerRow>[] = [
    { id: "owner", label: t("Owner"), cell: (r) => r.owner },
    { id: "score", label: t("Score"), align: "end", cell: (r) => f1(r.score), compare: (a, b) => (a.score ?? 0) - (b.score ?? 0) },
    { id: "delta", label: t("Change"), align: "end", cell: (r) => f1(r.delta) },
    { id: "open", label: t("Open items"), align: "end", cell: (r) => int(Object.values(r.open_by_severity).reduce((a, b) => a + b, 0)) },
    { id: "fixed", label: t("Fixed"), align: "end", cell: (r) => (r.fixed_since_baseline == null ? f1(null) : int(r.fixed_since_baseline)) },
    { id: "age", label: t("Oldest item"), align: "end", cell: (r) => (r.oldest_item_age_days == null ? f1(null) : t("{n} days", { n: int(r.oldest_item_age_days) })) },
    { id: "digest", label: t("Digest"), cell: (r) => <span className="nx-cell-stack">{r.schedule ?? f1(null)}<span className="nx-sub">{r.last_sent ? t("Last sent {day}", { day: formatDate(r.last_sent, "date") }) : t("Not sent yet")}</span></span> },
  ];
  const v = o?.value_at_risk;
  return (
    <>
      <Block title={t("Executive read")} meta={t("The headline of the latest run")} testId="ins-exec">
        <QueryView loading={overview.isPending} error={overview.error} onRetry={() => void overview.refetch()} empty={!o?.dqs} emptyHeading={t("No finished run has been read yet.")} label={t("Executive read")}>
          <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} rowLabel={(r) => r.label} caption={t("Executive read")} />
          {o?.dqs?.capped && o.dqs.cap_reason ? <p className="nx-sub">{t("The score is capped: {reason}", { reason: o.dqs.cap_reason })}</p> : null}
          {v?.worst_l1 && v.worst_l1_amount != null && v.currency ? (
            <p className="nx-sub"><strong>{t("Largest value at risk")}</strong> {area(v.worst_l1)} {money(v.worst_l1_amount, v.currency)}</p>
          ) : null}
          {o?.narrative ? <p>{o.narrative}</p> : null}
        </QueryView>
      </Block>
      <Block title={t("Where the score loses points")} meta={t("Points lost per business area")} testId="ins-exec-waterfall">
        <QueryView loading={exec.isPending} error={exec.error} onRetry={() => void exec.refetch()} empty={!e?.waterfall.length} emptyHeading={t("No score has been broken down yet.")} label={t("Where the score loses points")}>
          <HBars label={t("Points lost per business area")} testId="ins-exec-bars"
            bars={(e?.waterfall ?? []).map((w) => ({ key: w.x, label: w.l1 ? area(w.l1) : w.x, value: Math.abs(w.y), text: f1(w.y), tone: "warn" }))} />
          {e?.narrative ? <p>{e.narrative}</p> : null}
        </QueryView>
      </Block>
      <Block title={t("Owners")} meta={t("Each owner's score and the digest they get")} testId="ins-owners">
        <QueryView loading={owners.isPending} error={owners.error} onRetry={() => void owners.refetch()} empty={!owners.data?.owners.length} emptyHeading={t("No owner has been named for a failing rule yet.")} label={t("Owners")}>
          <DataTable rows={owners.data?.owners ?? []} columns={ownerCols} rowKey={(r) => r.owner} rowLabel={(r) => r.owner} caption={t("Owners")} />
        </QueryView>
      </Block>
    </>
  );
}

function Cleansing() {
  const q = useLift(["insights", "cleansing"], getCleansing, null);
  const rule = useRuleName();
  const d = q.data;
  type ModRow = NonNullable<typeof d>["by_module"][number];
  type RuleRow = NonNullable<typeof d>["by_rule"][number];
  const modCols: Column<ModRow>[] = [
    { id: "object", label: t("Object"), cell: (r) => formatModuleName(r.module) },
    { id: "failing", label: t("Failing"), align: "end", cell: (r) => int(r.failing) },
    { id: "proposed", label: t("Fix proposed"), align: "end", cell: (r) => int(r.proposed) },
    { id: "high", label: t("High confidence"), align: "end", cell: (r) => int(r.high) },
  ];
  const ruleCols: Column<RuleRow>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => rule(r.check_id) },
    { id: "proposed", label: t("Fix proposed"), align: "end", cell: (r) => int(r.proposed) },
    { id: "high", label: t("High confidence"), align: "end", cell: (r) => int(r.high) },
    { id: "auto", label: t("Automatic"), align: "end", cell: (r) => int(r.auto) },
  ];
  return (
    <Block title={t("Cleansing pipeline")} meta={t("From failing records to fixes applied")} testId="ins-cleansing">
      <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={!d?.steps.length} emptyHeading={t("No cleansing has started, because no run has failing records.")} label={t("Cleansing pipeline")}>
        {d ? (
          <>
            <HBars label={t("Records at each step")} testId="ins-cleansing-bars" bars={d.steps.map((s) => ({ key: s.key, label: s.label, value: s.records, text: int(s.records), tone: s.key === "applied" ? "good" : undefined }))} />
            {d.by_module.length > 0 ? <DataTable rows={d.by_module} columns={modCols} rowKey={(r) => r.module} rowLabel={(r) => formatModuleName(r.module)} caption={t("Cleansing by object")} /> : null}
            {d.by_rule.length > 0 ? <DataTable rows={d.by_rule} columns={ruleCols} rowKey={(r) => r.check_id} rowLabel={(r) => r.check_id} caption={t("Cleansing by rule")} /> : null}
          </>
        ) : null}
      </QueryView>
    </Block>
  );
}

function Drivers() {
  const q = useLift<EngineDrivers>(["insights", "engine-drivers"], getEngineDrivers, { labels: {}, available: false, reason: "too_few_runs" });
  const d = q.data;
  type Range = NonNullable<EngineDrivers["ranges"]>[number];
  type LinkRow = NonNullable<EngineDrivers["links"]>[number];
  const labels = d?.labels ?? {};
  const rangeCols: Column<Range>[] = [
    { id: "m", label: t("Measure"), cell: (r) => <MetricName labels={labels} metric={r.metric} /> },
    { id: "range", label: t("Normal range"), align: "end", cell: (r) => t("{low} to {high}", { low: f1(r.low), high: f1(r.high) }) },
    { id: "latest", label: t("Latest run"), align: "end", cell: (r) => f1(r.latest) },
    { id: "verdict", label: t("Verdict"), cell: (r) => (r.outside ? t("Outside the normal range") : t("Within the normal range")) },
  ];
  const linkCols: Column<LinkRow>[] = [
    { id: "src", label: t("Measure"), cell: (e) => <MetricName labels={labels} metric={e.source} /> },
    { id: "tgt", label: t("Moves"), cell: (e) => <MetricName labels={labels} metric={e.target} /> },
    { id: "lag", label: t("Runs later"), align: "end", cell: (e) => (e.lag == null ? f1(null) : int(e.lag)) },
    { id: "corr", label: t("Correlation"), align: "end", cell: (e) => (e.correlation == null ? f1(null) : e.correlation.toFixed(2)) },
  ];
  return (
    <Block title={t("What moves the score")} meta={t("Learned by the Aletheia engine from the last {n} runs", { n: int(d?.runs ?? 0) })} testId="ins-drivers">
      <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("What moves the score")}>
        {!d ? null : !d.available ? <p className="nx-sub">{ENGINE_OFF[d.reason ?? "engine_error"]?.() ?? ENGINE_OFF.engine_error()}</p> : (
          <>
            <Mark />
            <DataTable rows={d.ranges ?? []} columns={rangeCols} rowKey={(r) => r.metric} rowLabel={(r) => labels[r.metric] ?? r.metric} caption={t("Normal range per measure")} />
            {(d.links ?? []).length === 0 ? <p className="nx-sub">{t("The engine found no measure that leads another.")}</p>
              : <DataTable rows={d.links ?? []} columns={linkCols} rowKey={(e) => `${e.source}-${e.target}-${e.lag}`} rowLabel={(e) => e.source} caption={t("Measures that move together")} />}
          </>
        )}
      </QueryView>
    </Block>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One duplicate cluster around a golden record (GET /insights/duplicates/{object}/{record_id}): keys and match scores only. */
function Duplicates() {
  const [object, setObject] = useState("");
  const [record, setRecord] = useState("");
  const [ask, setAsk] = useState<{ object: string; record: string } | null>(null);
  const q = useLift<DuplicateCluster | null>(
    ["insights", "duplicates", ask?.object, ask?.record],
    () => (ask ? getDuplicateCluster(ask.object, ask.record) : Promise.resolve(null)),
    null,
    ask !== null,
  );
  const valid = object.trim() !== "" && UUID.test(record.trim());
  const d = q.data;
  type Edge = DuplicateCluster["edges"][number];
  const score = (e: Edge) => (e.label === "" || Number.isNaN(Number(e.label)) ? null : Number(e.label));
  const band = (e: Edge) => {
    const v = score(e);
    if (!d || v === null) return t("Not scored");
    return v >= d.thresholds.auto_merge ? t("Merges automatically") : v >= d.thresholds.review_floor ? t("Needs a steward review") : t("Below the review floor");
  };
  const cols: Column<Edge>[] = [
    { id: "a", label: t("Record"), cell: (e) => <Code code={e.source} /> },
    { id: "b", label: t("Matches"), cell: (e) => <Code code={e.target} /> },
    { id: "score", label: t("Match score"), align: "end", cell: (e) => e.label || f1(null) },
    { id: "band", label: t("Verdict"), cell: band },
  ];
  return (
    <Block title={t("Duplicate cluster")} meta={t("The records that match one golden record, with each match score")} testId="ins-duplicates">
      <form className="nx-ins-actions" onSubmit={(ev) => { ev.preventDefault(); if (valid) setAsk({ object: object.trim(), record: record.trim() }); }}>
        <label>{t("Object")} <input className="nx-input" value={object} onChange={(e) => setObject(e.target.value)} data-testid="ins-dup-object" /></label>
        <label>{t("Golden record id")} <input className="nx-input" value={record} onChange={(e) => setRecord(e.target.value)} data-testid="ins-dup-record" /></label>
        <Button type="submit" variant="secondary" disabled={!valid} data-testid="ins-dup-show">{t("Show the cluster")}</Button>
      </form>
      {!valid ? <p className="nx-sub">{t("Enter an object and a golden record id.")}</p> : null}
      {ask ? (
        <QueryView loading={q.isPending} error={q.error} onRetry={() => void q.refetch()} empty={!d?.nodes.length} emptyHeading={t("This golden record has no duplicates.")} label={t("Duplicate cluster")}>
          {d ? (
            <>
              <p className="nx-sub" data-testid="ins-dup-summary">
                {t("{n} records, {m} links. Merges automatically at {auto}, needs review from {floor}.", { n: int(d.nodes.length), m: int(d.edges.length), auto: d.thresholds.auto_merge.toFixed(2), floor: d.thresholds.review_floor.toFixed(2) })}
              </p>
              <HBars
                label={t("Match score per link")}
                testId="ins-dup-bars"
                bars={d.edges.map((e, i) => ({ key: `${e.source}-${e.target}-${i}`, label: t("{a} and {b}", { a: e.source, b: e.target }), value: score(e) ?? 0, text: e.label || f1(null), tone: (score(e) ?? 0) >= d.thresholds.auto_merge ? "good" : undefined }))}
              />
              <DataTable rows={d.edges} columns={cols} rowKey={(e) => `${e.source}-${e.target}`} rowLabel={(e) => e.source} caption={t("Links in the cluster")} />
            </>
          ) : null}
        </QueryView>
      ) : null}
    </Block>
  );
}

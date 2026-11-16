"use client";

import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getImpactPortfolio, getValue, type ImpactCategory, type Value as ValueData } from "@/lib/api/v2/analytics";
import { getGuards, getImpact, getLineageModel, type GuardStep, type ImpactRow } from "@/lib/api/v2/lineage";
import { formatModuleName } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { useRunList } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { f1, int, pct1 } from "@/lib/v2/score";
import { valueRibbons, type Ribbon } from "@/lib/v2/value-ribbon";
import { Code, DataTable, EmptyState, ErrorState, Skeleton, Sparkline, type Column } from "../kit";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";

/**
 * Value delivered: the latest finished run priced into eight kinds of business loss from the tenant cost model, the
 * share Meridian's fixes take off each, and the return against the subscription (api/routes/analytics.py /roi).
 * Every amount is the backend's; with no subscription in the cost model the multiple and payback show as a dash.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
const pctOf = (n: number | null | undefined) => (n == null ? pct1(null) : pct1(n / 100));

const CATEGORY: Record<string, { name: () => string; what: () => string }> = {
  duplicate_payment: { name: () => t("Duplicate payments"), what: () => t("Records failing a uniqueness rule, priced as payments made twice") },
  warranty_miss: { name: () => t("Missed warranty claims"), what: () => t("Warranty and expiry dates left blank, priced as claims never made") },
  compliance_penalty: { name: () => t("Compliance penalties"), what: () => t("Tax, VAT and regulatory fields that fail, priced as fines") },
  inventory_write_off: { name: () => t("Inventory write-offs"), what: () => t("Incomplete material records, priced as stock written off") },
  blocked_invoice: { name: () => t("Blocked invoices"), what: () => t("Invoices blocked by bad master data, priced per invoice") },
  failed_posting: { name: () => t("Failed postings"), what: () => t("Documents that failed to post, priced per posting") },
  contract_violation: { name: () => t("Contract violations"), what: () => t("Orders that broke a contract term, priced per breach") },
  labour_displacement: { name: () => t("Steward time saved"), what: () => t("Items fixed automatically, priced as the steward hours they saved") },
};
const catName = (k: string) => CATEGORY[k]?.name() ?? k;

const SEVERITY: Record<string, () => string> = { low: () => t("Low"), medium: () => t("Medium"), high: () => t("High"), critical: () => t("Critical") };
const KIND: Record<string, () => string> = { full_block: () => t("Blocks the feature"), degraded: () => t("Degrades the feature"), cosmetic: () => t("Cosmetic") };

const empty: ValueData = { roi: { subscription_annual: null, risk_mitigated: 0, roi_multiple: null, payback_months: null, currency: "" }, impacts: [], cost_avoidance_history: [] };

/** The backend's pricing formula ("affected_count × 5,000 USD") in words: "Failing records × 5,000 USD". */
const priced = (method: string) => method.replace(/\baffected_count\b/, t("Failing records")).replace(/^count\b/, t("Findings"));

/** Bars are drawn as a share of the largest value, so the longest bar is the biggest amount. */
const share = (v: number, max: number) => (max > 0 ? (v / max) * 100 : 0);

/** Loading, refused and failed states for one panel. */
function Part<T>({ q, label, children }: { q: UseQueryResult<T, unknown>; label: string; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Skeleton lines={4} label={label} />;
  if (q.isError) {
    return status(q.error) === 403
      ? <EmptyState heading={t("Your role cannot read the value delivered.")} />
      : <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
  }
  return <>{children(q.data)}</>;
}

export function Value() {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["value", fixture],
    queryFn: async () => {
      try {
        return await getValue();
      } catch (e) {
        if (status(e) === 404) return empty;
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
  const title = t("Value delivered");

  if (q.isPending) return <Skeleton lines={8} label={title} />;
  if (q.isError) {
    return status(q.error) === 403
      ? <EmptyState heading={t("Your role cannot read the value delivered.")} />
      : <ErrorState sentence={t("The value delivered could not be read.")} onRetry={() => void q.refetch()} />;
  }
  const { roi, impacts, cost_avoidance_history: months } = q.data;
  const cur = roi.currency;
  const risk = impacts.reduce((s, i) => s + i.annual_risk, 0);
  const noSub = roi.subscription_annual == null;
  const headline = !impacts.some((i) => i.finding_count)
    ? t("No priced loss in the latest run")
    : roi.roi_multiple == null
      ? t("{amount} a year taken off the risk", { amount: money(roi.risk_mitigated, cur) })
      : t("Returns {n} times its cost", { n: f1(roi.roi_multiple) });
  return (
    <div className="nx-body">
      <Banner
        testId="val-banner"
        label={title}
        meta={title}
        title={headline}
        why={t("The latest finished run is priced with your cost model: each failing record carries the unit cost of the loss it can cause, and the mitigation share is what fixing it removes.")}
        figs={[
          { label: t("Annual risk found"), value: money(risk, cur) },
          { label: t("Risk mitigated a year"), value: money(roi.risk_mitigated, cur) },
          { label: t("Return on the subscription"), value: roi.roi_multiple == null ? f1(null) : t("{n} times", { n: f1(roi.roi_multiple) }), note: noSub ? t("subscription cost is not set") : undefined },
          { label: t("Payback"), value: roi.payback_months == null ? f1(null) : t("{n} months", { n: f1(roi.payback_months) }), note: noSub ? undefined : t("on {amount} a year", { amount: money(roi.subscription_annual ?? 0, cur) }) },
        ]}
      />
      <Impact rows={impacts} />
      <Ribbons />
      <Fold title={t("Impact of the latest run")} hint={t("What each kind of loss costs a year and how much is already mitigated")}><Portfolio /></Fold>
      <Fold title={t("Cost avoided month by month")} hint={t("Recorded by the monthly report, newest first")}><Months rows={months} currency={cur} /></Fold>
      <Fold title={t("What the latest run puts at risk")} hint={t("KPIs, processes and S/4HANA features")}><RunImpact currency={cur} /></Fold>
      <Fold title={t("Rules guarding each KPI")} hint={t("Steps no rule guards come first")}><Guards /></Fold>
      <About
        shows={t("Prices the failing records of the latest run as money at risk and shows what fixing them has saved.")}
        next={{ href: "/insights", label: t("Open cost and causes") }}
        why={t("Opens the causes behind these losses. Nothing is changed.")}
        means={[
          [t("Annual risk found"), t("What the failing records would cost over a year, from your cost model.")],
          [t("Risk mitigated a year"), t("The share of that risk that fixing removes.")],
          [t("Payback"), t("Months until the risk removed covers the subscription; a dash means the subscription cost is not set.")],
        ]}
      />
    </div>
  );
}

function Impact({ rows }: { rows: ImpactCategory[] }) {
  const title = t("Where the risk sits");
  const sorted = [...rows].sort((a, b) => b.annual_risk - a.annual_risk);
  const max = Math.max(0, ...sorted.map((i) => i.annual_risk));
  const cols: Column<ImpactCategory>[] = [
    { id: "loss", label: t("Loss"), cell: (i) => catName(i.category) },
    { id: "what", label: t("What counts"), cell: (i) => <span>{CATEGORY[i.category]?.what() ?? f1(null)}{i.calculation_method ? <span className="nx-sub"> {priced(i.calculation_method)}</span> : null}</span> },
    { id: "sources", label: t("Sources"), align: "end", cell: (i) => int(i.finding_count), compare: (a, b) => a.finding_count - b.finding_count },
    { id: "risk", label: t("Annual risk"), align: "end", cell: (i) => money(i.annual_risk, i.currency), compare: (a, b) => a.annual_risk - b.annual_risk },
    { id: "mitigated", label: t("Mitigated"), align: "end", cell: (i) => money(i.mitigated, i.currency), compare: (a, b) => a.mitigated - b.mitigated },
  ];
  return (
    <Panel title={title} meta={t("Each kind of loss, priced from the latest run")} testId="val-impact">
      {sorted.length === 0 ? <EmptyState heading={t("No finished run has been priced yet.")} /> : (<>
        <HBars
          label={t("Annual risk by kind of loss")}
          rows={sorted.filter((i) => i.annual_risk > 0).map((i) => ({ key: i.category, label: catName(i.category), value: share(i.annual_risk, max), text: money(i.annual_risk, i.currency), tone: i.mitigated >= i.annual_risk ? "good" : "bad" }))}
        />
        <DataTable caption={title} rows={sorted} rowKey={(i) => i.category} rowLabel={(i) => catName(i.category)} columns={cols} />
      </>)}
    </Panel>
  );
}

function Portfolio() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["extra", "impact", fixture], queryFn: getImpactPortfolio, staleTime: 60_000, retry });
  const title = t("Impact of the latest run");
  type Row = Awaited<ReturnType<typeof getImpactPortfolio>>["impacts"][number];
  const cols: Column<Row>[] = [
    { id: "loss", label: t("Loss"), cell: (i) => catName(i.category) },
    { id: "risk", label: t("Annual risk"), align: "end", cell: (i) => money(i.annual_risk, i.currency), compare: (a, b) => a.annual_risk - b.annual_risk },
    { id: "mitigated", label: t("Mitigated"), align: "end", cell: (i) => money(i.mitigated, i.currency) },
    { id: "share", label: t("Share mitigated"), align: "end", cell: (i) => (i.annual_risk > 0 ? pct1(i.mitigated / i.annual_risk) : f1(null)) },
    { id: "findings", label: t("Findings"), align: "end", cell: (i) => int(i.finding_count) },
  ];
  return (
    <Panel title={title} meta={t("What each kind of loss costs a year and how much is already mitigated")} testId="val-portfolio">
      <Part q={q} label={title}>
        {(d) => d.impacts.length === 0 ? <EmptyState heading={t("No finished run has been priced yet.")} /> : (
          <DataTable caption={title} rows={[...d.impacts].sort((a, b) => b.annual_risk - a.annual_risk)} rowKey={(i) => i.category} rowLabel={(i) => catName(i.category)} columns={cols} />
        )}
      </Part>
    </Panel>
  );
}

type Month = ValueData["cost_avoidance_history"][number];

function Months({ rows, currency }: { rows: Month[]; currency: string }) {
  const title = t("Cost avoided month by month");
  const asc = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const last = asc.slice(-12);
  const max = Math.max(0, ...last.map((m) => m.risk_mitigated_zar));
  const cols: Column<Month>[] = [
    { id: "month", label: t("Month"), cell: (m) => m.period },
    { id: "sub", label: t("Subscription"), align: "end", cell: (m) => money(m.subscription_cost_zar, currency) },
    { id: "mitigated", label: t("Risk mitigated"), align: "end", cell: (m) => money(m.risk_mitigated_zar, currency) },
    { id: "roi", label: t("Return to date"), align: "end", cell: (m) => (m.cumulative_roi_multiple == null ? f1(null) : t("{n} times", { n: f1(m.cumulative_roi_multiple) })) },
  ];
  return (
    <Panel title={title} meta={t("Recorded by the monthly report, newest first")} testId="val-months">
      {asc.length === 0 ? <EmptyState heading={t("No month has been recorded yet. The monthly report records one on the first of each month.")} /> : (<>
        <HBars
          label={t("Risk mitigated over the last {n} months", { n: int(last.length) })}
          rows={last.map((m) => ({ key: m.period, label: m.period, value: share(m.risk_mitigated_zar, max), text: money(m.risk_mitigated_zar, currency), tone: m.risk_mitigated_zar >= m.subscription_cost_zar ? "good" : "warn" }))}
        />
        <DataTable caption={title} rows={[...asc].reverse()} rowKey={(m) => m.period} rowLabel={(m) => m.period} columns={cols} />
      </>)}
    </Panel>
  );
}

/** Steps no rule guards first, then the weakest guard, so the exposed step heads the list. */
const exposure = (a: GuardStep, b: GuardStep) =>
  Number(b.guard_count === 0) - Number(a.guard_count === 0) || (a.min_pass_rate ?? 101) - (b.min_pass_rate ?? 101);

/**
 * Rules guarding a KPI or process: every process step the lineage model puts behind it, the rules reading its fields,
 * the weakest of their latest pass rates and the fields no rule reads (api/routes/lineage.py /guards).
 */
function Guards() {
  const f = useFixture();
  const model = useQuery({ queryKey: ["v2", "lineage", "model", f], queryFn: getLineageModel, staleTime: 300_000, retry });
  const [pick, setPick] = useState<string | null>(null);
  const node = pick ?? model.data?.kpis[0]?.id ?? null;
  const q = useQuery({ queryKey: ["v2", "lineage", "guards", f, node], queryFn: () => getGuards(node as string), enabled: node !== null, staleTime: 60_000, retry });
  const title = t("Rules guarding each KPI");
  const l1 = (model.data?.processes ?? []).filter((p) => !p.id.includes("-"));
  const cols: Column<GuardStep>[] = [
    { id: "step", label: t("Process step"), cell: (s) => <span>{s.label}{s.l2 ? <> <Code code={s.l2} /></> : null}</span> },
    { id: "tcode", label: t("Transaction"), cell: (s) => (s.tcode ? <Code code={s.tcode} /> : f1(null)) },
    { id: "rules", label: t("Rules"), align: "end", cell: (s) => (s.guard_count ? int(s.guard_count) : t("None")) },
    { id: "pass", label: t("Weakest pass rate"), align: "end", cell: (s) => pctOf(s.min_pass_rate) },
    { id: "fields", label: t("Fields no rule reads"), cell: (s) => (s.unguarded_fields.length ? <span>{s.unguarded_fields.map((x) => <Code key={x} code={x} />)}</span> : t("None")) },
  ];
  return (
    <Panel title={title} meta={t("Every process step behind a KPI or process, with the rules that read its fields")} testId="val-guards">
      <Part q={model} label={title}>
        {(m) => m.kpis.length + l1.length === 0 ? <EmptyState heading={t("The lineage model maps no KPI or process.")} /> : (<>
          <label className="nx-sub">
            {t("KPI or process")}{" "}
            <select className="nx-input" value={node ?? ""} onChange={(e) => setPick(e.target.value)} data-testid="val-guards-pick">
              <optgroup label={t("KPIs")}>{m.kpis.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</optgroup>
              <optgroup label={t("Processes")}>{l1.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            </select>
          </label>
          {q.isPending ? <Skeleton lines={3} label={title} /> : q.isError ? (
            <ErrorState sentence={t("The rules guarding this KPI could not be read.")} onRetry={() => void q.refetch()} />
          ) : q.data.steps.length === 0 ? <EmptyState heading={t("The lineage model puts no process step behind this KPI.")} /> : (<>
            <p className="nx-sub" data-testid="val-guards-sum">
              {q.data.coverage_gaps.length
                ? t("{gaps, plural, one {# step has} other {# steps have}} no rule guarding {n, plural, one {it} other {them}}, of {total}.", { gaps: q.data.coverage_gaps.length, n: q.data.coverage_gaps.length, total: q.data.steps.length })
                : t("Every one of the {n, plural, one {# step} other {# steps}} has a rule guarding it.", { n: q.data.steps.length })}
            </p>
            <DataTable caption={title} rows={[...q.data.steps].sort(exposure)} rowKey={(s) => s.id} rowLabel={(s) => s.label} columns={cols} />
          </>)}
        </>)}
      </Part>
    </Panel>
  );
}

/**
 * What the latest run's failing checks reach: the KPIs, processes and S/4HANA features behind them, with findings,
 * records affected, the worst severity and, when the findings are priced, the cost at risk (api/routes/lineage.py /impact).
 */
function RunImpact({ currency }: { currency: string }) {
  const f = useFixture();
  const runs = useRunList();
  const vid = runs.data?.versions[0]?.id ?? null;
  const q = useQuery({ queryKey: ["v2", "lineage", "impact", f, vid], queryFn: () => getImpact(vid as string), enabled: vid !== null, staleTime: 60_000, retry });
  const title = t("What the latest run puts at risk");
  type Row = { g: string; x: ImpactRow };
  const body = () => {
    if (runs.isPending || (vid !== null && q.isPending)) return <Skeleton lines={4} label={title} />;
    if (runs.isError) return <ErrorState sentence={t("This list could not be read.")} onRetry={() => void runs.refetch()} />;
    if (q.isError) return <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
    if (!q.data) return <EmptyState heading={t("No finished run has been priced yet.")} />;
    const d = q.data;
    const groups: [string, ImpactRow[]][] = [[t("KPIs"), d.kpis], [t("Processes"), d.processes], [t("S/4HANA features"), d.features]];
    const rows: Row[] = groups.flatMap(([g, r]) => r.map((x) => ({ g, x })));
    if (rows.length === 0) return <EmptyState heading={t("No failing rule reaches a KPI, process or feature in this run.")} />;
    const cols: Column<Row>[] = [
      { id: "reaches", label: t("Reaches"), cell: ({ x }) => x.label },
      { id: "kind", label: t("Kind"), cell: ({ g, x }) => <span>{g}{x.worst_impact ? <span className="nx-sub"> {KIND[x.worst_impact]?.() ?? x.worst_impact}</span> : null}</span> },
      { id: "findings", label: t("Findings"), align: "end", cell: ({ x }) => int(x.findings), compare: (a, b) => a.x.findings - b.x.findings },
      { id: "records", label: t("Records affected"), align: "end", cell: ({ x }) => int(x.records_affected), compare: (a, b) => a.x.records_affected - b.x.records_affected },
      { id: "sev", label: t("Worst severity"), cell: ({ x }) => (x.worst_severity ? SEVERITY[x.worst_severity]?.() ?? x.worst_severity : f1(null)) },
      { id: "cost", label: t("Cost at risk"), align: "end", cell: ({ x }) => (d.cost_available && x.cost_at_risk != null ? money(x.cost_at_risk, currency) : f1(null)) },
    ];
    return (<>
      <DataTable caption={title} rows={rows} rowKey={(r) => `${r.g}-${r.x.id}`} rowLabel={(r) => r.x.label} columns={cols} />
      {d.unmapped_checks.length ? (
        <p className="nx-sub" data-testid="val-run-impact-unmapped">
          {t("{n, plural, one {# failing rule is} other {# failing rules are}} not placed behind any KPI by the lineage model:", { n: d.unmapped_checks.length })}{" "}
          {d.unmapped_checks.map((c) => <Code key={c} code={c} />)}
        </p>
      ) : null}
    </>);
  };
  return <Panel title={title} meta={t("The KPIs, processes and S/4HANA features behind the failing rules")} testId="val-run-impact">{body()}</Panel>;
}

/** Value at risk per object, run by run, from the run timeline. An object no run priced shows a dash and the reason. */
function Ribbons() {
  const tl = useTimeline(null, 8);
  const title = t("Value at risk by object");
  const cols: Column<Ribbon>[] = [
    { id: "object", label: t("Object"), cell: (r) => formatModuleName(r.object) },
    { id: "trend", label: t("Over the last runs"), cell: (r) => <Sparkline points={r.series.filter((v): v is number => v != null)} label={t("Value at risk of {object} over the last runs", { object: formatModuleName(r.object) })} /> },
    { id: "latest", label: t("Latest run"), align: "end", cell: (r) => (r.latest == null ? f1(null) : money(r.latest, r.currency)) },
  ];
  return (
    <Panel title={title} meta={t("Priced failing records per object, over the last runs")} testId="val-ribbon">
      <Part q={tl} label={title}>
        {(d) => {
          const rows = valueRibbons(d);
          return rows.length === 0
            ? <EmptyState heading={`${f1(null)} ${t("No run has priced the failing records of an object yet. The cost model prices them when it is set.")}`} />
            : <DataTable caption={title} rows={rows} rowKey={(r) => r.object} rowLabel={(r) => formatModuleName(r.object)} columns={cols} />;
        }}
      </Part>
    </Panel>
  );
}

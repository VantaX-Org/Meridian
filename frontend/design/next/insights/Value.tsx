"use client";

import { useState } from "react";
import Link from "next/link";
import { getImpactPortfolio, getValue, type ImpactCategory, type Value as ValueData } from "@/lib/api/v2/analytics";
import { getGuards, getImpact, getLineageModel, type GuardStep, type ImpactRow } from "@/lib/api/v2/lineage";
import { formatModuleName } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { moneyCompactText } from "@/lib/v2/labels";
import { useRunList } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { f1, int, pct1 } from "@/lib/v2/score";
import { valueRibbons, type Ribbon } from "@/lib/v2/value-ribbon";
import { Code, DataTable, Sparkline, type Column } from "../kit";
import { ChartCard, cardState } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend } from "../viz";
import { Banner, Block, HBars, pctOf, status, useLift } from "./parts";

/**
 * Value delivered: the latest finished run priced into eight kinds of business loss from the tenant cost model, the
 * share Meridian's fixes take off each, and the return against the subscription (api/routes/analytics.py /roi).
 * Every amount is the backend's; with no subscription in the cost model the multiple and payback show as a dash.
 */

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

const EMPTY: ValueData = { roi: { subscription_annual: null, risk_mitigated: 0, roi_multiple: null, payback_months: null, currency: "" }, impacts: [], cost_avoidance_history: [] };

/** The backend's pricing formula ("affected_count x 5,000 USD") in words: "Failing records x 5,000 USD". */
const priced = (method: string) => method.replace(/\baffected_count\b/, t("Failing records")).replace(/^count\b/, t("Findings"));

export function Value() {
  const q = useLift(["value"], getValue, EMPTY);
  const denied = q.isError && status(q.error) === 403;
  return (
    <div className="nx-body" data-testid="ins-value">
      <p className="nx-sub">{t("Prices the failing records of the latest run as money at risk and shows what fixing them has saved.")}</p>
      {denied ? <p className="nx-sub" role="alert">{t("Your role cannot read the value delivered.")}</p> : (
        <QueryView loading={q.isPending} error={q.isError ? t("The value delivered could not be read.") : null} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Value delivered")}>
          {q.data ? <Body d={q.data} q={q} /> : null}
        </QueryView>
      )}
    </div>
  );
}

function Body({ d, q }: { d: ValueData; q: Parameters<typeof cardState>[0] }) {
  const { roi, impacts, cost_avoidance_history: months } = d;
  const cur = roi.currency;
  const m = (n: number) => (cur ? moneyCompactText(n, cur) : int(n));
  const risk = impacts.reduce((s, i) => s + i.annual_risk, 0);
  const noSub = roi.subscription_annual == null;
  const headline = !impacts.some((i) => i.finding_count)
    ? t("No priced loss in the latest run")
    : roi.roi_multiple == null
      ? t("{amount} a year taken off the risk", { amount: money(roi.risk_mitigated, cur) })
      : t("Returns {n} times its cost", { n: f1(roi.roi_multiple) });
  const asc = [...months].sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  const monthPts = asc.map((x) => ({ label: x.period, value: x.risk_mitigated_zar }));
  const mitigatedShare = risk > 0 ? roi.risk_mitigated / risk : null;
  return (
    <>
      <Banner
        eyebrow={t("Value delivered")}
        verdict={roi.roi_multiple == null ? undefined : roi.roi_multiple >= 1 ? "go" : "at-risk"}
        headline={headline}
        why={t("The latest finished run is priced with your cost model: each failing record carries the unit cost of the loss it can cause, and the mitigation share is what fixing it removes.")}
        figs={[
          { label: t("Annual risk found"), value: risk, format: m },
          { label: t("Risk mitigated a year"), value: roi.risk_mitigated, format: m },
          { label: t("Return on the subscription"), value: roi.roi_multiple, format: (n) => t("{n} times", { n: f1(n) }), note: noSub ? t("subscription cost is not set") : undefined },
          { label: t("Payback"), value: roi.payback_months, format: (n) => t("{n} months", { n: f1(n) }), note: noSub ? undefined : t("on {amount} a year", { amount: money(roi.subscription_annual ?? 0, cur) }) },
        ]}
        testId="val-banner"
      />
      <div className="nx-chartcards">
        <ChartCard title={t("Cost avoided month by month")} state={cardState(q, monthPts.length < 2)} figure={monthPts.length ? m(monthPts[monthPts.length - 1].value) : undefined}
          emptyLine={t("No month has been recorded yet. The monthly report records one on the first of each month.")}
          chart={<AreaTrend points={monthPts} label={t("Risk mitigated over the last {n} months", { n: int(monthPts.length) })} empty={t("No month has been recorded yet. The monthly report records one on the first of each month.")} />} />
        <ChartCard title={t("Risk mitigated a year")} state={cardState(q, risk <= 0)} figure={mitigatedShare == null ? undefined : pct1(mitigatedShare)}
          emptyLine={t("No finished run has been priced yet.")}
          chart={<HBars label={t("Annual risk by kind of loss")} bars={[
            { key: "risk", label: t("Annual risk found"), value: risk, text: m(risk), tone: "bad" },
            { key: "mitigated", label: t("Risk mitigated a year"), value: roi.risk_mitigated, text: m(roi.risk_mitigated), tone: "good" },
          ]} />} />
      </div>
      <ImpactPanel rows={impacts} />
      <RibbonPanel />
      <Portfolio />
      <MonthsPanel rows={months} currency={cur} />
      <RunImpactPanel currency={cur} />
      <GuardsPanel />
      <p><Link href="/more/insights?tab=insights">{t("Open cost and causes")}</Link></p>
    </>
  );
}

function ImpactPanel({ rows }: { rows: ImpactCategory[] }) {
  const sorted = [...rows].sort((a, b) => b.annual_risk - a.annual_risk);
  const cols: Column<ImpactCategory>[] = [
    { id: "loss", label: t("Loss"), cell: (i) => catName(i.category) },
    {
      id: "what", label: t("What counts"), cell: (i) => (
        <span className="nx-cell-stack">{CATEGORY[i.category]?.what() ?? f1(null)}{i.calculation_method ? <span className="nx-sub">{priced(i.calculation_method)}</span> : null}</span>
      ),
    },
    { id: "sources", label: t("Sources"), align: "end", cell: (i) => int(i.finding_count) },
    { id: "risk", label: t("Annual risk"), align: "end", cell: (i) => money(i.annual_risk, i.currency), compare: (a, b) => a.annual_risk - b.annual_risk },
    { id: "mitigated", label: t("Mitigated"), align: "end", cell: (i) => money(i.mitigated, i.currency), compare: (a, b) => a.mitigated - b.mitigated },
  ];
  return (
    <Block title={t("Where the risk sits")} meta={t("Each kind of loss, priced from the latest run")} testId="val-impact">
      {sorted.length === 0 ? <p className="nx-sub">{t("No finished run has been priced yet.")}</p> : (
        <>
          <HBars label={t("Annual risk by kind of loss")} testId="val-impact-bars"
            bars={sorted.filter((i) => i.annual_risk > 0).map((i) => ({ key: i.category, label: catName(i.category), value: i.annual_risk, text: money(i.annual_risk, i.currency), tone: i.mitigated >= i.annual_risk ? "good" : "bad" }))} />
          <DataTable rows={sorted} columns={cols} rowKey={(i) => i.category} rowLabel={(i) => catName(i.category)} caption={t("Where the risk sits")} />
        </>
      )}
    </Block>
  );
}

function Portfolio() {
  const q = useLift(["value", "impact"], getImpactPortfolio, { impacts: [] as ImpactCategory[], roi: EMPTY.roi });
  const rows = [...(q.data?.impacts ?? [])].sort((a, b) => b.annual_risk - a.annual_risk);
  const cols: Column<ImpactCategory>[] = [
    { id: "loss", label: t("Loss"), cell: (i) => catName(i.category) },
    { id: "risk", label: t("Annual risk"), align: "end", cell: (i) => money(i.annual_risk, i.currency) },
    { id: "mitigated", label: t("Mitigated"), align: "end", cell: (i) => money(i.mitigated, i.currency) },
    { id: "share", label: t("Share mitigated"), align: "end", cell: (i) => (i.annual_risk > 0 ? pct1(i.mitigated / i.annual_risk) : f1(null)) },
    { id: "findings", label: t("Findings"), align: "end", cell: (i) => int(i.finding_count) },
  ];
  return (
    <Block title={t("Impact of the latest run")} meta={t("What each kind of loss costs a year and how much is already mitigated")} testId="val-portfolio">
      <QueryView loading={q.isPending} error={q.isError ? t("The value delivered could not be read.") : null} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("No finished run has been priced yet.")} label={t("Impact of the latest run")}>
        <DataTable rows={rows} columns={cols} rowKey={(i) => i.category} rowLabel={(i) => catName(i.category)} caption={t("Impact of the latest run")} />
      </QueryView>
    </Block>
  );
}

type Month = ValueData["cost_avoidance_history"][number];

function MonthsPanel({ rows, currency }: { rows: Month[]; currency: string }) {
  const asc = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const cols: Column<Month>[] = [
    { id: "month", label: t("Month"), cell: (x) => x.period },
    { id: "sub", label: t("Subscription"), align: "end", cell: (x) => money(x.subscription_cost_zar, currency) },
    { id: "mit", label: t("Risk mitigated"), align: "end", cell: (x) => money(x.risk_mitigated_zar, currency) },
    { id: "roi", label: t("Return to date"), align: "end", cell: (x) => (x.cumulative_roi_multiple == null ? f1(null) : t("{n} times", { n: f1(x.cumulative_roi_multiple) })) },
  ];
  return (
    <Block title={t("Cost avoided month by month")} meta={t("Recorded by the monthly report, newest first")} testId="val-months">
      {asc.length === 0 ? <p className="nx-sub">{t("No month has been recorded yet. The monthly report records one on the first of each month.")}</p> : (
        <>
          <HBars label={t("Risk mitigated over the last {n} months", { n: int(Math.min(12, asc.length)) })} testId="val-months-bars"
            bars={asc.slice(-12).map((x) => ({ key: x.period, label: x.period, value: x.risk_mitigated_zar, text: money(x.risk_mitigated_zar, currency), tone: x.risk_mitigated_zar >= x.subscription_cost_zar ? "good" : "warn" }))} />
          <DataTable rows={[...asc].reverse()} columns={cols} rowKey={(x) => x.period} rowLabel={(x) => x.period} caption={t("Cost avoided month by month")} />
        </>
      )}
    </Block>
  );
}

/** Steps no rule guards first, then the weakest guard, so the exposed step heads the list. */
const exposure = (a: GuardStep, b: GuardStep) =>
  Number(b.guard_count === 0) - Number(a.guard_count === 0) || (a.min_pass_rate ?? 101) - (b.min_pass_rate ?? 101);

/** Rules guarding a KPI or process: every process step behind it, the rules reading its fields and the fields no rule reads. */
function GuardsPanel() {
  const model = useLift(["v2", "lineage", "model"], getLineageModel, null);
  const [pick, setPick] = useState<string | null>(null);
  const node = pick ?? model.data?.kpis[0]?.id ?? null;
  const q = useLift(["v2", "lineage", "guards", node], () => getGuards(node as string), null, node !== null);
  const l1 = (model.data?.processes ?? []).filter((p) => !p.id.includes("-"));
  const steps = [...(q.data?.steps ?? [])].sort(exposure);
  const gaps = q.data?.coverage_gaps.length ?? 0;
  const cols: Column<GuardStep>[] = [
    { id: "step", label: t("Process step"), cell: (s) => (s.l2 ? <Code code={s.l2} text={s.label} /> : s.label) },
    { id: "tcode", label: t("Transaction"), cell: (s) => (s.tcode ? <Code code={s.tcode} /> : f1(null)) },
    { id: "rules", label: t("Rules"), align: "end", cell: (s) => (s.guard_count ? int(s.guard_count) : t("None")) },
    { id: "pass", label: t("Weakest pass rate"), align: "end", cell: (s) => pctOf(s.min_pass_rate) },
    { id: "unguarded", label: t("Fields no rule reads"), cell: (s) => (s.unguarded_fields.length ? <Code code={s.unguarded_fields.join(", ")} /> : t("None")) },
  ];
  const noModel = !!model.data && model.data.kpis.length + l1.length === 0;
  return (
    <Block title={t("Rules guarding each KPI")} meta={t("Every process step behind a KPI or process, with the rules that read its fields")} testId="val-guards">
      <QueryView loading={model.isPending} error={model.isError ? t("The rules guarding this KPI could not be read.") : null} onRetry={() => void model.refetch()} empty={!model.data || noModel} emptyHeading={t("The lineage model maps no KPI or process.")} label={t("Rules guarding each KPI")}>
        <label className="nx-sub">
          {t("KPI or process")}{" "}
          <select className="nx-input" value={node ?? ""} onChange={(e) => setPick(e.target.value)} data-testid="val-guards-node">
            <optgroup label={t("KPIs")}>{(model.data?.kpis ?? []).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</optgroup>
            <optgroup label={t("Processes")}>{l1.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
          </select>
        </label>
        <QueryView loading={q.isPending && node !== null} error={q.isError ? t("The rules guarding this KPI could not be read.") : null} onRetry={() => void q.refetch()} empty={steps.length === 0} emptyHeading={t("The lineage model puts no process step behind this KPI.")} label={t("Rules guarding each KPI")}>
          <p className="nx-sub" data-testid="val-guards-sum">
            {gaps
              ? t("{gaps, plural, one {# step has} other {# steps have}} no rule guarding {n, plural, one {it} other {them}}, of {total}.", { gaps, n: gaps, total: steps.length })
              : t("Every one of the {n, plural, one {# step} other {# steps}} has a rule guarding it.", { n: steps.length })}
          </p>
          <DataTable rows={steps} columns={cols} rowKey={(s) => s.id} rowLabel={(s) => s.label} caption={t("Rules guarding each KPI")} />
        </QueryView>
      </QueryView>
    </Block>
  );
}

const SEVERITY: Record<string, () => string> = { low: () => t("Low"), medium: () => t("Medium"), high: () => t("High"), critical: () => t("Critical") };
const KIND: Record<string, () => string> = { full_block: () => t("Blocks the feature"), degraded: () => t("Degrades the feature"), cosmetic: () => t("Cosmetic") };

type Reach = { g: string; x: ImpactRow };

/** What the latest run's failing checks reach: the KPIs, processes and S/4HANA features behind them. */
function RunImpactPanel({ currency }: { currency: string }) {
  const runs = useRunList();
  const vid = runs.data?.versions[0]?.id ?? null;
  const q = useLift(["v2", "lineage", "impact", vid], () => getImpact(vid as string), null, vid !== null);
  const d = q.data;
  const rows: Reach[] = d ? ([[t("KPIs"), d.kpis], [t("Processes"), d.processes], [t("S/4HANA features"), d.features]] as [string, ImpactRow[]][]).flatMap(([g, r]) => r.map((x) => ({ g, x }))) : [];
  const cols: Column<Reach>[] = [
    { id: "reach", label: t("Reaches"), cell: (r) => r.x.label },
    { id: "kind", label: t("Kind"), cell: (r) => <span className="nx-cell-stack">{r.g}{r.x.worst_impact ? <span className="nx-sub">{KIND[r.x.worst_impact]?.() ?? r.x.worst_impact}</span> : null}</span> },
    { id: "findings", label: t("Findings"), align: "end", cell: (r) => int(r.x.findings) },
    { id: "records", label: t("Records affected"), align: "end", cell: (r) => int(r.x.records_affected), compare: (a, b) => a.x.records_affected - b.x.records_affected },
    { id: "sev", label: t("Worst severity"), cell: (r) => (r.x.worst_severity ? (SEVERITY[r.x.worst_severity]?.() ?? r.x.worst_severity) : f1(null)) },
    { id: "cost", label: t("Cost at risk"), align: "end", cell: (r) => (d?.cost_available && r.x.cost_at_risk != null ? money(r.x.cost_at_risk, currency) : f1(null)) },
  ];
  const loading = runs.isPending || (vid !== null && q.isPending);
  const err = runs.isError || q.isError ? t("The value delivered could not be read.") : null;
  return (
    <Block title={t("What the latest run puts at risk")} meta={t("The KPIs, processes and S/4HANA features behind the failing rules")} testId="val-run-impact">
      <QueryView loading={loading} error={err} onRetry={() => void (runs.isError ? runs.refetch() : q.refetch())} empty={rows.length === 0}
        emptyHeading={d ? t("No failing rule reaches a KPI, process or feature in this run.") : t("No finished run has been priced yet.")} label={t("What the latest run puts at risk")}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.x.id} rowLabel={(r) => r.x.label} caption={t("What the latest run puts at risk")} />
        {d?.unmapped_checks.length ? (
          <p className="nx-sub" data-testid="val-run-impact-unmapped">
            {t("{n, plural, one {# failing rule is} other {# failing rules are}} not placed behind any KPI by the lineage model:", { n: d.unmapped_checks.length })} <Code code={d.unmapped_checks.join(", ")} />
          </p>
        ) : null}
      </QueryView>
    </Block>
  );
}

/** Value at risk per object, run by run, from the run timeline. An object no run priced is left out. */
function RibbonPanel() {
  const tl = useTimeline(null, 8);
  const rows = tl.data ? valueRibbons(tl.data) : [];
  const cols: Column<Ribbon>[] = [
    { id: "object", label: t("Object"), cell: (r) => formatModuleName(r.object) },
    {
      id: "series", label: t("Over the last runs"), cell: (r) => (
        <Sparkline points={r.series.map((v) => v ?? 0)} label={t("Value at risk of {object} over the last runs", { object: formatModuleName(r.object) })} />
      ),
    },
    { id: "latest", label: t("Latest run"), align: "end", cell: (r) => (r.latest == null ? f1(null) : money(r.latest, r.currency)), compare: (a, b) => (a.latest ?? 0) - (b.latest ?? 0) },
  ];
  return (
    <Block title={t("Value at risk by object")} meta={t("Priced failing records per object, over the last runs")} testId="val-ribbon">
      <QueryView loading={tl.isPending} error={tl.isError ? t("The value delivered could not be read.") : null} onRetry={() => void tl.refetch()} empty={rows.length === 0}
        emptyHeading={t("No run has priced the failing records of an object yet. The cost model prices them when it is set.")} label={t("Value at risk by object")}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.object} rowLabel={(r) => formatModuleName(r.object)} caption={t("Value at risk by object")} />
      </QueryView>
    </Block>
  );
}

"use client";

import type { ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getCauseClusters, getCleansing, getExec, getImpact, getOverview, getOwners, getProvenCost, getTrends,
  type CauseCluster, type Cleansing, type ImpactRow, type InsightExec, type InsightOverview, type OwnerRow, type ProvenCost, type ProvenCostRow, type TrendRun,
} from "@/lib/api/v2/insights";
import { getEngineDrivers, type EngineDrivers, type EngineOffReason } from "@/lib/api/v2/aletheia-engine";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";
import { describeField } from "@/lib/v2/sap-fields";
import { f1, int, pct1 } from "@/lib/v2/score";
import { useRuleList } from "@/lib/v2/sys-queries";
import { Code, DataTable, EmptyState, ErrorState, Skeleton, Sparkline, type Column } from "../kit";
import { SevChip } from "../object/tabs/tabs-g-parts";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";

/**
 * Cost and causes: what bad data costs per business area, which SAP features it puts at risk, and which fields the
 * failing rules share (api/routes/insights.py), with the executive read, the cleansing pipeline and what the
 * Aletheia engine learned from the run trend. Money is shown per business area only, never added across areas.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
const dash = f1(null);
const pctOf = (n: number | null | undefined) => (n == null ? pct1(null) : pct1(n / 100));

const L1: Record<string, () => string> = {
  hire_to_retire: () => t("Hire to retire"),
  master_data: () => t("Master data"),
  order_to_cash: () => t("Order to cash"),
  plan_to_produce: () => t("Plan to produce"),
  procure_to_pay: () => t("Procure to pay"),
  record_to_report: () => t("Record to report"),
  unassigned: () => t("No business area"),
};
const area = (k: string | null) => L1[k ?? "unassigned"]?.() ?? k ?? dash;

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

const ENGINE_OFF: Record<EngineOffReason, () => string> = {
  too_few_runs: () => t("Three scored runs are needed before the engine can learn from the trend."),
  not_configured: () => t("This deployment runs without its Aletheia engine. An administrator can set it up."),
  unreachable: () => t("The Aletheia engine does not answer. The rest of this page is not affected."),
  no_token: () => t("The Aletheia engine has no access token, so it cannot learn from the trend yet."),
  licence_invalid: () => t("The Aletheia engine licence is not valid, so the engine is not used."),
  engine_error: () => t("The Aletheia engine could not learn from the trend this time."),
};

/** A 404 means no run has been scored yet: the panel shows it as empty, not as an error. */
function useInsight<T>(key: string, fn: () => Promise<T>, empty: T) {
  const fixture = useFixture();
  return useQuery({
    queryKey: ["insights", key, fixture],
    queryFn: async () => {
      try {
        return await fn();
      } catch (e) {
        if (status(e) === 404) return empty;
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
}

/** Same read as the v2 executive panels, under their own query keys. */
function useRead<T>(key: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["extra", key, fixture], queryFn: fn, staleTime: 60_000, retry });
}

function Part<T>({ q, label, children }: { q: UseQueryResult<T, unknown>; label: string; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Skeleton lines={4} label={label} />;
  if (q.isError) {
    return status(q.error) === 403
      ? <EmptyState heading={t("Your role cannot read what bad data costs.")} />
      : <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
  }
  return <>{children(q.data)}</>;
}

/** The rule name beside a check id, from the rule library ("CHECK_ID: text"). */
function useRuleName() {
  const rules = useRuleList();
  const names = new Map((rules.data?.rules ?? []).map((r) => {
    const i = r.name.indexOf(":");
    return i > 0 ? [r.name.slice(0, i), r.name.slice(i + 1).trim()] : [r.name, r.name];
  }));
  return function ruleCode(id: string) { return <Code code={id} text={names.get(id)} />; };
}

function RuleList({ ids, rule }: { ids: string[]; rule: (id: string) => ReactNode }) {
  if (ids.length === 0) return <>{dash}</>;
  return <ul className="nx-wrap">{ids.map((id) => <li key={id}>{rule(id)}</li>)}</ul>;
}

/** blocking_findings carry check ids, or objects with a check_id. */
const ruleIds = (items: unknown[]) =>
  items.map((x) => (typeof x === "string" ? x : (x as { check_id?: string } | null)?.check_id)).filter((x): x is string => !!x);

const costText = (r: ProvenCostRow) =>
  r.currency ? money(r.amount, r.currency) : Object.entries(r.by_currency ?? {}).map(([c, n]) => money(n, c)).join(", ") || dash;

export function Insights() {
  const cost = useInsight<ProvenCost>("proven-cost", getProvenCost, { currency: null, rows: [], cost_by_l1: [], value_at_risk_by_l1: [] });
  const impact = useInsight<{ rows: ImpactRow[] }>("impact", getImpact, { rows: [] });
  const causes = useInsight<{ clusters: CauseCluster[] }>("root-causes", getCauseClusters, { clusters: [] });
  const title = t("Cost and causes");

  if (cost.isPending) return <Skeleton lines={8} label={title} />;
  if (cost.isError) {
    return status(cost.error) === 403
      ? <EmptyState heading={t("Your role cannot read what bad data costs.")} />
      : <ErrorState sentence={t("What bad data costs could not be read.")} onRetry={() => void cost.refetch()} />;
  }
  const c = cost.data;
  const cur = c.currency;
  const risk = [...c.value_at_risk_by_l1].sort((a, b) => b.value_at_risk - a.value_at_risk);
  const lost = [...c.cost_by_l1].sort((a, b) => b.amount - a.amount);
  const areas = [...new Set([...risk.map((r) => r.l1), ...lost.map((r) => r.l1)])];
  const top = risk[0];
  const areaCols: Column<string>[] = [
    { id: "area", label: t("Business area"), cell: (k) => area(k) },
    { id: "cost", label: t("Proven cost"), align: "end", cell: (k) => { const p = lost.find((r) => r.l1 === k); return p && cur ? money(p.amount, cur) : dash; } },
    { id: "risk", label: t("Value at risk"), align: "end", cell: (k) => { const v = risk.find((r) => r.l1 === k); return v && cur ? money(v.value_at_risk, cur) : dash; } },
  ];

  return (
    <div className="nx-body" data-testid="ins-page">
      <Banner
        title={top && top.value_at_risk > 0 ? t("{area} carries the most value at risk", { area: area(top.l1) }) : t("No priced SAP feature is at risk")}
        why={t("Value at risk is what the SAP features blocked or degraded by failing rules are worth. Proven cost is money already lost in posted documents. Each is shown per business area and never added across areas.")}
        meta={title}
        label={title}
        testId="ins-banner"
        figs={[
          { label: t("Largest value at risk"), value: top ? moneyCompactText(top.value_at_risk, cur) : dash, note: top ? area(top.l1) : undefined },
          { label: t("Largest proven cost"), value: lost[0] ? moneyCompactText(lost[0].amount, cur) : dash, note: lost[0] ? area(lost[0].l1) : undefined },
          { label: t("SAP features at risk"), value: impact.data ? int(impact.data.rows.length) : dash },
          { label: t("Root causes"), value: causes.data ? int(causes.data.clusters.length) : dash },
        ]}
      />
      <Panel title={t("By business area")} meta={cur ? t("In {currency}", { currency: cur }) : undefined} testId="ins-areas">
        {areas.length === 0 ? <EmptyState heading={t("No cost or value at risk has been measured yet.")} /> : (
          <DataTable caption={t("By business area")} rows={areas} rowKey={(k) => k} rowLabel={(k) => area(k)} columns={areaCols} />
        )}
      </Panel>
      <ImpactPanel q={impact} cur={cur} />
      <CausesPanel q={causes} />
      <Fold title={t("Money already lost")} hint={t("Proven cost in posted documents, by business area.")}>
        <ProvenCostPanel rows={c.rows} />
      </Fold>
      <Fold title={t("Trend over time")} hint={t("How the cost and the causes moved run by run.")}>
        <TrendPanel />
      </Fold>
      <Fold title={t("Executive read")} hint={t("Headline, loss by business area and owners")}>
        <ExecRead />
      </Fold>
      <Fold title={t("Cleansing pipeline")} hint={t("From failing records to fixes applied")}>
        <CleansingPipeline />
      </Fold>
      <Fold title={t("What moves the score")} hint={t("Normal ranges and lead and lag links the Aletheia engine learned from the run trend.")}>
        <DriversPanel />
      </Fold>
      <About
        shows={t("Shows where failing rules put money at risk, what has already been lost in posted documents, and the fields behind the failures.")}
        why={t("This screen only reads. Open a cause to see the records behind it.")}
        means={[
          [t("Largest value at risk"), t("The business area with the most money at risk from failing rules.")],
          [t("Largest proven cost"), t("The business area with the most money already lost in posted documents.")],
          [t("Root causes"), t("Failing rules grouped by the field they fail on.")],
        ]}
        next={{ href: "/value", label: t("Open value delivered") }}
      />
    </div>
  );
}

function ProvenCostPanel({ rows }: { rows: ProvenCostRow[] }) {
  const rule = useRuleName();
  const title = t("Money already lost");
  const cols: Column<ProvenCostRow>[] = [
    { id: "cost", label: t("Cost"), cell: (r) => METRIC[r.metric]?.() ?? r.label },
    { id: "area", label: t("Business area"), cell: (r) => area(r.l1) },
    { id: "amount", label: t("Amount"), align: "end", cell: costText },
    { id: "docs", label: t("Documents"), align: "end", cell: (r) => (r.documents == null ? dash : int(r.documents)) },
    { id: "rules", label: t("Rules"), cell: (r) => <RuleList ids={r.check_ids} rule={rule} /> },
  ];
  return (
    <Panel title={title} meta={t("Measured in posted documents and traced to the rules behind them")} testId="ins-proven">
      {rows.length === 0 ? <EmptyState heading={t("No posted document shows a cost from bad data yet.")} /> : (
        <DataTable caption={title} rows={rows} rowKey={(r) => r.metric} rowLabel={(r) => METRIC[r.metric]?.() ?? r.label} columns={cols} />
      )}
    </Panel>
  );
}

function ImpactPanel({ q, cur }: { q: UseQueryResult<{ rows: ImpactRow[] }, unknown>; cur: string | null }) {
  const rule = useRuleName();
  const title = t("SAP features at risk");
  const m = (n: number) => (cur ? money(n, cur) : int(n));
  const cols: Column<ImpactRow>[] = [
    { id: "feature", label: t("Feature"), cell: (r) => r.feature },
    { id: "area", label: t("Business area"), cell: (r) => area(r.l1) },
    { id: "status", label: t("Status"), cell: (r) => FEATURE_STATUS[r.status]?.() ?? r.status },
    { id: "records", label: t("Records"), align: "end", cell: (r) => int(r.record_count), compare: (a, b) => a.record_count - b.record_count },
    { id: "per", label: t("Value a record"), align: "end", cell: (r) => m(r.value_per_record) },
    { id: "risk", label: t("Value at risk"), align: "end", cell: (r) => m(r.value_at_risk), compare: (a, b) => a.value_at_risk - b.value_at_risk },
    { id: "rules", label: t("Rules"), cell: (r) => <RuleList ids={ruleIds(r.causing_rules)} rule={rule} /> },
  ];
  return (
    <Panel title={title} meta={t("Features the failing rules block or degrade, worth the records they touch")} testId="ins-impact">
      <Part q={q} label={title}>
        {(d) => d.rows.length === 0 ? <EmptyState heading={t("No priced SAP feature is blocked or degraded.")} /> : (
          <DataTable caption={title} rows={[...d.rows].sort((a, b) => b.value_at_risk - a.value_at_risk)} rowKey={(r) => r.feature} rowLabel={(r) => r.feature} columns={cols} />
        )}
      </Part>
    </Panel>
  );
}

function CausesPanel({ q }: { q: UseQueryResult<{ clusters: CauseCluster[] }, unknown> }) {
  const rule = useRuleName();
  const title = t("Root causes");
  const fieldOf = (k: CauseCluster) => (k.kind === "field" && k.table && k.field ? `${k.table}-${k.field}` : null);
  const cols: Column<CauseCluster>[] = [
    {
      id: "field", label: t("Field"), cell: (k) => {
        const f = fieldOf(k);
        return <>{f ? <Code code={f} text={describeField(f) ?? undefined} /> : t("No single field")} <span className="nx-sub">{formatModuleName(k.module)}</span></>;
      },
    },
    { id: "rules", label: t("Rules"), cell: (k) => <RuleList ids={k.rules} rule={rule} /> },
    { id: "sev", label: t("Severity"), cell: (k) => <SevChip severity={k.severity} /> },
    { id: "records", label: t("Records"), align: "end", cell: (k) => (k.records_estimated ? t("about {n}", { n: int(k.records) }) : int(k.records)), compare: (a, b) => a.records - b.records },
    { id: "auto", label: t("Fixable automatically"), align: "end", cell: (k) => pctOf(k.auto_fix_pct) },
    { id: "origin", label: t("Where it comes from"), cell: (k) => (k.origin?.status === "computed" && k.origin.top ? <>{k.origin.top} <span className="nx-sub">{pct1(k.origin.share)}</span></> : dash) },
  ];
  return (
    <Panel title={title} meta={t("Failing rules grouped by the field they fail on, worst first")} testId="ins-causes">
      <Part q={q} label={title}>
        {(d) => d.clusters.length === 0 ? <EmptyState heading={t("No failing rule to group yet.")} /> : (
          <DataTable caption={title} rows={d.clusters} rowKey={(k) => k.key} rowLabel={(k) => fieldOf(k) ?? t("No single field")} columns={cols} />
        )}
      </Part>
    </Panel>
  );
}

const runDay = (r: TrendRun) => (r.run_at ? formatDate(r.run_at, "date") : (r.label ?? r.version_id));

function TrendPanel() {
  const q = useInsight<{ runs: TrendRun[] }>("trends", getTrends, { runs: [] });
  const title = t("Score run by run");
  const cols: Column<TrendRun>[] = [
    { id: "run", label: t("Run"), cell: runDay },
    { id: "score", label: t("Score"), align: "end", cell: (r) => f1(r.composite) },
    { id: "change", label: t("Change"), align: "end", cell: (r) => f1(r.change) },
    { id: "fixed", label: t("Rules fixed"), align: "end", cell: (r) => (r.rules_fixed == null ? dash : int(r.rules_fixed)) },
    { id: "new", label: t("Rules newly failing"), align: "end", cell: (r) => (r.rules_new == null ? dash : int(r.rules_new)) },
  ];
  if (q.isPending) return <Skeleton lines={4} label={title} />;
  if (q.isError) return <ErrorState sentence={t("The score history could not be read.")} onRetry={() => void q.refetch()} />;
  const runs = q.data.runs;
  const pts = runs.map((r) => r.composite).filter((v): v is number => v != null);
  return (
    <Panel title={title} meta={t("The last {n} runs, with the rules each one fixed and found", { n: int(runs.length) })} testId="ins-trend">
      {pts.length < 2 ? <EmptyState heading={t("Two scored runs are needed to draw a trend.")} /> : (
        <>
          <Sparkline points={pts} label={title} />
          <DataTable caption={title} rows={runs} rowKey={(r) => r.version_id} rowLabel={runDay} columns={cols} />
        </>
      )}
    </Panel>
  );
}

function ExecRead() {
  const overview = useRead<InsightOverview>("overview", getOverview);
  const exec = useRead<InsightExec>("exec", getExec);
  const owners = useRead<{ owners: OwnerRow[] }>("owners", getOwners);
  type M = { key: string; label: string; value: ReactNode; before: string };
  const mCols: Column<M>[] = [
    { id: "m", label: t("Measure"), cell: (r) => r.label },
    { id: "v", label: t("Value"), align: "end", cell: (r) => r.value },
    { id: "b", label: t("Before"), align: "end", cell: (r) => r.before },
  ];
  const oCols: Column<OwnerRow>[] = [
    { id: "owner", label: t("Owner"), cell: (o) => o.owner },
    { id: "score", label: t("Score"), align: "end", cell: (o) => f1(o.score) },
    { id: "delta", label: t("Change"), align: "end", cell: (o) => f1(o.delta) },
    { id: "open", label: t("Open items"), align: "end", cell: (o) => int(Object.values(o.open_by_severity).reduce((a, b) => a + b, 0)) },
    { id: "fixed", label: t("Fixed"), align: "end", cell: (o) => (o.fixed_since_baseline == null ? dash : int(o.fixed_since_baseline)) },
    { id: "age", label: t("Oldest item"), align: "end", cell: (o) => (o.oldest_item_age_days == null ? dash : t("{n} days", { n: int(o.oldest_item_age_days) })) },
    { id: "digest", label: t("Digest"), cell: (o) => <>{o.schedule ?? dash} <span className="nx-sub">{o.last_sent ? t("Last sent {day}", { day: formatDate(o.last_sent, "date") }) : t("Not sent yet")}</span></> },
  ];
  return (
    <>
      <Panel title={t("Executive read")} meta={t("The headline of the latest run")} testId="ins-exec">
        <Part q={overview} label={t("Executive read")}>
          {(o) => {
            if (!o.dqs) return <EmptyState heading={t("No finished run has been read yet.")} />;
            const rows: M[] = [{ key: "dqs", label: t("Data quality score"), value: <>{f1(o.dqs.composite)}{o.dqs.tier ? <span className="nx-sub"> {labelOf(o.dqs.tier)}</span> : null}</>, before: f1(o.dqs.previous) }];
            if (o.blockers) rows.push({ key: "blockers", label: t("Migration blockers"), value: int(o.blockers.count), before: o.blockers.previous == null ? dash : int(o.blockers.previous) });
            if (o.auto_fixable) rows.push({ key: "auto", label: t("Records with a suggested fix"), value: `${int(o.auto_fixable.records)} / ${int(o.auto_fixable.failing_records)}`, before: dash });
            const v = o.value_at_risk;
            return (
              <>
                <DataTable caption={t("Executive read")} rows={rows} rowKey={(r) => r.key} rowLabel={(r) => r.label} columns={mCols} />
                {o.dqs.capped && o.dqs.cap_reason ? <p className="nx-sub">{t("The score is capped: {reason}", { reason: o.dqs.cap_reason })}</p> : null}
                {v?.worst_l1 && v.worst_l1_amount != null && v.currency ? <p>{t("Largest value at risk")}: {area(v.worst_l1)} {money(v.worst_l1_amount, v.currency)}</p> : null}
                {o.narrative ? <p>{o.narrative}</p> : null}
              </>
            );
          }}
        </Part>
      </Panel>
      <Panel title={t("Where the score loses points")} meta={t("Points lost per business area")} testId="ins-exec-waterfall">
        <Part q={exec} label={t("Where the score loses points")}>
          {(e) => {
            if (e.waterfall.length === 0) return <EmptyState heading={t("No score has been broken down yet.")} />;
            const max = Math.max(...e.waterfall.map((w) => Math.abs(w.y)), 1);
            return (
              <>
                <HBars label={t("Points lost per business area")} rows={e.waterfall.map((w) => ({ key: w.x, label: w.l1 ? area(w.l1) : w.x, value: (Math.abs(w.y) / max) * 100, text: f1(w.y), tone: "warn" as const }))} />
                {e.narrative ? <p>{e.narrative}</p> : null}
              </>
            );
          }}
        </Part>
      </Panel>
      <Panel title={t("Owners")} meta={t("Each owner's score and the digest they get")} testId="ins-owners">
        <Part q={owners} label={t("Owners")}>
          {(d) => d.owners.length === 0 ? <EmptyState heading={t("No owner has been named for a failing rule yet.")} /> : (
            <DataTable caption={t("Owners")} rows={d.owners} rowKey={(o) => o.owner} rowLabel={(o) => o.owner} columns={oCols} />
          )}
        </Part>
      </Panel>
    </>
  );
}

function CleansingPipeline() {
  const q = useRead<Cleansing>("cleansing", getCleansing);
  const rule = useRuleName();
  type Mod = Cleansing["by_module"][number];
  type Rule = Cleansing["by_rule"][number];
  const modCols: Column<Mod>[] = [
    { id: "module", label: t("Object"), cell: (m) => formatModuleName(m.module) },
    { id: "failing", label: t("Failing"), align: "end", cell: (m) => int(m.failing) },
    { id: "proposed", label: t("Fix proposed"), align: "end", cell: (m) => int(m.proposed) },
    { id: "high", label: t("High confidence"), align: "end", cell: (m) => int(m.high) },
  ];
  const ruleCols: Column<Rule>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => rule(r.check_id) },
    { id: "proposed", label: t("Fix proposed"), align: "end", cell: (r) => int(r.proposed) },
    { id: "high", label: t("High confidence"), align: "end", cell: (r) => int(r.high) },
    { id: "auto", label: t("Automatic"), align: "end", cell: (r) => int(r.auto) },
  ];
  return (
    <Panel title={t("Cleansing pipeline")} meta={t("From failing records to fixes applied")} testId="ins-cleansing">
      <Part q={q} label={t("Cleansing pipeline")}>
        {(d) => {
          if (d.steps.length === 0) return <EmptyState heading={t("No cleansing has started, because no run has failing records.")} />;
          const max = Math.max(...d.steps.map((s) => s.records), 1);
          return (
            <>
              <HBars label={t("Records at each step")} rows={d.steps.map((s) => ({ key: s.key, label: s.label, value: (s.records / max) * 100, text: int(s.records), tone: s.key === "applied" ? "good" as const : "warn" as const }))} />
              {d.by_module.length > 0 ? <DataTable caption={t("Cleansing by object")} rows={d.by_module} rowKey={(m) => m.module} rowLabel={(m) => formatModuleName(m.module)} columns={modCols} /> : null}
              {d.by_rule.length > 0 ? <DataTable caption={t("Cleansing by rule")} rows={d.by_rule} rowKey={(r) => r.check_id} rowLabel={(r) => r.check_id} columns={ruleCols} /> : null}
            </>
          );
        }}
      </Part>
    </Panel>
  );
}

/** The engine learns only from run-level scores and counts; it never sees a record. */
function DriversPanel() {
  const q = useInsight<EngineDrivers>("engine-drivers", getEngineDrivers, { labels: {}, available: false, reason: "too_few_runs" });
  const title = t("What moves the score");
  type R = NonNullable<EngineDrivers["ranges"]>[number];
  type L = NonNullable<EngineDrivers["links"]>[number];
  const name = (d: EngineDrivers, m: string) => <Code code={m} text={m.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(m.slice(10)) }) : d.labels[m]} />;
  return (
    <Panel title={title} meta={t("Learned by the Aletheia engine from the last {n} runs", { n: int(q.data?.runs ?? 0) })} testId="ins-drivers">
      <Part q={q} label={title}>
        {(d) => {
          if (!d.available) return <EmptyState heading={ENGINE_OFF[d.reason ?? "engine_error"]?.() ?? ENGINE_OFF.engine_error()} />;
          const rCols: Column<R>[] = [
            { id: "m", label: t("Measure"), cell: (r) => name(d, r.metric) },
            { id: "range", label: t("Normal range"), align: "end", cell: (r) => t("{low} to {high}", { low: f1(r.low), high: f1(r.high) }) },
            { id: "latest", label: t("Latest run"), align: "end", cell: (r) => f1(r.latest) },
            { id: "verdict", label: t("Verdict"), cell: (r) => (r.outside ? t("Outside the normal range") : t("Within the normal range")) },
          ];
          const lCols: Column<L>[] = [
            { id: "src", label: t("Measure"), cell: (e) => name(d, e.source) },
            { id: "tgt", label: t("Moves"), cell: (e) => name(d, e.target) },
            { id: "lag", label: t("Runs later"), align: "end", cell: (e) => (e.lag == null ? dash : int(e.lag)) },
            { id: "corr", label: t("Correlation"), align: "end", cell: (e) => (e.correlation == null ? dash : e.correlation.toFixed(2)) },
          ];
          const links = d.links ?? [];
          return (
            <>
              <DataTable caption={t("Normal range per measure")} rows={d.ranges ?? []} rowKey={(r) => r.metric} rowLabel={(r) => d.labels[r.metric] ?? r.metric} columns={rCols} />
              {links.length === 0 ? <EmptyState heading={t("The engine found no measure that leads another.")} /> : (
                <DataTable caption={t("Measures that move together")} rows={links} rowKey={(e) => `${e.source}-${e.target}-${e.lag}`} rowLabel={(e) => d.labels[e.source] ?? e.source} columns={lCols} />
              )}
            </>
          );
        }}
      </Part>
    </Panel>
  );
}

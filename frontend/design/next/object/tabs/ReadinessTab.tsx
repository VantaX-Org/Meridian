"use client";

import "./tabs-g.css";
import Link from "next/link";
import { useMemo } from "react";
import { formatDate, formatMoney } from "@/lib/format";
import type { CellVerdict, ImpactResult, ReadinessCell } from "@/lib/api/v2/object";
import type { Money, MoneyFeature } from "@/lib/api/v2/step9";
import type { Receipt, Verdict } from "@/lib/api/v2/types";
import { useOpenItem } from "@/lib/v2/hooks";
import { useConfigImpact, useReadiness } from "@/lib/v2/object-queries";
import { useObjectRules, useReceipt } from "@/lib/v2/queries";
import { useMoney } from "@/lib/v2/step9-queries";
import { objectHref } from "@/lib/v2/people";
import { f1, int } from "@/lib/v2/score";
import { t, tn } from "@/lib/v2/i18n";
import { DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../../kit";
import { SegBar } from "../../kit/viz";
import type { ObjectRun } from "../useObjectRun";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, ItemLink, RuleLink, ScoreBar, VerdictChip } from "./tabs-g-parts";

const VERDICT: Record<CellVerdict, Verdict> = { go: "go", at_risk: "at-risk", no_go: "no-go" };

/** The rule ids of this object behind one feature, in the order the impact model lists them. */
function rulesOf(result: ImpactResult, module: string): string[] {
  const seen = new Set<string>();
  for (const f of result.blocking_findings) if (!f.module || f.module === module) seen.add(f.check_id);
  return [...seen];
}

/** States what caps the score in words, with the capping rules as links. */
function CapStatement({ receipt }: { receipt: Receipt }) {
  const { hrefFor } = useOpenItem();
  const link = (id: string) => (
    <Link key={id} href={hrefFor({ kind: "rule", id })} className="nx-link nx-mono">
      {id}
    </Link>
  );
  const ids = receipt.breaches.map((b) => b.check_id);
  const n = ids.length;
  return (
    <p className="nx-tg-finding" data-testid="cap-statement">
      {!receipt.capped || n === 0
        ? t("No critical rule is holding this score down, so readiness follows the measured score of {measured}.", { measured: f1(receipt.measured) })
        : n === 1
          ? tn("Held at {cap} because one critical rule fails: {rule}. Measured {measured}, shown {score}.", { cap: receipt.cap_level, rule: link(ids[0]), measured: f1(receipt.measured), score: f1(receipt.score) })
          : n === 2
            ? tn("Held at {cap} because two critical rules fail: {rule} and {rule2}. Measured {measured}, shown {score}.", { cap: receipt.cap_level, rule: link(ids[0]), rule2: link(ids[1]), measured: f1(receipt.measured), score: f1(receipt.score) })
            : tn("Held at {cap} because {n} critical rules fail, including {rule} and {rule2}. Measured {measured}, shown {score}.", { cap: receipt.cap_level, n, rule: link(ids[0]), rule2: link(ids[1]), measured: f1(receipt.measured), score: f1(receipt.score) })}{" "}
      {t("Cap rule: {cap_rule}.", { cap_rule: receipt.cap_rule })}
    </p>
  );
}

function FeatureList({ title, results, module, empty, names }: { title: string; results: ImpactResult[]; module: string; empty: string; names: Map<string, string> }) {
  return (
    <div className="nx-tg-l2">
      <h3>
        <span>{title}</span>
        <span className="nx-tg-sub">{results.length}</span>
      </h3>
      {results.length === 0 ? (
        <p className="nx-tg-prov">{empty}</p>
      ) : (
        <ul className="nx-tg-list">
          {results.map((r) => (
            <li key={r.feature}>
              <ItemLink kind="feature" id={r.feature} />
              {rulesOf(r, module).map((id) => (
                <RuleLink key={id} id={id} name={names.get(id)} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ObjRow = { module: string; label: string; verdict: Verdict; blockers: number; score: number | null };

/** Every object in this object's waves with its score, verdict and open blocking gaps. */
function ByObject({ o, waves }: { o: ObjectRun; waves: Set<string> }) {
  const landscape = o.landscape.data;
  const readiness = useReadiness().data;
  const rows = useMemo<ObjRow[]>(() => {
    if (!landscape) return [];
    const cells = readiness?.cells.filter((c) => waves.has(c.wave)) ?? [];
    return [...new Map(cells.map((c) => [c.module, c])).values()]
      .sort((a, b) => b.blocker_count - a.blocker_count)
      .map((c) => ({
        module: c.module,
        label: landscape.objects.find((x) => x.module === c.module)?.label ?? c.module.replace(/_/g, " "),
        verdict: VERDICT[c.verdict],
        blockers: c.blocker_count,
        score: landscape.cells.find((x) => x.module === c.module)?.score ?? null,
      }));
  }, [landscape, readiness, waves]);
  if (rows.length < 2 || !landscape) return null;
  const columns: Column<ObjRow>[] = [
    {
      id: "object", label: t("Object"), compare: (a, b) => a.label.localeCompare(b.label),
      cell: (r) => (
        <Link href={objectHref(landscape, r.module)} className="nx-link" aria-current={r.module === o.module ? "true" : undefined}>
          {r.label}
        </Link>
      ),
    },
    { id: "score", label: t("Score"), compare: (a, b) => (a.score ?? -1) - (b.score ?? -1), cell: (r) => <ScoreBar value={r.score} label={r.label} /> },
    { id: "verdict", label: t("Verdict"), cell: (r) => <VerdictChip verdict={r.verdict} /> },
    { id: "blockers", label: t("Blocking gaps"), align: "end", compare: (a, b) => a.blockers - b.blockers, cell: (r) => int(r.blockers) },
  ];
  return (
    <section aria-label={t("Readiness by object")} className="nx-card nx-tg-sec" data-testid="readiness-by-object">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Readiness by object")}</h2>
      </div>
      <ExportTable><DataTable rows={rows} columns={columns} rowKey={(r) => r.module} rowLabel={(r) => r.label} caption={t("Readiness by object")} density="compact" /></ExportTable>
    </section>
  );
}

type BlockerRow = { id: string; count: number; severity?: string; features: string[] };

/** The rules of this object behind blocked or degraded features, worst first, with the features each one holds back. */
function Blockers({ results, module, names }: { results: ImpactResult[]; module: string; names: Map<string, string> }) {
  const rows = useMemo<BlockerRow[]>(() => {
    const by = new Map<string, BlockerRow>();
    for (const r of results) {
      for (const f of r.blocking_findings) {
        if (f.module && f.module !== module) continue;
        const e = by.get(f.check_id) ?? { id: f.check_id, count: f.affected_count ?? 0, severity: f.severity, features: [] };
        e.features.push(r.feature);
        by.set(f.check_id, e);
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count);
  }, [results, module]);
  if (!rows.length) return null;
  const columns: Column<BlockerRow>[] = [
    { id: "rule", label: t("Rule"), compare: (a, b) => a.id.localeCompare(b.id), cell: (r) => <RuleLink id={r.id} name={names.get(r.id)} severity={r.severity} /> },
    { id: "features", label: t("Features"), cell: (r) => r.features.join(", ") },
    { id: "count", label: t("Failing rows"), align: "end", compare: (a, b) => a.count - b.count, cell: (r) => int(r.count) },
  ];
  return (
    <div className="nx-tg-l2" data-testid="readiness-blockers">
      <h3>
        <span>{t("Blockers")}</span>
        <span className="nx-tg-sub">{rows.length}</span>
      </h3>
      <ExportTable><DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => r.id} caption={t("Blockers")} density="compact" /></ExportTable>
    </div>
  );
}

function Amount({ value, currency }: { value: number | null; currency: string | null }) {
  if (value == null) return <Dash why={t("No price for this in the cost model")} />;
  return <>{formatMoney(value, currency ?? undefined)}</>;
}

function Since({ f }: { f: MoneyFeature }) {
  if (!f.first_blocked_at) return <Dash why={f.status === "degraded" ? t("Degraded, not blocked") : t("Not blocked")} />;
  return <>{t("{date}, {months, plural, one {# month} other {# months}}", { date: formatDate(f.first_blocked_at, "date"), months: f.months_blocked })}</>;
}

function MoneyLine({ m }: { m: Money }) {
  if (!m.cost_model) return <p className="nx-tg-prov" data-testid="money-line">{t("No cost model is set for this tenant, so features are listed without a price. An administrator sets one in Settings.")}</p>;
  return (
    <p className="nx-tg-finding" data-testid="money-line">
      {t("{monthly} a month in opportunity cost from {blocked} blocked {blocked, plural, one {feature} other {features}}; {since} since each was first blocked.", { monthly: formatMoney(m.totals.opportunity_cost_per_month ?? 0, m.currency ?? undefined), blocked: m.totals.features_blocked, since: formatMoney(m.totals.cumulative_cost ?? 0, m.currency ?? undefined) })}
    </p>
  );
}

/** What the features this object blocks cost a month and since each was first blocked. */
function ObjectMoney({ module, label }: { module: string; label: string }) {
  const q = useMoney("object", module);
  const m = q.data;
  const columns: Column<MoneyFeature>[] = [
    { id: "feature", label: t("Feature"), compare: (a, b) => a.feature.localeCompare(b.feature), cell: (f) => <ItemLink kind="feature" id={f.feature} /> },
    { id: "state", label: t("State"), cell: (f) => (f.status === "blocked" ? t("Blocked") : t("Degraded")) },
    {
      id: "rules", label: t("Blocking rules"),
      cell: (f) => (
        <span className="nx-tg-row">
          {f.blocking_rules.map((id) => (
            <ItemLink key={id} kind="rule" id={id} className="nx-mono" />
          ))}
        </span>
      ),
    },
    { id: "records", label: t("Records"), align: "end", compare: (a, b) => a.records - b.records, cell: (f) => int(f.records) },
    { id: "month", label: t("Per month"), align: "end", compare: (a, b) => (a.opportunity_cost_per_month ?? 0) - (b.opportunity_cost_per_month ?? 0), cell: (f) => <Amount value={f.opportunity_cost_per_month} currency={m?.currency ?? null} /> },
    { id: "since", label: t("Blocked since"), cell: (f) => <Since f={f} /> },
    { id: "cum", label: t("Since first blocked"), align: "end", compare: (a, b) => (a.cumulative_cost ?? 0) - (b.cumulative_cost ?? 0), cell: (f) => <Amount value={f.cumulative_cost} currency={m?.currency ?? null} /> },
  ];
  return (
    <section aria-label={t("Impact in money")} className="nx-card nx-tg-sec" data-testid="object-money">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Impact in money")}</h2>
        {m ? <span className="nx-tg-sub">{m.currency ? t("As of {date}, in {currency}", { date: formatDate(m.as_of, "date"), currency: m.currency }) : t("As of {date}", { date: formatDate(m.as_of, "date") })}</span> : null}
      </div>
      {q.isPending ? (
        <Skeleton lines={2} />
      ) : q.isError ? (
        <ErrorState sentence={t("The impact in money could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.features.length === 0 ? (
        <EmptyState heading={t("Impact in money")}>{t("No S/4 feature is blocked or degraded by {label} on its latest run, so nothing costs money here. A feature appears when the impact model maps a failing rule of this object to it.", { label })}</EmptyState>
      ) : (
        <>
          <MoneyLine m={q.data} />
          <DataTable
            rows={q.data.features}
            columns={columns}
            rowKey={(f) => `${f.system_id}:${f.feature}`}
            rowLabel={(f) => f.feature}
            caption={t("What {label} costs in S/4 features", { label })}
            density="compact"
          />
          <p className="nx-tg-prov">{t("Records blocked times the tenant's value per record and month, from the impact model of each run since the feature was first blocked. A degraded feature has no cost since it still runs.")}</p>
        </>
      )}
    </section>
  );
}

const NO_SCORE = () => t("No readiness score in this wave's run");

/** The Readiness tab: the object's place in the waves, what caps it, and the S/4 features it blocks or degrades. */
export function ReadinessTab({ o }: { o: ObjectRun }) {
  const apiModule = o.module;
  const label = o.label;
  const receiptQ = useReceipt(apiModule, o.runId);
  const rulesQ = useObjectRules(apiModule, o.runId);
  const names = useMemo(() => new Map((rulesQ.data ?? []).map((r) => [r.check_id, r.name])), [rulesQ.data]);
  const readinessQ = useReadiness();
  const impactQ = useConfigImpact(receiptQ.data?.run_id);
  const receipt = receiptQ.data;

  const cells = useMemo(() => (readinessQ.data?.cells ?? []).filter((c) => c.module === apiModule), [readinessQ.data, apiModule]);
  const mine = useMemo(() => (impactQ.data ?? []).filter((r) => r.status !== "ok" && rulesOf(r, apiModule).length > 0), [impactQ.data, apiModule]);
  const waves = useMemo(() => new Set(cells.map((c) => c.wave)), [cells]);
  // One threshold word (F16): the gate's minimum score the object's waves hold it to, when they agree.
  const thresholds = [...new Set(cells.map((c) => c.threshold ?? readinessQ.data?.threshold ?? null))];
  const gateMin = thresholds.length === 1 ? thresholds[0] : null;
  // A run without a readiness score for this object leaves readiness and records blocked unmeasured (F19).
  const scored = cells.some((c) => c.score != null);
  const blocked = mine.filter((r) => r.status === "blocked");
  const degraded = mine.filter((r) => r.status === "degraded");

  if (receiptQ.isError) return <ErrorState sentence={t("The readiness of {label} could not be read for this run.", { label })} error={receiptQ.error} onRetry={() => void receiptQ.refetch()} />;
  if (receiptQ.isPending) {
    return (
      <div aria-busy="true" data-testid="readiness-loading">
        <Skeleton lines={4} />
      </div>
    );
  }

  const waveCols: Column<ReadinessCell>[] = [
    { id: "wave", label: t("Wave"), compare: (a, b) => a.wave.localeCompare(b.wave), cell: (c) => c.wave },
    { id: "verdict", label: t("Verdict"), cell: (c) => <VerdictChip verdict={VERDICT[c.verdict]} /> },
    { id: "gaps", label: t("Blocking gaps"), align: "end", compare: (a, b) => a.blocker_count - b.blocker_count, cell: (c) => int(c.blocker_count) },
    { id: "dqs", label: t("Score"), align: "end", compare: (a, b) => (a.dqs ?? -1) - (b.dqs ?? -1), cell: (c) => (c.dqs == null ? <Dash /> : f1(c.dqs)) },
    ...(scored
      ? ([
          { id: "score", label: t("Readiness"), align: "end", cell: (c) => (c.score == null ? <Dash why={NO_SCORE()} /> : f1(c.score)) },
          { id: "blocked", label: t("Records blocked"), align: "end", cell: (c) => (c.score == null ? <Dash why={NO_SCORE()} /> : int(c.records_blocked)) },
        ] satisfies Column<ReadinessCell>[])
      : []),
  ];

  return (
    <div className="nx-tg" data-testid="tab-readiness">
      <section aria-label={t("Waves")} className="nx-card nx-tg-sec">
        <div className="nx-tg-head">
          <h2 className="nx-sec-h">{t("Migration waves")}</h2>
          {gateMin != null ? <span className="nx-tg-sub">{t("Gate: min score {score}", { score: f1(gateMin) })}</span> : null}
        </div>
        {readinessQ.isPending ? (
          <Skeleton lines={2} />
        ) : readinessQ.isError ? (
          <ErrorState sentence={t("The migration waves could not be read.")} error={readinessQ.error} onRetry={() => void readinessQ.refetch()} />
        ) : cells.length === 0 ? (
          <EmptyState
            heading={t("Migration waves")}
            action={
              <Link href="/?view=waves&open=waves" className="nx-link">
                {t("Open migration waves")}
              </Link>
            }
          >
            {t("{label} is not in a migration wave yet. A lead adds it to a wave, and its verdict appears here.", { label })}
          </EmptyState>
        ) : (
          <>
            <SegBar
              testid="readiness-verdicts"
              segs={[
                { key: "go", label: t("Go"), value: cells.filter((c) => c.verdict === "go").length, tone: "good" },
                { key: "risk", label: t("At risk"), value: cells.filter((c) => c.verdict === "at_risk").length, tone: "warn" },
                { key: "nogo", label: t("No-go"), value: cells.filter((c) => c.verdict === "no_go").length, tone: "bad" },
              ]}
            />
            <ExportTable><DataTable rows={cells} columns={waveCols} rowKey={(c) => c.wave} rowLabel={(c) => c.wave} caption={t("Waves that include {label}", { label })} density="compact" /></ExportTable>
          </>
        )}
        {cells.length > 0 && !scored ? (
          <p className="nx-tg-prov" data-testid="readiness-unscored">
            {t("Readiness and records blocked are not shown: no migration run has a readiness score for {label} yet. The verdict comes from its blocking gaps and its score.", { label })}
          </p>
        ) : null}
        {receipt ? <CapStatement receipt={receipt} /> : null}
      </section>

      <section aria-label={t("S/4HANA features")} className="nx-card nx-tg-sec">
        <div className="nx-tg-head">
          <h2 className="nx-sec-h">{t("What the failing rules do in S/4HANA")}</h2>
          {receipt?.run_at ? <span className="nx-tg-sub">{t("Run {run_at}", { run_at: formatDate(receipt.run_at, "datetime") })}</span> : null}
        </div>
        {impactQ.isPending && Boolean(receipt?.run_id) ? (
          <Skeleton lines={2} />
        ) : impactQ.isError ? (
          <ErrorState sentence={t("The feature impact could not be read for this run.")} error={impactQ.error} onRetry={() => void impactQ.refetch()} />
        ) : (
          <>
            {mine.length > 0 ? (
              <SegBar
                testid="readiness-features"
                segs={[
                  { key: "blocked", label: t("Blocked in S/4HANA"), value: blocked.length, tone: "bad" },
                  { key: "degraded", label: t("Degraded in S/4HANA"), value: degraded.length, tone: "warn" },
                ]}
              />
            ) : null}
            <div className="nx-tg-split">
              <FeatureList title={t("Blocked in S/4HANA")} results={blocked} module={apiModule} names={names} empty={t("No S/4 feature is blocked by a rule of this object.")} />
              <FeatureList title={t("Degraded in S/4HANA")} results={degraded} module={apiModule} names={names} empty={t("No S/4 feature is degraded by a rule of this object.")} />
            </div>
            <Blockers results={mine} module={apiModule} names={names} />
            <p className="nx-tg-prov">{t("Mapped from the rules that fail by the feature impact rules, for the rules of this object in this run.")}</p>
          </>
        )}
      </section>
      <ByObject o={o} waves={waves} />
      <ObjectMoney module={apiModule} label={label} />
    </div>
  );
}


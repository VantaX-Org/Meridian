"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMdmHealthSeries } from "@/lib/api/v2/analytics";
import { getMdmHealth, getMdmHistory, type MdmSnapshot } from "@/lib/api/v2/mdm-health";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { Button, DataTable, EmptyState, ErrorState, PointSpark, Skeleton, Sparkline, StatCard, type Column } from "../../kit";
import { ChartCard, cardState } from "../ChartCard";
import { TableSave } from "./TableSave";
import { httpStatus, noRetry4xx, useGo } from "./util";
import { PARTS, points } from "./words";

/**
 * Golden records health, native: the daily MDM snapshot. The score is the weighted sum of four shares, so the
 * breakdown shows each share, its weight and the points it adds. Trends come from the same daily snapshots.
 */
export function GoldenHealth() {
  const fixture = useFixture();
  const go = useGo();
  const now = useQuery({ queryKey: ["mdm-health", fixture], queryFn: getMdmHealth, staleTime: 60_000, retry: noRetry4xx });
  const hist = useQuery({ queryKey: ["mdm-health", fixture, "history"], queryFn: () => getMdmHistory(90), staleTime: 60_000, retry: noRetry4xx });
  const card = useQuery({ queryKey: ["mdm-health", fixture, "series"], queryFn: () => getMdmHealthSeries(56), staleTime: 60_000, retry: noRetry4xx });

  if (now.isPending) return <div className="nx-body"><Skeleton lines={6} label={t("MDM health")} /></div>;
  if (now.isError) {
    return (
      <div className="nx-body" data-testid="mdm-page">
        {httpStatus(now.error) === 403 ? <EmptyState heading={t("Your role cannot read the MDM health figures.")} /> : (
          <ErrorState sentence={t("The MDM health figures could not be read.")} error={now.error} onRetry={() => void now.refetch()} />
        )}
      </div>
    );
  }
  const s = now.data.latest;
  if (!s) return <div className="nx-body" data-testid="mdm-page"><EmptyState heading={t("No MDM snapshot has been taken yet. The snapshot runs once a day.")} /></div>;
  const days = hist.data?.history ?? now.data.trend;
  const first = days.length > 1 ? days[0] : null;
  const change = first ? s.mdm_health_score - first.mdm_health_score : null;
  const trend = (pick: (d: MdmSnapshot) => number) => days.map((d) => ({ label: formatDate(d.snapshot_date, "date"), value: pick(d) }));

  const partCols: Column<(typeof PARTS)[number]>[] = [
    { id: "measure", label: t("Measure"), cell: (p) => <span className="nx-cell-stack">{p.label()}<span className="nx-sub">{p.what()}</span></span> },
    { id: "value", label: t("Value"), align: "end", cell: (p) => pct1(s[p.key]) },
    { id: "weight", label: t("Weight"), align: "end", cell: (p) => pct1(p.weight) },
    { id: "points", label: t("Points"), align: "end", compare: (a, b) => points(s, a) - points(s, b), cell: (p) => f1(points(s, p)) },
    { id: "trend", label: t("Trend"), cell: (p) => <Sparkline points={days.map((d) => d[p.key] * 100)} label={t("{name} over {n} days", { name: p.label(), n: int(days.length) })} /> },
  ];

  const series = card.data?.data ?? [];
  const last = series[series.length - 1];
  const pctOf = (v: number | null | undefined) => (v == null ? "-" : pct1(v / 100));
  const tiles = last ? [
    { id: "score", label: t("Health score"), value: f1(last.mdm_health_score), series: series.map((x) => x.mdm_health_score) },
    { id: "cov", label: t("Golden record coverage"), value: pctOf(last.golden_record_coverage_pct), series: series.map((x) => x.golden_record_coverage_pct) },
    { id: "match", label: t("Match confidence"), value: f1(last.avg_match_confidence), series: series.map((x) => x.avg_match_confidence) },
    { id: "sla", label: t("Steward SLA met"), value: pctOf(last.steward_sla_compliance_pct), series: series.map((x) => x.steward_sla_compliance_pct) },
    { id: "src", label: t("Source consistency"), value: pctOf(last.source_consistency_pct), series: series.map((x) => x.source_consistency_pct) },
  ] : [];
  type Tile = (typeof tiles)[number];
  const tileCols: Column<Tile>[] = [
    { id: "measure", label: t("Measure"), cell: (x) => x.label },
    { id: "latest", label: t("Latest"), align: "end", cell: (x) => x.value },
    { id: "trend", label: t("Trend"), cell: (x) => <Sparkline points={x.series.filter((v): v is number => v != null)} label={t("{name} over {n} days", { name: x.label, n: int(series.length) })} /> },
  ];
  const flags = (last?.ai_risk_flags ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  const projected = !!last && (last.ai_projected_score != null || last.ai_narrative != null || flags.length > 0);

  return (
    <div className="nx-body" data-testid="mdm-page">
      <section aria-label={t("MDM health")} data-testid="mdm-banner">
        <p className="nx-sub">{t("MDM health on {date}", { date: formatDate(s.snapshot_date, "date") })}</p>
        <h2>{t("Health {score} out of 100", { score: f1(s.mdm_health_score) })}</h2>
        <p className="nx-sub">
          {change == null || !first
            ? t("One snapshot so far; the change shows from the second day.")
            : t("{sign}{n} points since {date}", { sign: change >= 0 ? "+" : "", n: f1(change), date: formatDate(first.snapshot_date, "date") })}
        </p>
        <div className="nx-statgrid">
          <StatCard label={t("Golden records")} value={s.golden_record_count} />
          <StatCard label={t("Stewardship backlog")} value={s.backlog_count} />
          <StatCard label={t("Systems synced")} value={s.sync_coverage_pct * 100} format={(n) => pct1(n / 100)} />
          <StatCard label={t("{n} active systems", { n: "" }).trim()} value={now.data.active_systems_count} />
        </div>
        <p className="nx-row nx-wrap"><Button size={32} onClick={go("/issues")}>{t("Open the issues")}</Button></p>
      </section>
      <div className="nx-chartcards">
        <ChartCard
          title={t("Health score, day by day")} state={days.length < 2 ? "empty" : "ready"} testId="mdm-trend"
          chart={<PointSpark points={trend((d) => d.mdm_health_score)} label={t("Health score, day by day")} />}
          figure={f1(s.mdm_health_score)} line={t("One point per daily snapshot")} emptyLine={t("Two daily snapshots are needed to draw a trend.")}
        />
        <ChartCard
          title={t("Stewardship backlog, day by day")} state={days.length < 2 ? "empty" : "ready"} testId="mdm-backlog"
          chart={<PointSpark points={trend((d) => d.backlog_count)} label={t("Stewardship backlog, day by day")} />}
          figure={int(s.backlog_count)} line={t("One point per daily snapshot")} emptyLine={t("Two daily snapshots are needed to draw a trend.")}
        />
      </div>
      <section aria-label={t("What makes the score")} data-testid="mdm-parts">
        <h3>{t("What makes the score")}</h3>
        <p className="nx-sub">{t("Four shares, weighted")}</p>
        <TableSave title={t("What makes the score")}>
          <DataTable rows={PARTS} columns={partCols} rowKey={(p) => p.key} rowLabel={(p) => p.label()} caption={t("What makes the score")} />
        </TableSave>
      </section>
      <section aria-label={t("Scorecard")} data-testid="mdm-scorecard">
        <h3>{t("Scorecard")}</h3>
        <p className="nx-sub">{last ? t("Snapshot of {day}", { day: formatDate(last.snapshot_date, "date") }) : t("The latest day against the last eight weeks")}</p>
        {card.isError || cardState(card, false) === "denied" ? null : (
          <DataTable
            rows={tiles} columns={tileCols} rowKey={(x) => x.id} rowLabel={(x) => x.label} caption={t("Scorecard")} loading={card.isLoading}
            empty={{ heading: t("No daily health snapshot has been taken yet.") }}
          />
        )}
        {projected && last ? (
          <div data-testid="mdm-aletheia">
            <p>{t("Projected score")} <span className="nx-mono">{f1(last.ai_projected_score)}</span></p>
            {last.ai_narrative ? <p>{last.ai_narrative}</p> : null}
            {flags.length > 0 ? <ul>{flags.map((f) => <li key={f}>{f}</li>)}</ul> : null}
          </div>
        ) : <p className="nx-sub" data-testid="mdm-aletheia">{t("The Aletheia projection is not available to your role or has not been computed.")}</p>}
      </section>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { getMdmHealthSeries } from "@/lib/api/v2/analytics";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMdmHealth, getMdmHistory, type MdmSnapshot } from "@/lib/api/v2/mdm-health";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { DataTable, EmptyState, ErrorState, Skeleton, Sparkline } from "../kit";
import { AreaTrend } from "../viz";
import { About, Banner, Fold, Panel } from "./cfg-parts";

/**
 * MDM health: the daily snapshot of how well master data is governed. The score is the weighted sum of four shares
 * (api/services/mdm_scoring.py), so the breakdown shows each share, its weight and the points it adds, which sum to
 * the score. The history comes from the same daily snapshots; a day without a snapshot is simply absent.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

type Share = "golden_record_coverage_pct" | "avg_match_confidence" | "steward_sla_compliance_pct" | "source_consistency_pct";

const PARTS: { key: Share; weight: number; label: () => string; what: () => string }[] = [
  { key: "golden_record_coverage_pct", weight: 0.4, label: () => t("Golden record coverage"), what: () => t("Source records linked to a golden record") },
  { key: "avg_match_confidence", weight: 0.3, label: () => t("Match confidence"), what: () => t("Average confidence of the matches behind the golden records") },
  { key: "steward_sla_compliance_pct", weight: 0.2, label: () => t("Steward SLA"), what: () => t("Stewardship items resolved within their SLA") },
  { key: "source_consistency_pct", weight: 0.1, label: () => t("Source consistency"), what: () => t("Golden records whose sources agree") },
];

const points = (s: MdmSnapshot, p: (typeof PARTS)[number]) => s[p.key] * p.weight * 100;
const dash = f1(null);
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x != null);

function Trend({ days, pick, title, testId }: { days: readonly MdmSnapshot[]; pick: (d: MdmSnapshot) => number; title: string; testId: string }) {
  return (
    <Panel title={title} meta={t("One point per daily snapshot")} testId={testId}>
      <AreaTrend
        points={days.length < 2 ? [] : days.map((d) => ({ label: formatDate(d.snapshot_date, "date"), value: pick(d) }))}
        label={title}
        height={160}
        empty={t("Two daily snapshots are needed to draw a trend.")}
      />
    </Panel>
  );
}

/** The latest day of /analytics/mdm-health against the last eight weeks, with the Aletheia projection when the role may read it. */
function Scorecard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["extra", "mdm-health", fixture], queryFn: () => getMdmHealthSeries(56), staleTime: 60_000, retry });
  if (q.isPending) return <Skeleton lines={5} label={t("Scorecard")} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const days = q.data.data;
  const last = days[days.length - 1];
  if (!last) return <EmptyState heading={t("No daily health snapshot has been taken yet.")} />;
  const share = (v: number | null) => (v == null ? dash : pct1(v / 100));
  const tiles: { label: string; value: string; series: number[] }[] = [
    { label: t("Health score"), value: f1(last.mdm_health_score), series: nums(days.map((x) => x.mdm_health_score)) },
    { label: t("Golden record coverage"), value: share(last.golden_record_coverage_pct), series: nums(days.map((x) => x.golden_record_coverage_pct)) },
    { label: t("Match confidence"), value: f1(last.avg_match_confidence), series: nums(days.map((x) => x.avg_match_confidence)) },
    { label: t("Steward SLA met"), value: share(last.steward_sla_compliance_pct), series: nums(days.map((x) => x.steward_sla_compliance_pct)) },
    { label: t("Source consistency"), value: share(last.source_consistency_pct), series: nums(days.map((x) => x.source_consistency_pct)) },
  ];
  const flags = (last.ai_risk_flags ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  const projected = last.ai_projected_score != null || last.ai_narrative != null || flags.length > 0;
  return (
    <div className="nx-body" data-testid="mdm-scorecard">
      <p className="nx-sub">{t("Snapshot of {day}", { day: formatDate(last.snapshot_date, "date") })}</p>
      <DataTable
        rows={tiles}
        rowKey={(x) => x.label}
        rowLabel={(x) => x.label}
        caption={t("Scorecard")}
        columns={[
          { id: "m", label: t("Measure"), cell: (x) => x.label },
          { id: "v", label: t("Latest"), cell: (x) => x.value, align: "end" },
          { id: "s", label: t("Trend"), cell: (x) => <Sparkline points={x.series} label={t("{name} over {n} days", { name: x.label, n: int(days.length) })} /> },
        ]}
      />
      {projected ? (
        <div data-testid="mdm-aletheia">
          <p>{t("Projected score")} <strong>{f1(last.ai_projected_score)}</strong></p>
          {last.ai_narrative ? <p>{last.ai_narrative}</p> : null}
          {flags.length > 0 ? <ul>{flags.map((f) => <li key={f}>{f}</li>)}</ul> : null}
          <p className="nx-sub">{t("Based on {n} daily snapshots, the latest on {date}.", { n: int(days.length), date: formatDate(last.snapshot_date, "date") })}</p>
        </div>
      ) : <p className="nx-sub" data-testid="mdm-aletheia">{t("The Aletheia projection is not available to your role or has not been computed.")}</p>}
    </div>
  );
}


export function MdmHealth() {
  const fixture = useFixture();
  const now = useQuery({ queryKey: ["mdm-health", fixture], queryFn: getMdmHealth, staleTime: 60_000, retry });
  const hist = useQuery({ queryKey: ["mdm-health", fixture, "history"], queryFn: () => getMdmHistory(90), staleTime: 60_000, retry });
  const title = t("MDM health");
  if (now.isPending) return <Skeleton lines={8} label={title} />;
  if (now.isError) {
    return status(now.error) === 403
      ? <EmptyState heading={t("Your role cannot read the MDM health figures.")} />
      : <ErrorState sentence={t("The MDM health figures could not be read.")} onRetry={() => void now.refetch()} />;
  }
  const s = now.data.latest;
  if (!s) return <EmptyState heading={t("No MDM snapshot has been taken yet. The snapshot runs once a day.")} />;
  const days = hist.data?.history ?? now.data.trend;
  const first = days.length > 1 ? days[0] : null;
  const change = first ? s.mdm_health_score - first.mdm_health_score : null;
  return (
    <div className="nx-body" data-testid="mdm-health">
      <Banner
        title={t("Health {score} out of 100", { score: f1(s.mdm_health_score) })}
        why={change == null || !first
          ? t("One snapshot so far; the change shows from the second day.")
          : t("{sign}{n} points since {date}", { sign: change >= 0 ? "+" : "", n: f1(change), date: formatDate(first.snapshot_date, "date") })}
        meta={t("MDM health on {date}", { date: formatDate(s.snapshot_date, "date") })}
        label={title}
        testId="mdm-banner"
        figs={[
          { label: t("Golden records"), value: int(s.golden_record_count) },
          { label: t("Stewardship backlog"), value: int(s.backlog_count), note: t("Items still open") },
          { label: t("Systems synced"), value: pct1(s.sync_coverage_pct), note: t("{n} active systems", { n: int(now.data.active_systems_count) }) },
        ]}
      />
      <About
        shows={t("Scores how healthy your master data management is: golden records, the stewardship backlog and how many systems stay in sync.")}
        why={t("The score is the weighted sum of four shares, so the points below add up to it.")}
        next={{ href: "/issues", label: t("Open the issues") }}
        means={[
          [t("Golden records"), t("Records confirmed as the single trusted version.")],
          [t("Stewardship backlog"), t("Items still waiting for a data steward.")],
          [t("Systems synced"), t("The share of active systems whose data is in sync.")],
        ]}
      />
      <Panel title={t("What makes the score")} meta={t("Four shares, weighted")} testId="mdm-parts">
        <DataTable
          rows={PARTS}
          rowKey={(p) => p.key}
          rowLabel={(p) => p.label()}
          caption={t("What makes the score")}
          columns={[
            { id: "m", label: t("Measure"), cell: (p) => <>{p.label()} <span className="nx-sub">{p.what()}</span></> },
            { id: "v", label: t("Value"), cell: (p) => pct1(s[p.key]), align: "end" },
            { id: "w", label: t("Weight"), cell: (p) => pct1(p.weight), align: "end" },
            { id: "p", label: t("Points"), cell: (p) => f1(points(s, p)), align: "end" },
            { id: "t", label: t("Trend"), cell: (p) => <Sparkline points={days.map((d) => d[p.key] * 100)} label={t("{name} over {n} days", { name: p.label(), n: int(days.length) })} /> },
          ]}
        />
      </Panel>
      <Fold title={t("Scorecard")} hint={t("The latest day against the last eight weeks")}><Scorecard /></Fold>
      <Fold title={t("Trends over time")} hint={t("One point per daily snapshot")}>
        <Trend days={days} pick={(d) => d.mdm_health_score} title={t("Health score, day by day")} testId="mdm-trend" />
      </Fold>
      <Trend days={days} pick={(d) => d.backlog_count} title={t("Stewardship backlog, day by day")} testId="mdm-backlog" />
    </div>
  );
}

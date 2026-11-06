"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMdmHealth, getMdmHistory, type MdmSnapshot } from "@/lib/api/v2/mdm-health";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { ChartFrame, ChartTable, niceTicks, Sparkline, TrendChart } from "../charts";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { Disclose, Guide } from "./Guide";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * MDM health: the daily snapshot of how well master data is governed. The score is the weighted sum of four shares
 * (api/services/mdm_scoring.py), so the breakdown shows each share, its weight and the points it adds, which sum to
 * the score. The history comes from the same daily snapshots; a day without a snapshot is simply absent.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

type Share = "golden_record_coverage_pct" | "avg_match_confidence" | "steward_sla_compliance_pct" | "source_consistency_pct";

/** The four shares in the score with their weights, as api/services/mdm_scoring.py weighs them. */
export const PARTS: { key: Share; weight: number; label: () => string; what: () => string }[] = [
  { key: "golden_record_coverage_pct", weight: 0.4, label: () => t("Golden record coverage"), what: () => t("Source records linked to a golden record") },
  { key: "avg_match_confidence", weight: 0.3, label: () => t("Match confidence"), what: () => t("Average confidence of the matches behind the golden records") },
  { key: "steward_sla_compliance_pct", weight: 0.2, label: () => t("Steward SLA"), what: () => t("Stewardship items resolved within their SLA") },
  { key: "source_consistency_pct", weight: 0.1, label: () => t("Source consistency"), what: () => t("Golden records whose sources agree") },
];

/** The points one share adds to the score. */
export const points = (s: MdmSnapshot, p: (typeof PARTS)[number]) => s[p.key] * p.weight * 100;

export function MdmHealth() {
  const fixture = useFixture();
  const now = useQuery({ queryKey: ["mdm-health", fixture], queryFn: getMdmHealth, staleTime: 60_000, retry });
  const hist = useQuery({ queryKey: ["mdm-health", fixture, "history"], queryFn: () => getMdmHistory(90), staleTime: 60_000, retry });

  if (now.isPending) return <CcPage title={t("MDM health")}><Skeleton width="100%" height={320} /></CcPage>;
  if (now.isError) {
    return (
      <CcPage title={t("MDM health")}>
        {status(now.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the MDM health figures.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void now.refetch()}>{t("The MDM health figures could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const s = now.data.latest;
  if (!s) {
    return (
      <CcPage title={t("MDM health")}>
        <EmptyFrame>{t("No MDM snapshot has been taken yet. The snapshot runs once a day.")}</EmptyFrame>
      </CcPage>
    );
  }
  const days = hist.data?.history ?? now.data.trend;
  const first = days.length > 1 ? days[0] : null;
  const change = first ? s.mdm_health_score - first.mdm_health_score : null;
  return (
    <CcPage title={t("MDM health")}>
      <Guide
        shows={t("Scores how healthy your master data management is: golden records, the stewardship backlog and how many systems stay in sync.")}
        next={{ href: "/issues", label: t("Open the issues") }}
        means={[
          [t("Golden records"), t("Records confirmed as the single trusted version.")],
          [t("Stewardship backlog"), t("Items still waiting for a data steward.")],
          [t("Systems synced"), t("The share of active systems whose data is in sync.")],
        ]}
      />
      <CcBanner
        eyebrow={t("MDM health on {date}", { date: formatDate(s.snapshot_date, "date") })}
        headline={t("Health {score} out of 100", { score: f1(s.mdm_health_score) })}
        why={
          change == null || !first
            ? t("One snapshot so far; the change shows from the second day.")
            : t("{sign}{n} points since {date}", { sign: change >= 0 ? "+" : "", n: f1(change), date: formatDate(first.snapshot_date, "date") })
        }
        figs={[
          { label: t("Golden records"), value: int(s.golden_record_count) },
          { label: t("Stewardship backlog"), value: int(s.backlog_count), note: t("Items still open") },
          { label: t("Systems synced"), value: pct1(s.sync_coverage_pct), note: t("{n} active systems", { n: int(now.data.active_systems_count) }) },
        ]}
        testId="mdm-banner"
        label={t("MDM health")}
      />
      <Panel title={t("What makes the score")} meta={t("Four shares, weighted")} testId="mdm-parts">
        <ScrollFrame label={t("What makes the score")}>
          <table className="m2-tbl m2-cards">
            <caption className="m2-sr">{t("What makes the score")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Measure")}</th>
                <th scope="col">{t("Value")}</th>
                <th scope="col">{t("Weight")}</th>
                <th scope="col">{t("Points")}</th>
                <th scope="col">{t("Trend")}</th>
              </tr>
            </thead>
            <tbody>
              {PARTS.map((p) => (
                <tr key={p.key}>
                  <th scope="row" className="m2-card-lead">
                    {p.label()}
                    <span className="m2-meta"> {p.what()}</span>
                  </th>
                  <td data-label={t("Value")} className="m2-num">{pct1(s[p.key])}</td>
                  <td data-label={t("Weight")} className="m2-num">{pct1(p.weight)}</td>
                  <td data-label={t("Points")} className="m2-num">{f1(points(s, p))}</td>
                  <td data-label={t("Trend")}>
                    <Sparkline values={days.map((d) => d[p.key] * 100)} label={t("{name} over {n} days", { name: p.label(), n: int(days.length) })} width={96} height={20} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      </Panel>
      <Disclose title={t("Trends over time")}>
      <Trend days={days} pick={(d) => d.mdm_health_score} title={t("Health score, day by day")} unit={t("points")} testId="mdm-trend" format={f1} fixed />
      </Disclose>
      <Trend days={days} pick={(d) => d.backlog_count} title={t("Stewardship backlog, day by day")} unit={t("items")} testId="mdm-backlog" format={int} />
    </CcPage>
  );
}

function Trend({ days, pick, title, unit, testId, format, fixed }: {
  days: readonly MdmSnapshot[];
  pick: (d: MdmSnapshot) => number;
  title: string;
  unit: string;
  testId: string;
  format: (n: number) => string;
  /** Draw on the full 0 to 100 scale, as the score is. */
  fixed?: boolean;
}) {
  const pts = days.map((d) => {
    const label = formatDate(d.snapshot_date, "date");
    return { id: d.snapshot_date, label, title: `${label}: ${format(pick(d))}`, value: pick(d) };
  });
  const ticks = fixed ? [0, 25, 50, 75, 100] : niceTicks(0, Math.max(1, ...pts.map((p) => p.value)), 4);
  return (
    <ChartFrame
      title={title}
      sub={t("One point per daily snapshot")}
      height={160}
      level={2}
      state={pts.length < 2 ? "empty" : "ready"}
      empty={t("Two daily snapshots are needed to draw a trend.")}
      testId={testId}
      table={<ChartTable caption={title} head={[t("Day"), unit]} rows={pts.map((p) => [p.label, format(p.value)])} />}
    >
      <TrendChart points={pts} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={160} label={title} yLabel={unit} format={format} />
    </ChartFrame>
  );
}

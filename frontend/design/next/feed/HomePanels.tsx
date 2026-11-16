"use client";

// The landscape panels the old home carried (go-live, cleaned and watched, readiness matrix, fix pipeline, value at
// risk), each in its own card under the feed. Function ported from design/v2; the look is the feed card's.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moneyCompactText } from "@/lib/v2/labels";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { daysUntil, nextWave } from "@/lib/v2/waves";
import { useTimeline } from "@/lib/v2/runs-queries";
import { useWorkSummary } from "@/lib/v2/work-queries";
import { useMoney } from "@/lib/v2/step9-queries";
import { getBackAfterClean } from "@/lib/api/remediation";
import { queryKeys } from "@/lib/query-keys";
import { useFixture } from "@/lib/api/v2/fixture";
import type { Landscape, LandscapeCell, Verdict } from "@/lib/api/v2/types";
import type { MigrationWave } from "@/types/api";
import { Chip, Code, DataTable, EmptyState, ErrorState, NxLink, ProgressBar, Skeleton, Sparkline, StatCard } from "../kit";
import { PartBar } from "../kit/viz";

const RANK: Record<Verdict, number> = { "no-go": 0, "at-risk": 1, go: 2 };
const TONE: Record<Verdict, "bad" | "warn" | "good"> = { "no-go": "bad", "at-risk": "warn", go: "good" };

function Card({ title, testid, children, action }: { title: string; testid: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="nx-fd-card" data-testid={testid} aria-label={title}>
      <div className="nx-fd-card-head"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

const labelOf = (l: Landscape, module: string) => l.objects.find((o) => o.module === module)?.label ?? module;

/** The next wave's go-live: what blocks it, the days left, the monthly cost of waiting, the critical issues open. */
export function GoLiveCard({ landscape, waves }: { landscape: Landscape; waves: readonly MigrationWave[] }) {
  const money = useMoney("landscape", null);
  const work = useWorkSummary();
  const wave = nextWave(waves);
  const days = daysUntil(wave?.target_date ?? null);
  const scope = wave?.modules?.length ? landscape.cells.filter((c) => wave.modules.includes(c.module)) : landscape.cells;
  if (!scope.length) return null;
  const worst = scope.reduce<Verdict>((w, c) => (RANK[c.verdict] < RANK[w] ? c.verdict : w), "go");
  const blockers = scope.filter((c) => c.verdict === "no-go");
  const ready = scope.filter((c) => c.verdict === "go").length;
  const critical = work.data?.totals.critical ?? 0;
  const cost = money.data?.totals.opportunity_cost_per_month ?? null;
  const names = [...new Set(blockers.map((c) => labelOf(landscape, c.module)))].join(", ");
  return (
    <Card title={t("Go-live")} testid="home-golive" action={<Chip tone={TONE[worst]}>{VERDICT_LABEL[worst]}</Chip>}>
      <p className="nx-fd-meta">{wave ? t("Next go-live: {wave}", { wave: wave.name }) : t("All objects in scope")}</p>
      <p>
        {blockers.length
          ? t("{n} objects block go-live: {names}", { n: blockers.length, names })
          : worst === "at-risk" ? t("Nothing blocks go-live, but some objects are below target.") : t("Every object in scope meets its target.")}
      </p>
      <dl className="nx-fd-visual">
        <div><dt className="nx-fd-meta">{t("Days to go-live")}</dt><dd className="nx-num">{days == null ? t("no date set") : int(days)}</dd></div>
        <div><dt className="nx-fd-meta">{t("Cost of waiting")}</dt><dd className="nx-num">{money.data?.cost_model === false || cost == null ? t("no cost model") : `${moneyCompactText(cost, money.data?.currency)} ${t("per month")}`}</dd></div>
        <div><dt className="nx-fd-meta">{t("Objects ready")}</dt><dd className="nx-num">{`${int(ready)} / ${int(scope.length)}`}</dd></div>
        <div><dt className="nx-fd-meta">{t("{n} critical issues open", { n: critical })}</dt><dd className="nx-num">{int(critical)}</dd></div>
      </dl>
      {money.isError || work.isError ? <p className="nx-fd-delta" data-testid="golive-partial">{t("The cost of waiting or the count of open critical issues could not be loaded, so the figures above may be missing.")}</p> : null}
      <div className="nx-fd-greet-actions">
        {blockers.length ? <NxLink className="nx-btn nx-btn-sm" href="/work?verdict=no-go">{t("Fix {n} blockers", { n: blockers.length })}</NxLink> : null}
        {critical ? <NxLink className="nx-btn nx-btn-quiet nx-btn-sm" href="/work?severity=critical">{t("Clear {n} critical issues", { n: critical })}</NxLink> : null}
        {wave && !blockers.length ? <NxLink className="nx-btn nx-btn-quiet nx-btn-sm" href="/?view=waves">{t("Sign off the wave")}</NxLink> : null}
      </div>
    </Card>
  );
}

/** What cleansing fixed and what failed again after it: monitoring after every clean, never a one-off. */
export function AutoCleanedCard() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: [...queryKeys.backAfterClean(), fixture, 12], queryFn: () => getBackAfterClean(12), staleTime: 60_000 });
  const title = t("Cleaned and watched");
  if (q.isLoading) return <Card title={title} testid="home-cleaned"><Skeleton lines={3} label={title} /></Card>;
  if (q.isError) return <Card title={title} testid="home-cleaned"><ErrorState error={q.error} fallback={t("The record of what was cleaned and what came back could not be loaded.")} onRetry={() => void q.refetch()} /></Card>;
  const weeks = q.data?.weeks ?? [];
  const fixed = weeks.reduce((n, w) => n + w.fixed, 0);
  if (!weeks.length || fixed === 0) return null;
  const last = weeks[weeks.length - 1];
  return (
    <Card title={title} testid="home-cleaned" action={<NxLink className="nx-btn nx-btn-quiet nx-btn-sm" href="/monitor">{t("Open monitoring")}</NxLink>}>
      <div className="nx-fd-visual">
        <StatCard label={t("records fixed this week")} value={last.fixed} />
        <div className="nx-fd-visual-side">
          <Sparkline points={weeks.map((w) => w.back)} label={t("Fixed and failing again, by week")} />
          <p className="nx-fd-delta">{t("{fixed} fixed in {n} weeks; {back} failed again this week and were reopened.", { fixed: int(fixed), n: weeks.length, back: int(last.back) })}</p>
        </div>
      </div>
    </Card>
  );
}

function Trend({ cell, name }: { cell: LandscapeCell; name: string }) {
  const tl = useTimeline(cell.system_id, 12);
  const points = (tl.data?.runs ?? []).map((r) => r.objects[cell.module]?.score).filter((n): n is number => typeof n === "number").reverse();
  return points.length > 1 ? <Sparkline points={points} label={t("{name} score over the last {n} runs", { name, n: points.length })} /> : <span className="nx-fd-meta">{t("not measured")}</span>;
}

function Delta30({ cell }: { cell: LandscapeCell }) {
  const tl = useTimeline(cell.system_id, 12);
  const [cut] = useState(() => Date.now() - 30 * 86_400_000);
  const pts = (tl.data?.runs ?? [])
    .filter((r) => r.run_at && Date.parse(r.run_at) >= cut)
    .map((r) => ({ at: Date.parse(r.run_at as string), v: r.objects[cell.module]?.score }))
    .filter((p): p is { at: number; v: number } => typeof p.v === "number")
    .sort((a, b) => a.at - b.at);
  if (pts.length < 2) return <span className="nx-fd-meta">{t("not measured")}</span>;
  const d = pts[pts.length - 1].v - pts[0].v;
  return <span className="nx-num">{`${d > 0 ? "+" : ""}${f1(d)}`}</span>;
}

/** Every object in every system: verdict, score, trend, records, work to fix and the value at risk a month. */
export function ReadinessCard({ landscape }: { landscape: Landscape }) {
  const money = useMoney("landscape", null);
  const value = (m: string) => money.data?.ranking.objects.find((o) => o.id === m)?.value_unblocked_per_month ?? null;
  const sys = (id: string) => landscape.systems.find((s) => s.id === id);
  const rows = [...landscape.cells].sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || (a.score ?? 0) - (b.score ?? 0));
  const name = (c: LandscapeCell) => {
    const s = sys(c.system_id);
    return `${labelOf(landscape, c.module)}, ${s?.name ?? c.system_id}${s?.client ? t(", client {client}", { client: s.client }) : ""}`;
  };
  return (
    <Card title={t("Readiness matrix")} testid="home-readiness">
      <DataTable
        rows={rows}
        rowKey={(c) => `${c.system_id}:${c.module}`}
        rowLabel={name}
        caption={t("Readiness matrix")}
        density="compact"
        empty={{ heading: t("No object has been measured yet.") }}
        columns={[
          { id: "object", label: t("Object"), cell: (c) => <NxLink href={`/o/${systemSlug(sys(c.system_id)?.name ?? c.system_id)}/${moduleSlug(c.module)}`}><Code code={c.module} text={name(c)} /></NxLink> },
          { id: "verdict", label: t("Verdict"), cell: (c) => <Chip tone={TONE[c.verdict]}>{VERDICT_LABEL[c.verdict]}</Chip> },
          { id: "score", label: t("Score"), align: "end", cell: (c) => (c.score == null ? t("not measured") : f1(c.score)) },
          { id: "trend", label: t("Last runs"), cell: (c) => <Trend cell={c} name={name(c)} /> },
          { id: "d30", label: t("30 days"), align: "end", cell: (c) => <Delta30 cell={c} /> },
          { id: "records", label: t("Records"), align: "end", cell: (c) => int(c.records_checked) },
          { id: "fix", label: t("To fix"), align: "end", cell: (c) => int(c.open_work) },
          { id: "value", label: t("Value at risk a month"), align: "end", cell: (c) => (value(c.module) == null ? "" : moneyCompactText(value(c.module), money.data?.currency)) },
        ]}
      />
    </Card>
  );
}

const STAGES = ["to_fix", "proposed", "approved", "awaiting_load", "sent", "fixed"] as const;
const stageLabel = (s: (typeof STAGES)[number]) =>
  ({ to_fix: t("To fix"), proposed: t("Waiting for approval"), approved: t("Approved"), awaiting_load: t("Waiting for the SAP load"), sent: t("Sent to SAP"), fixed: t("Fixed") })[s];

/** Records at each step of the fix, by object: the eight objects with most open. */
export function FixPipelineCard({ landscape }: { landscape: Landscape }) {
  const work = useWorkSummary();
  const title = t("Fix pipeline");
  const head = <NxLink className="nx-btn nx-btn-quiet nx-btn-sm" href="/work">{t("Open Work")}</NxLink>;
  if (work.isLoading) return <Card title={title} testid="home-pipeline"><Skeleton lines={4} label={t("Reading the work")} /></Card>;
  if (work.isError) return <Card title={title} testid="home-pipeline"><ErrorState error={work.error} fallback={t("The work could not be read.")} onRetry={() => void work.refetch()} /></Card>;
  const objects = [...(work.data?.objects ?? [])].filter((o) => o.open > 0).sort((a, b) => b.open - a.open).slice(0, 8);
  return (
    <Card title={title} testid="home-pipeline" action={head}>
      <p className="nx-fd-meta">{t("Records at each step, by object")}</p>
      {objects.length === 0 ? <EmptyState heading={t("nothing open")} /> : (
        <ul>
          {objects.map((o) => (
            <li key={o.module}>
              <Code code={o.module} text={labelOf(landscape, o.module)} /> <span className="nx-fd-meta">{t("Open")} {int(o.open)}</span>
              <PartBar segments={STAGES.map((s) => ({ label: stageLabel(s), value: o.statuses[s] ?? 0 }))} label={t("Split")} format={int} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The monthly cost of each blocked or degraded SAP feature, largest first, and the total. */
export function RiskWaterfallCard() {
  const money = useMoney("landscape", null);
  const title = t("Value at risk");
  if (money.isLoading) return <Card title={title} testid="home-risk"><Skeleton lines={4} label={t("Reading the cost model")} /></Card>;
  if (money.isError) return <Card title={title} testid="home-risk"><ErrorState error={money.error} fallback={t("The cost model could not be read.")} onRetry={() => void money.refetch()} /></Card>;
  const m = money.data;
  if (!m || !m.cost_model) return <Card title={title} testid="home-risk"><EmptyState heading={t("No cost model is set up.")} /></Card>;
  const feats = m.features.filter((f) => (f.opportunity_cost_per_month ?? 0) > 0).sort((a, b) => (b.opportunity_cost_per_month ?? 0) - (a.opportunity_cost_per_month ?? 0));
  if (!feats.length) return <Card title={title} testid="home-risk"><EmptyState heading={t("No SAP feature is blocked or degraded.")} /></Card>;
  const total = feats.reduce((n, f) => n + (f.opportunity_cost_per_month ?? 0), 0);
  const top = feats.slice(0, 7);
  const rest = feats.slice(7);
  const restCost = rest.reduce((n, f) => n + (f.opportunity_cost_per_month ?? 0), 0);
  const money$ = (n: number) => moneyCompactText(n, m.currency);
  return (
    <Card title={title} testid="home-risk" action={<span className="nx-fd-meta">{t("as of {date}", { date: formatDate(m.as_of) })}</span>}>
      <ul aria-label={t("Monthly cost by blocked feature")}>
        {top.map((f) => (
          <li key={`${f.system_id}:${f.feature}`}>
            <strong>{f.feature}</strong> <Chip tone={f.status === "blocked" ? "bad" : "warn"}>{f.status === "blocked" ? t("blocked") : t("degraded")}</Chip> <span className="nx-num">{money$(f.opportunity_cost_per_month ?? 0)}</span>
            <ProgressBar value={((f.opportunity_cost_per_month ?? 0) / total) * 100} label={f.feature} />
          </li>
        ))}
        {rest.length ? <li>{t("{n} more features", { n: rest.length })} <span className="nx-num">{money$(restCost)}</span></li> : null}
      </ul>
      <p><strong>{t("Total a month")}</strong> <span className="nx-num">{money$(total)}</span></p>
    </Card>
  );
}

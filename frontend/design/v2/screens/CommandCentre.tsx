"use client";

import { useQuery } from "@tanstack/react-query";
import type { MigrationWave } from "@/types/api";
import type { Landscape, Verdict } from "@/lib/api/v2/types";
import { getBackAfterClean } from "@/lib/api/remediation";
import { queryKeys } from "@/lib/query-keys";
import { daysUntil, nextWave } from "@/lib/v2/waves";
import { formatDate } from "@/lib/format";
import { useTimeline } from "@/lib/v2/runs-queries";
import { useWorkSummary } from "@/lib/v2/work-queries";
import { useMoney } from "@/lib/v2/step9-queries";
import { moneyCompactText } from "@/lib/v2/labels";
import { f1, int, VERDICT_LABEL } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { ChartFrame, ChartTable, TrendChart, niceTicks } from "../charts";
import { VerdictMark } from "../marks";
import { V2Link } from "../parts";
import { AskBody } from "../inspector/ask";

const worst = (vs: readonly Verdict[]): Verdict => (vs.includes("no-go") ? "no-go" : vs.includes("at-risk") ? "at-risk" : "go");

/** The headline: is the next wave going live, what it costs to wait, how long is left, and the one thing to do next. */
export function GoLiveBanner({ landscape, waves }: { landscape: Landscape; waves: readonly MigrationWave[] }) {
  const wave = nextWave(waves);
  const days = daysUntil(wave?.target_date ?? null);
  const scope = wave?.modules?.length ? landscape.cells.filter((c) => wave.modules.includes(c.module)) : landscape.cells;
  const verdict = worst(scope.map((c) => c.verdict));
  const blockers = scope.filter((c) => c.verdict === "no-go");
  const ready = scope.filter((c) => c.verdict === "go").length;
  const money = useMoney("landscape", null).data;
  const critical = useWorkSummary().data?.totals.critical ?? 0;
  const cost = money?.totals.opportunity_cost_per_month;
  return (
    <section className="m2-cc-banner" data-verdict={verdict} aria-label={t("Go-live")} data-testid="golive-banner">
      <div className="m2-cc-verdict">
        <span className="m2-cc-eyebrow">{wave ? t("Next go-live: {wave}", { wave: wave.name }) : t("All objects in scope")}</span>
        <strong>
          <VerdictMark verdict={verdict} /> {VERDICT_LABEL[verdict]}
        </strong>
        <span className="m2-cc-why">
          {blockers.length
            ? t("{n} objects block go-live: {names}", { n: blockers.length, names: blockers.slice(0, 3).map((c) => landscape.objects.find((o) => o.module === c.module)?.label ?? c.module).join(", ") })
            : verdict === "at-risk"
              ? t("Nothing blocks go-live, but some objects are below target.")
              : t("Every object in scope meets its target.")}
        </span>
      </div>
      <dl className="m2-cc-figs">
        <div>
          <dt>{t("Days to go-live")}</dt>
          <dd>{days == null ? "—" : int(Math.max(days, 0))}</dd>
          <dd className="m2-cc-note">{wave?.target_date ? formatDate(wave.target_date, "date") : t("no date set")}</dd>
        </div>
        <div>
          <dt>{t("Cost of waiting")}</dt>
          <dd>{cost == null ? "—" : moneyCompactText(cost, money?.currency)}</dd>
          <dd className="m2-cc-note">{cost == null ? t("no cost model") : t("per month")}</dd>
        </div>
        <div>
          <dt>{t("Objects ready")}</dt>
          <dd>
            {int(ready)}
            <small>/{int(scope.length)}</small>
          </dd>
          <dd className="m2-cc-note">{t("{n} critical issues open", { n: int(critical) })}</dd>
        </div>
      </dl>
      <div className="m2-cc-act">
        {blockers.length ? (
          <V2Link href="/work?verdict=no-go" className="m2-btn m2-next">
            {t("Fix {n} blockers", { n: blockers.length })}
          </V2Link>
        ) : critical > 0 ? (
          <V2Link href="/work?severity=critical" className="m2-btn m2-next">
            {t("Clear {n} critical issues", { n: int(critical) })}
          </V2Link>
        ) : (
          <V2Link href="/waves" className="m2-btn m2-next">
            {t("Sign off the wave")}
          </V2Link>
        )}
      </div>
    </section>
  );
}

/** Aletheia, docked: the grounded assistant answers from this run's facts and cites the rules behind every number. */
export function AletheiaDock() {
  return (
    <aside className="m2-cc-dock" aria-label={t("Aletheia")} data-testid="aletheia-dock">
      <header>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static, licensed mark; next/image adds nothing here */}
        <img src="/brand/aletheia-mark.svg" alt="" width={28} height={28} />
        <div>
          <strong>{t("Aletheia")}</strong>
          <span>{t("Grounded answers from this run. Every number is checked against a fact, with the rules cited.")}</span>
        </div>
      </header>
      <AskBody hero={false} />
    </aside>
  );
}

/** The landscape's score over the last runs: the mean of the objects' measured scores, per run. */
function LandscapeTrend({ systemId }: { systemId: string | null }) {
  const runs = useTimeline(systemId, 12).data?.runs ?? [];
  const points = runs.map((r) => {
    const vs = Object.values(r.objects)
      .map((o) => o.raw_score ?? o.score)
      .filter((v): v is number => v != null);
    const value = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    const label = r.run_at ? formatDate(r.run_at, "date") : (r.label ?? r.id.slice(0, 6));
    return { id: r.id, label, title: t("{label}: average score {score}", { label, score: f1(value) }), value };
  });
  const known = points.map((p) => p.value).filter((v): v is number => v != null);
  const ticks = niceTicks(Math.max(0, Math.min(...known, 100) - 5), Math.min(100, Math.max(...known, 0) + 5), 4);
  return (
    <ChartFrame
      title={t("Readiness over time")}
      sub={t("Average object score, last {n} runs", { n: points.length })}
      height={160}
      level={3}
      state={known.length < 2 ? "empty" : "ready"}
      empty={t("Two runs are needed to draw a trend.")}
      testId="cc-trend"
      table={<ChartTable caption={t("Average score by run")} head={[t("Run"), t("Score")]} rows={points.map((p) => [p.label, f1(p.value)])} />}
    >
      <TrendChart points={points} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={160} label={t("Average object score by run")} yLabel={t("score")} format={f1} />
    </ChartFrame>
  );
}

/** Post-clean monitoring on the home page: what was fixed this week, and what came back. */
export function AutoCleaned() {
  const q = useQuery({ queryKey: queryKeys.backAfterClean(), queryFn: () => getBackAfterClean(12), staleTime: 30_000 });
  const weeks = q.data?.weeks ?? [];
  const last = weeks[weeks.length - 1];
  const fixed = weeks.reduce((a, w) => a + w.fixed, 0);
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.fixed, w.back)));
  return (
    <section className="m2-cc-card" aria-label={t("Cleaned and watched")} data-testid="cc-cleaned">
      <h3>{t("Cleaned and watched")}</h3>
      <p className="m2-cc-big">
        {int(last?.fixed ?? 0)}
        <span>{t("records fixed this week")}</span>
      </p>
      <p className="m2-cc-sub">
        {t("{fixed} fixed in {n} weeks; {back} failed again this week and were reopened.", { fixed: int(fixed), n: weeks.length, back: int(last?.back ?? 0) })}
      </p>
      {weeks.length ? (
        <svg className="m2-cc-weeks" viewBox={`0 0 ${weeks.length * 10} 40`} preserveAspectRatio="none" role="img" aria-label={t("Fixed and failing again, by week")}>
          {weeks.map((w, i) => (
            <g key={w.week}>
              <rect className="m2-cc-wfix" x={i * 10 + 1} y={40 - (w.fixed / max) * 40} width="4" height={(w.fixed / max) * 40} />
              <rect className="m2-cc-wback" x={i * 10 + 5} y={40 - (w.back / max) * 40} width="4" height={(w.back / max) * 40} />
            </g>
          ))}
        </svg>
      ) : null}
      <V2Link href="/work/monitor">{t("Open monitoring")}</V2Link>
    </section>
  );
}

/** The bottom row: where readiness is heading and what cleansing has done. */
export function CommandRow({ landscape }: { landscape: Landscape }) {
  return (
    <div className="m2-cc-row">
      <section className="m2-cc-card">
        <LandscapeTrend systemId={landscape.systems.length === 1 ? landscape.systems[0].id : null} />
      </section>
      <AutoCleaned />
    </div>
  );
}

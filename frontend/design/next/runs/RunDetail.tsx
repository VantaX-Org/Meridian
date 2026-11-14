"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DeltaBar } from "@/design/v2/charts";
import { shortDate } from "@/design/v2/RunTimeline";
import { useCompareSummary, useRun } from "@/lib/api/next/runs";
import { analyseRun, type VersionHead } from "@/lib/api/v2/runs";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { AreaTrend, HeatGrid, ScoreRing, StackedBar, type HeatCell } from "../viz";
import { runLabel, runStatusWord } from "@/lib/v2/run-label";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { Chip, EmptyState, ErrorState, Sheet, Skeleton, Stepper, type StepItem } from "../kit";
import { isForbidden } from "./draft";
import "./runs.css";

/** Steps of a run, derived from what the run stored: pulled, scored, then checked by Aletheia. */
export function stepsOf(h: VersionHead): StepItem[] {
  const scored = Object.values(h.dqs_summary ?? {}).some((o) => typeof o.composite_score === "number");
  const failed = h.status === "failed";
  const running = h.status === "running";
  const done = !failed && !running;
  return [
    { id: "extract", label: t("Extracted"), state: failed && !scored ? "failed" : "done", detail: shortDate(h.run_at) },
    { id: "score", label: t("Scored"), state: scored ? "done" : failed ? "failed" : running ? "running" : "future" },
    { id: "aletheia", label: t("Aletheia checked"), state: done && scored ? "done" : running ? "future" : failed ? "future" : "current" },
  ];
}

export function RunBody({ id }: { id: string }) {
  const qc = useQueryClient();
  const run = useRun(id);
  const landscape = useLandscape(null).data;
  const h = run.data ?? null;
  const prev = h?.parent_version_id ?? null;
  const summary = useCompareSummary(prev, h?.id);
  const timeline = useTimeline(h?.metadata?.system_id ?? null, 12);
  const retry = useMutation({ mutationFn: () => analyseRun(id), onSuccess: () => { for (const k of ["v2", "next", "jobs"]) void qc.invalidateQueries({ queryKey: [k] }); } });

  if (run.isLoading) return <Skeleton lines={8} label={t("Loading the run")} />;
  if (run.isError) {
    return isForbidden(run.error)
      ? <EmptyState icon="alert" heading={t("You cannot see this run")}>{t("Ask an administrator for access to this system's runs.")}</EmptyState>
      : <ErrorState error={run.error} fallback={t("The run could not be loaded.")} onRetry={() => void run.refetch()} />;
  }
  if (!h) {
    return <EmptyState icon="alert" heading={t("Run not found")} action={<Link className="nx-rn-link" href="/next/runs">{t("Back to runs")}</Link>}>{t("It may have been deleted, or the link is wrong.")}</EmptyState>;
  }

  const name = runLabel(h.system_name, h.run_number);
  const entries = Object.entries(h.dqs_summary ?? {});
  const scores = entries.map(([, o]) => o.composite_score).filter((n): n is number => typeof n === "number");
  const hero = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const sys = landscape?.systems.find((s) => s.id === h.metadata?.system_id);
  const modules = entries.length ? entries.map(([m]) => m) : (h.metadata?.modules ?? []);
  const failed = h.status === "failed";
  const running = h.status === "running";
  const runs = [...(timeline.data?.runs ?? [])].reverse();
  const trend = runs.flatMap((r) => {
    const sc = Object.values(r.objects).map((o) => o.score).filter((n): n is number => typeof n === "number");
    return sc.length ? [{ label: shortDate(r.run_at), value: sc.reduce((a, b) => a + b, 0) / sc.length }] : [];
  });
  const cells: Record<string, HeatCell> = {};
  for (const r of runs) for (const m of modules) {
    const v = r.objects[m]?.score;
    cells[`${m}|${r.id}`] = { key: `${m}|${r.id}`, title: `${moduleText(m)}, ${shortDate(r.run_at)}: ${typeof v === "number" ? v.toFixed(1) : t("Not scored")}`, value: typeof v === "number" ? v : null };
  }
  const sev = Object.entries(h.severity_counts ?? {}).map(([k, v], i) => ({ id: k, label: k, value: v, tone: (["bad", "warn", "chart1", "mute"] as const)[Math.min(i, 3)] }));
  const partial = !failed && modules.some((m) => typeof h.dqs_summary?.[m]?.composite_score !== "number");

  return (
    <div className="nx-rn-detail" data-testid="run-detail">
      <header className="nx-rn-hero">
        <div>
          <h2 className="nx-rn-h2 nx-rn-trunc" title={name}>{name}</h2>
          <p className="nx-rn-sub">{shortDate(h.run_at)} <Chip tone={failed ? "bad" : running ? "warn" : "good"}>{runStatusWord(h.status)}</Chip></p>
        </div>
        <ScoreRing value={hero} size={132} label={hero == null ? t("This run has no score yet") : t("Run score {n} out of 100", { n: hero.toFixed(1) })} />
      </header>

      <section className="nx-rn-viz" aria-label={t("Score over the last runs")}>
        <AreaTrend points={trend} label={t("Score over the last {n} runs", { n: trend.length })} empty={t("The trend appears after two scored runs.")} height={96} />
        {modules.length > 0 && runs.length > 1 ? (
          <HeatGrid rows={modules} cols={runs.map((r) => r.id)} cells={cells} label={t("Score of each object in each of the last runs")} />
        ) : null}
        {sev.length > 0 ? <StackedBar segs={sev} label={t("Findings by severity")} /> : null}
      </section>

      <Stepper label={t("Steps of this run")} steps={stepsOf(h)} />

      {failed ? (
        <ErrorState sentence={t("This run failed before it was fully scored.")} onRetry={() => retry.mutate()} />
      ) : null}
      {retry.isError ? <ErrorState error={retry.error} fallback={t("The step could not be retried.")} onRetry={() => retry.mutate()} /> : null}
      {running ? <p role="status" className="nx-rn-note">{t("This run is still in progress. Scores appear as each object finishes.")}</p> : null}
      {partial && !running ? <p role="status" className="nx-rn-note">{t("Some objects have no score yet.")}</p> : null}

      <section aria-label={t("Objects in this run")}>
        <h3 className="nx-rn-h3">{t("Objects")}</h3>
        {modules.length === 0 ? <p className="nx-rn-note">{t("No object was scored in this run.")}</p> : (
          <table className="nx-rn-table">
            <caption className="nx-rn-sr">{t("Score of each object in this run")}</caption>
            <thead><tr><th scope="col">{t("Object")}</th><th scope="col">{t("Score")}</th><th scope="col">{t("Rules")}</th><th scope="col"><span className="nx-rn-sr">{t("Actions")}</span></th></tr></thead>
            <tbody>
              {modules.map((m) => {
                const o = h.dqs_summary?.[m];
                return (
                  <tr key={m}>
                    <th scope="row" title={moduleText(m)}><span className="nx-rn-trunc">{moduleText(m)}</span></th>
                    <td>{typeof o?.composite_score === "number" ? o.composite_score.toFixed(1) : <span className="nx-rn-sub">{t("Not scored")}</span>}</td>
                    <td>{o?.total_checks == null ? "" : formatInt(o.total_checks)}</td>
                    <td>
                      {sys ? <Link className="nx-rn-link" href={`/next/o/${systemSlug(sys.name)}/${moduleSlug(m)}`}>{t("Open")}</Link> : null}
                      {prev ? <> <Link className="nx-rn-link" href={`/next/run/${prev}/vs/${h.id}?objects=${encodeURIComponent(m)}`}>{t("Compare")}</Link></> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label={t("What changed")}>
        <h3 className="nx-rn-h3">{t("What changed")}</h3>
        {!prev ? <p className="nx-rn-note">{t("This is the first run, so there is nothing earlier to compare with.")}</p>
          : summary.isLoading ? <Skeleton lines={3} label={t("Loading what changed")} />
          : summary.isError ? <ErrorState error={summary.error} fallback={t("What changed could not be loaded.")} onRetry={() => void summary.refetch()} />
          : summary.data ? (
            <>
              <p className="nx-rn-chips">
                <Chip tone="new" count={summary.data.totals.new}>{t("new")}</Chip>
                <Chip tone="resolved" count={summary.data.totals.resolved}>{t("resolved")}</Chip>
                <Chip tone="regressed" count={summary.data.totals.regressed}>{t("worse")}</Chip>
                <Chip count={summary.data.totals.persisting}>{t("unchanged")}</Chip>
              </p>
              <StackedBar label={t("{n} new, {m} resolved, {w} worse, {u} unchanged", { n: summary.data.totals.new, m: summary.data.totals.resolved, w: summary.data.totals.regressed, u: summary.data.totals.persisting })} segs={[
                { id: "new", label: t("new"), value: summary.data.totals.new, tone: "bad" },
                { id: "regressed", label: t("worse"), value: summary.data.totals.regressed, tone: "warn" },
                { id: "resolved", label: t("resolved"), value: summary.data.totals.resolved, tone: "good" },
                { id: "persisting", label: t("unchanged"), value: summary.data.totals.persisting, tone: "mute" },
              ]} />
              <ul className="nx-rn-rules">
                {summary.data.checks.slice(0, 8).map((c) => (
                  <li key={`${c.module}-${c.check_id}`}>
                    <span className="nx-rn-trunc" title={c.reason ?? c.check_id}>{c.reason ?? c.check_id}</span>
                    <DeltaBar d={c.resolved - c.new - c.regressed} width={96} scale={2} />
                  </li>
                ))}
              </ul>
              <p className="nx-rn-aletheia"><Chip tone="aletheia">{t("Aletheia")}</Chip> {t("Aletheia compared this run with the one before it: {n} new, {m} resolved.", { n: formatInt(summary.data.totals.new), m: formatInt(summary.data.totals.resolved) })}</p>
            </>
          ) : null}
      </section>
    </div>
  );
}

export function RunDetail({ id }: { id: string }) {
  return (
    <main className="nx-rn-page">
      <p><Link className="nx-rn-link" href="/next/runs">{t("Back to runs")}</Link></p>
      <RunBody id={id} />
    </main>
  );
}

export function RunDetailSheet({ id, close, under }: { id: string; close: () => void; under?: boolean }) {
  return (
    <Sheet open onClose={close} title={t("Run")} size="large" under={under}>
      <RunBody id={id} />
    </Sheet>
  );
}


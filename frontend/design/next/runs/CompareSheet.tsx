"use client";

import { useState } from "react";
import Link from "next/link";
import { DeltaBar, TrendChart, niceTicks, scoreDomain } from "@/design/v2/charts";
import { shortDate } from "@/design/v2/RunTimeline";
import { useMultiCompare, useRuns, type MultiRun, type RuleChange } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { runLabel } from "@/lib/v2/run-label";
import { Chip, Code, EmptyState, ErrorState, Sheet, Skeleton, type ChipTone } from "../kit";
import "./runs.css";

/** A matrix holds six runs at most: past that the columns stop being readable. */
export const MAX_COMPARE_RUNS = 6;

export const scoreOf = (h: VersionHead | null, module: string): number | null => h?.dqs_summary?.[module]?.composite_score ?? null;
const fmt = (n: number | null) => (n == null ? t("Not scored") : n.toFixed(1));
const nameOf = (h: VersionHead) => runLabel(h.system_name, h.run_number);

/** Splits a list of run ids into the ones shown and how many were dropped. Blank and repeated ids go first. */
export function capRuns(ids: readonly string[]): { shown: string[]; dropped: number } {
  const uniq = [...new Set(ids.filter(Boolean))];
  return { shown: uniq.slice(0, MAX_COMPARE_RUNS), dropped: Math.max(0, uniq.length - MAX_COMPARE_RUNS) };
}

/** Objects as rows, runs as columns (oldest first as given), the score in each cell and its move since the column before. */
export function CompareMatrix({ ids, objects }: { ids: readonly string[]; objects?: readonly string[] }) {
  const { shown, dropped } = capRuns(ids);
  const { heads, loading } = useRuns(shown);
  if (shown.length < 2) {
    return <EmptyState icon="info" heading={t("Pick at least two runs")}>{t("Tick two or more runs on the Runs page, then choose Compare.")}</EmptyState>;
  }
  if (loading) return <Skeleton lines={6} label={t("Loading the runs to compare")} />;
  const found = heads.filter((h): h is VersionHead => h !== null);
  if (found.length === 0) {
    return <EmptyState icon="alert" heading={t("These runs were not found")} action={<Link className="nx-rn-link" href="/next/runs">{t("Back to runs")}</Link>}>{t("They may have been deleted, or the link is wrong.")}</EmptyState>;
  }
  const all = [...new Set(found.flatMap((h) => Object.keys(h.dqs_summary ?? {})))].sort();
  const rows = objects?.length ? all.filter((m) => objects.includes(m)) : all;
  return (
    <div className="nx-rn-cmp" data-testid="compare-matrix">
      {dropped ? <p role="status" className="nx-rn-note">{t("Showing the first {n} runs. {m} more were left out.", { n: MAX_COMPARE_RUNS, m: dropped })}</p> : null}
      {found.length < shown.length ? <p role="alert" className="nx-rn-bad">{t("{n} of these runs were not found and are marked below.", { n: shown.length - found.length })}</p> : null}
      <table className="nx-rn-table">
        <caption className="nx-rn-sr">{t("Score of each object in each run")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Object")}</th>
            {shown.map((id, i) => {
              const h = heads[i];
              return (
                <th scope="col" key={id}>
                  {h ? <Link className="nx-rn-link nx-rn-trunc" href={`/next/run/${h.id}`} title={nameOf(h)}>{nameOf(h)}</Link> : <span className="nx-rn-bad" title={id}>{t("Run not found")}</span>}
                  {h ? <span className="nx-rn-sub">{shortDate(h.run_at)}</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={shown.length + 1}>{t("No object was scored in these runs.")}</td></tr> : rows.map((m) => (
            <tr key={m}>
              <th scope="row" title={moduleText(m)}><span className="nx-rn-trunc">{moduleText(m)}</span></th>
              {shown.map((id, i) => {
                const h = heads[i];
                const s = scoreOf(h, m);
                const prev = i > 0 ? scoreOf(heads[i - 1], m) : null;
                const d = s != null && prev != null ? s - prev : null;
                return (
                  <td key={id} data-testid={`cell-${m}-${i}`}>
                    {h ? fmt(s) : t("Not scored")}
                    {d != null ? <span className="nx-rn-delta"><DeltaBar d={d} width={64} /><span>{d > 0 ? "+" : ""}{d.toFixed(1)}</span></span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHANGE: Record<RuleChange, { tone: ChipTone; word: () => string }> = {
  newly_failing: { tone: "new", word: () => t("Newly failing") },
  fixed: { tone: "resolved", word: () => t("Fixed") },
  worse: { tone: "regressed", word: () => t("Regressed") },
  better: { tone: "good", word: () => t("Improved") },
};
const KINDS = Object.keys(CHANGE) as RuleChange[];
const runName = (r: MultiRun) => runLabel(r.system_name, r.run_number);
const num = (n: number | null | undefined) => (n == null ? t("Not run") : formatInt(n));

/**
 * One object across the runs, side by side: score, the six dimensions, records checked, a trend of the score and
 * every rule's failing records per run with how it changed on each step. The runs may come from different systems.
 */
export function CompareObject({ ids, objects }: { ids: readonly string[]; objects?: readonly string[] }) {
  const { shown } = capRuns(ids);
  const { heads } = useRuns(shown);
  const scored = [...new Set(heads.flatMap((h) => Object.keys(h?.dqs_summary ?? {})))].sort();
  const choices = objects?.length ? scored.filter((m) => objects.includes(m)) : scored;
  const [picked, setPicked] = useState<string | null>(null);
  const module = picked && choices.includes(picked) ? picked : (choices[0] ?? null);
  const q = useMultiCompare(shown, module);
  if (shown.length < 2 || !module) return null;
  const d = q.data;
  const scores = d?.runs.map((r) => r.score).filter((v): v is number => v != null) ?? [];
  const domain = scoreDomain(scores);
  return (
    <section className="nx-rn-cmp" aria-label={t("One object across the runs")} data-testid="compare-object">
      <div className="nx-rn-filters">
        <label>
          {t("Object")}{" "}
          <select value={module} onChange={(e) => setPicked(e.target.value)} data-testid="compare-object-pick">
            {choices.map((m) => <option key={m} value={m}>{moduleText(m)}</option>)}
          </select>
        </label>
      </div>
      {q.isLoading ? <Skeleton lines={6} label={t("Loading the comparison")} /> : q.isError || !d ? <ErrorState sentence={t("The comparison could not be loaded.")} onRetry={() => void q.refetch()} /> : (
        <>
          <TrendChart
            points={d.runs.map((r) => ({ id: r.id, label: runName(r), title: `${runName(r)}, ${shortDate(r.run_at)}: ${r.score == null ? t("Not scored") : r.score.toFixed(1)}`, value: r.score }))}
            domain={domain}
            ticks={niceTicks(domain[0], domain[1], 4)}
            label={t("Score of {object} in each run, oldest first", { object: moduleText(module) })}
            yLabel={t("Score, 0 to 100")}
            format={(v) => v.toFixed(1)}
            height={200}
            testId="compare-trend"
          />
          <table className="nx-rn-table" data-testid="compare-side">
            <caption className="nx-rn-sr">{t("Score, dimensions and records checked of each run")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Measure")}</th>
                {d.runs.map((r) => <th scope="col" key={r.id}><span className="nx-rn-trunc" title={runName(r)}>{runName(r)}</span><span className="nx-rn-sub">{shortDate(r.run_at)}</span></th>)}
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">{t("Score")}</th>{d.runs.map((r) => <td key={r.id}>{fmt(r.score)}{r.capped ? <span className="nx-rn-sub">{t("capped from {n}", { n: (r.raw_score ?? 0).toFixed(1) })}</span> : null}</td>)}</tr>
              {DIMENSIONS.map((dim) => (
                <tr key={dim.key}><th scope="row">{dim.label}</th>{d.runs.map((r) => <td key={r.id}>{fmt(r.dimension_scores[dim.key] ?? null)}</td>)}</tr>
              ))}
              <tr><th scope="row">{t("Records checked")}</th>{d.runs.map((r) => <td key={r.id}>{num(r.records_checked)}</td>)}</tr>
            </tbody>
          </table>
          {d.steps.map((st, i) => (
            <div key={`${st.a}-${st.b}`} className="nx-rn-chips" data-testid={`compare-step-${i}`}>
              <span className="nx-rn-sub">{t("{a} to {b}", { a: runName(d.runs[i]), b: runName(d.runs[i + 1]) })}</span>
              {KINDS.map((k) => <Chip key={k} tone={CHANGE[k].tone} count={st[k]}>{CHANGE[k].word()}</Chip>)}
            </div>
          ))}
          <table className="nx-rn-table" data-testid="compare-rules">
            <caption className="nx-rn-sr">{t("Failing records of each rule in each run")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Rule")}</th>
                {d.runs.map((r) => <th scope="col" key={r.id}><span className="nx-rn-trunc" title={runName(r)}>{runName(r)}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {d.rules.length === 0 ? <tr><td colSpan={d.runs.length + 1}>{t("No rule ran cleanly for this object in these runs.")}</td></tr> : d.rules.map((rule) => (
                <tr key={rule.check_id} data-testid={`compare-rule-${rule.check_id}`}>
                  <th scope="row"><Code code={rule.check_id} text={rule.title ?? t("No description")} /></th>
                  {rule.failing.map((n, i) => {
                    const kind = i > 0 ? rule.change[i - 1] : null;
                    return <td key={d.runs[i].id}>{num(n)}{kind ? <> <Chip tone={CHANGE[kind].tone}>{CHANGE[kind].word()}</Chip></> : null}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function CompareSheet({ id, close, under }: { id: string; close: () => void; under?: boolean }) {
  return (
    <Sheet open onClose={close} title={t("Compare runs")} size="large" under={under}>
      <CompareMatrix ids={id.split(",")} />
      <CompareObject ids={id.split(",")} />
    </Sheet>
  );
}

/** The page fallback for /next/run/[a]/vs/[b], also reached with `?runs=a,b,c` and `?objects=x,y`. */
export function ComparePage({ a, b, runs, objects }: { a: string; b: string; runs?: string | null; objects?: string | null }) {
  const ids = runs ? runs.split(",") : [a, b];
  return (
    <main className="nx-rn-page">
      <h1 className="nx-rn-h1">{t("Compare runs")}</h1>
      <CompareMatrix ids={ids} objects={objects ? objects.split(",") : undefined} />
      <CompareObject ids={ids} objects={objects ? objects.split(",") : undefined} />
    </main>
  );
}

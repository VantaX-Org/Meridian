"use client";

import Link from "next/link";
import { DeltaBar } from "@/design/v2/charts";
import { shortDate } from "@/design/v2/RunTimeline";
import { useRuns } from "@/lib/api/next/runs";
import type { VersionHead } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { runLabel } from "@/lib/v2/run-label";
import { EmptyState, Sheet, Skeleton } from "../kit";
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

export function CompareSheet({ id, close, under }: { id: string; close: () => void; under?: boolean }) {
  return (
    <Sheet open onClose={close} title={t("Compare runs")} size="large" under={under}>
      <CompareMatrix ids={id.split(",")} />
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
    </main>
  );
}

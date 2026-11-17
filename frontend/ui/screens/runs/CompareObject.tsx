"use client";

import { useState } from "react";
import { useMultiCompare, useRuns, type MultiRun, type RuleChange } from "@/lib/api/next/runs";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { runLabel } from "@/lib/v2/run-label";
import { Badge, Card, ErrorState, Field, FieldChip, Select, Skeleton, TrendArea } from "@/ui/kit";

/** Six runs at most: past that the columns stop being readable. */
export const MAX_COMPARE_RUNS = 6;

/** Drops blank and repeated ids, then keeps the first six. */
export function capRuns(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))].slice(0, MAX_COMPARE_RUNS);
}

const CHANGE: Record<RuleChange, { tone?: "good" | "bad"; word: () => string }> = {
  newly_failing: { tone: "bad", word: () => t("Newly failing") },
  fixed: { tone: "good", word: () => t("Fixed") },
  worse: { tone: "bad", word: () => t("Got worse") },
  better: { tone: "good", word: () => t("Improved") },
};
const KINDS = Object.keys(CHANGE) as RuleChange[];
const runName = (r: MultiRun) => runLabel(r.system_name, r.run_number);
const fmt = (n: number | null | undefined) => (n == null ? t("Not scored") : n.toFixed(1));
const num = (n: number | null | undefined) => (n == null ? t("Not run") : n.toLocaleString());

/**
 * One object across two to six runs, side by side: score, dimensions, records checked, a trend of the score and
 * every rule's failing records per run with how it changed on each step. The runs may come from different systems.
 */
export function CompareObject({ ids, objects }: { ids: readonly string[]; objects?: readonly string[] }) {
  const shown = capRuns(ids);
  const { heads } = useRuns(shown);
  const scored = [...new Set(heads.flatMap((h) => Object.keys(h?.dqs_summary ?? {})))].sort();
  const choices = objects?.length ? scored.filter((m) => objects.includes(m)) : scored;
  const [picked, setPicked] = useState<string | null>(null);
  const obj = picked && choices.includes(picked) ? picked : (choices[0] ?? null);
  const q = useMultiCompare(shown, obj);
  if (shown.length < 2 || !obj) return null;
  const d = q.data;
  return (
    <section className="mx-col" aria-label={t("One object across the runs")} data-testid="compare-object">
      <Card title={t("One object across the runs")}>
        <Field label={t("Object")}>
          <Select value={obj} onChange={(e) => setPicked(e.target.value)} data-testid="compare-object-pick" options={choices.map((m) => ({ value: m, label: moduleText(m) }))} />
        </Field>
        {q.isLoading ? <Skeleton lines={6} label={t("Loading the comparison")} /> : q.isError || !d ? <ErrorState heading={t("The comparison could not be loaded.")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : (
          <div className="mx-col">
            <div data-testid="compare-trend">
              <TrendArea height={160} label={t("Score of {object} in each run, oldest first", { object: moduleText(obj) })} emptyLabel={t("Not scored")}
                points={d.runs.map((r) => ({ axis: runName(r), title: `${runName(r)}: ${fmt(r.score)}`, value: r.score }))} />
            </div>
            <div className="mx-table" data-testid="compare-side">
              <table aria-label={t("Score, dimensions and records checked of each run")}>
                <thead><tr><th scope="col">{t("Measure")}</th>{d.runs.map((r) => <th scope="col" key={r.id}>{runName(r)}</th>)}</tr></thead>
                <tbody>
                  <tr><th scope="row">{t("Score")}</th>{d.runs.map((r) => <td key={r.id} data-align="end">{fmt(r.score)}{r.capped ? <span className="mx-muted"> {t("capped from {n}", { n: (r.raw_score ?? 0).toFixed(1) })}</span> : null}</td>)}</tr>
                  {DIMENSIONS.map((dim) => <tr key={dim.key}><th scope="row">{dim.label}</th>{d.runs.map((r) => <td key={r.id} data-align="end">{fmt(r.dimension_scores[dim.key])}</td>)}</tr>)}
                  <tr><th scope="row">{t("Records checked")}</th>{d.runs.map((r) => <td key={r.id} data-align="end">{num(r.records_checked)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            {d.steps.map((st, i) => (
              <div key={`${st.a}-${st.b}`} className="rn-chips" data-testid={`compare-step-${i}`}>
                <span className="mx-muted">{t("{a} to {b}", { a: runName(d.runs[i]), b: runName(d.runs[i + 1]) })}</span>
                {KINDS.map((k) => <Badge key={k} tone={CHANGE[k].tone}>{CHANGE[k].word()} {st[k]}</Badge>)}
              </div>
            ))}
            <div className="mx-table" data-testid="compare-rules">
              <table aria-label={t("Failing records of each rule in each run")}>
                <thead><tr><th scope="col">{t("Rule")}</th>{d.runs.map((r) => <th scope="col" key={r.id}>{runName(r)}</th>)}</tr></thead>
                <tbody>
                  {d.rules.length === 0 ? <tr><td colSpan={d.runs.length + 1}>{t("No rule ran cleanly for this object in these runs.")}</td></tr> : d.rules.map((rule) => (
                    <tr key={rule.check_id} data-testid={`compare-rule-${rule.check_id}`}>
                      <th scope="row"><FieldChip code={rule.check_id} description={rule.title ?? t("No description")} /></th>
                      {rule.failing.map((n, i) => {
                        const kind = i > 0 ? rule.change[i - 1] : null;
                        return <td key={d.runs[i].id} data-align="end">{num(n)}{kind ? <> <Badge tone={CHANGE[kind].tone}>{CHANGE[kind].word()}</Badge></> : null}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

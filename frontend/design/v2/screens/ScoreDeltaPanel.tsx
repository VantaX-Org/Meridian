"use client";

import { useState } from "react";
import type { CompareSummary, ContributionKind, ScoreContribution } from "@/lib/api/v2/runs";
import { useScoreDelta } from "@/lib/v2/runs-queries";
import { t as tr } from "@/lib/v2/i18n";
import { Coded, ErrorFrame, Skeleton } from "../parts";
import { CcDelta } from "./cc-parts";

const sgn = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}`;

function kindText(k: ContributionKind): string {
  switch (k) {
    case "failing_records": return tr("Failing records changed");
    case "record_count": return tr("Records checked changed");
    case "new_rule": return tr("New rule");
    case "removed_rule": return tr("Rule no longer ran");
    case "reweighting": return tr("Dimension weighting");
    case "unexplained": return tr("Scoring configuration");
    case "cap": return tr("Critical cap");
  }
}

function rowLabel(c: ScoreContribution) {
  return c.check_id ? (
    <>
      <Coded code={c.check_id} text={c.description} /> <span className="m2-meta">{kindText(c.kind)}</span>
    </>
  ) : (
    <span>{kindText(c.kind)}</span>
  );
}

/** Why one object's score moved between two runs: a diverging bar of points per rule, then the verified narrative. */
export function ScoreDeltaPanel({ a, b, S }: { a: string; b: string; S: CompareSummary }) {
  const biggest = [...S.objects].sort((x, y) => Math.abs((y.score_change ?? 0)) - Math.abs((x.score_change ?? 0)))[0]?.module ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const module = picked ?? biggest;
  const q = useScoreDelta(a, b, module);
  const d = q.data;
  return (
    <section className="m2-cc-card" aria-label={tr("Why the score moved")} data-testid="score-delta">
      <h3>{tr("Why the score moved")}</h3>
      <div className="m2-cta">
        <label htmlFor="sd-object" className="m2-meta">{tr("Object")}</label>
        <select id="sd-object" className="m2-sel" value={module ?? ""} onChange={(e) => setPicked(e.target.value)}>
          {S.objects.map((o) => (
            <option key={o.module} value={o.module}>{o.label}</option>
          ))}
        </select>
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError || !d ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("The explanation of this change could not be read.")}</ErrorFrame>
      ) : (
        <>
          <p className="m2-meta" data-testid="score-delta-sum">
            {tr("{before} to {after}. The contributions add up to {sum} points of the {delta} points that changed.", { before: d.before.toFixed(2), after: d.after.toFixed(2), sum: sgn(d.sum), delta: sgn(d.delta) })}
          </p>
          <CcDelta
            testId="score-delta-bars"
            label={tr("Points by rule")}
            rows={d.contributions.map((c, i) => ({ key: `${c.kind}-${c.check_id ?? i}`, label: rowLabel(c), delta: c.points, text: tr("{n} points", { n: sgn(c.points) }) }))}
          />
          <ul data-testid="score-delta-narrative">
            {d.narrative.sentences.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="m2-prov">
            {d.narrative.source === "ai" ? tr("Written by Aletheia. Every number was checked against the figures above.") : tr("Written from the figures above, without a model.")}
            {d.narrative.dropped > 0 ? ` ${tr("Sentences dropped because a number was not in the figures: {n}.", { n: d.narrative.dropped })}` : ""}
          </p>
        </>
      )}
    </section>
  );
}

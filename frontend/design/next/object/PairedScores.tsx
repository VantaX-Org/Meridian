"use client";

/** Source, projected and actual target score of a paired system, with the reasons they differ. Nothing without a pair. */
import { useQuery } from "@tanstack/react-query";
import { getPairs } from "@/lib/api/v2/compare";
import { useFixture } from "@/lib/api/v2/fixture";
import { Code, EmptyState, ErrorState, Skeleton } from "@/design/next/kit";
import { t } from "@/lib/v2/i18n";
import { score, signed } from "./model";
import type { ObjectRun } from "./useObjectRun";

const val = (n: number | null | undefined) => (n === null || n === undefined ? "—" : score(n));

export function PairedScores({ o }: { o: ObjectRun }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "pairs", fx], queryFn: getPairs, staleTime: 60_000 });
  if (q.isPending) return <Skeleton lines={2} label={t("Reading the source and target scores")} />;
  if (q.isError) return <ErrorState sentence={t("The source and target scores could not be read.")} error={q.error} onRetry={() => void q.refetch()} />;
  const pair = q.data.pairs.find((p) => p.module === o.module && (p.source.id === o.systemId || p.target.id === o.systemId));
  // A system without a pair has no source and target to show, so nothing is drawn.
  if (!pair) return null;
  const s = pair.last?.scores;
  if (!s) {
    return (
      <EmptyState heading={t("{source} to {target}", { source: pair.source.name, target: pair.target.name })}>
        {t("The pair is not scored yet. Run analysis on both systems and the source, projected and actual target scores show here.")}
      </EmptyState>
    );
  }
  return (
    <section className="nx-card nx-paired" aria-label={t("Source and target scores")} data-testid="paired-scores">
      <h3 className="nx-cycle-h">{t("{source} to {target}", { source: pair.source.name, target: pair.target.name })}</h3>
      <dl className="nx-paired-row nx-num">
        <div><dt>{t("Source DQS")}</dt><dd>{val(s.source)}</dd></div>
        <div><dt>{t("Projected target DQS")}</dt><dd>{val(s.projected)}</dd>{s.projected_reason ? <p className="nx-muted">{s.projected_reason}</p> : null}</div>
        <div><dt>{t("Actual target DQS")}</dt><dd>{val(s.actual)}</dd>{s.actual_reason ? <p className="nx-muted">{s.actual_reason}</p> : null}</div>
      </dl>
      {s.reasons.length ? (
        <ul className="nx-paired-reasons">
          {s.reasons.slice(0, 5).map((r) => (
            <li key={r.check_id}>
              <Code code={r.check_id} text={r.description ?? undefined} /> <span className="nx-num">({signed(r.change)})</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

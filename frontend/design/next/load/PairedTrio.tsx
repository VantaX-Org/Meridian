"use client";

/** Source, projected target and actual target DQS of each paired system, with why they differ. Gap codes read as text. */
import { useQuery } from "@tanstack/react-query";
import { getPairs, getTrend } from "@/lib/api/v2/compare";
import { useFixture } from "@/lib/api/v2/fixture";
import { gapText } from "@/design/v2/screens/Migration";
import { t } from "@/lib/v2/i18n";
import { EmptyState, ErrorState, Skeleton } from "../kit";
import { AreaSpark, ScoreRing } from "../kit/viz";
import { score, signed } from "../object/model";
import { Trunc } from "./states";

const val = (n: number | null | undefined) => (n === null || n === undefined ? "—" : score(n));

/** The actual target score of each earlier comparison; a pair with no history draws an empty chart shape. */
function PairTrend({ id }: { id: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "trend", id, fx], queryFn: () => getTrend(id), staleTime: 60_000 });
  const pts = q.data?.points ?? [];
  const values = pts.map((x) => x.actual ?? x.projected ?? x.source);
  return <AreaSpark values={values} label={t("Target score over comparisons")} testid="trio-trend" />;
}

export function PairedTrio() {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["system-compare", "pairs", fx], queryFn: getPairs, staleTime: 60_000 });
  if (q.isLoading) return <Skeleton lines={3} label={t("Loading the source and target scores")} />;
  if (q.isError) return <ErrorState sentence={t("The source and target scores could not be loaded.")} error={q.error} onRetry={() => void q.refetch()} />;
  const pairs = (q.data?.pairs ?? []).filter((p) => p.last?.scores);
  if (pairs.length === 0) {
    return (
      <div data-testid="trio-empty">
        <EmptyState heading={t("No source and target pair has been scored")}>{t("Pair a source system with a target system on the Compare tab; both scores appear here.")}</EmptyState>
      </div>
    );
  }
  return (
    <div className="nx-stack" data-testid="paired-trio">
      {pairs.map((p) => {
        const s = p.last!.scores!;
        const partial = s.actual === null || s.actual === undefined || s.projected === null || s.projected === undefined;
        return (
          <section key={p.id} className="nx-card nx-ld-step" aria-label={t("{source} to {target}", { source: p.source.name, target: p.target.name })}>
            <h3><Trunc text={t("{source} to {target}", { source: p.source.name, target: p.target.name })} max={48} /></h3>
            <dl className="nx-ld-trio nx-ld-trio-visual nx-num">
              <div><ScoreRing compact size={72} value={s.source} label={t("Source DQS")} testid="ring-source" /><dt>{t("Source DQS")}</dt><dd>{val(s.source)}</dd></div>
              <div><ScoreRing compact size={72} value={s.projected} label={t("Projected target DQS")} testid="ring-projected" /><dt>{t("Projected target DQS")}</dt><dd>{val(s.projected)}</dd></div>
              <div><ScoreRing compact size={72} value={s.actual} label={t("Actual target DQS")} testid="ring-actual" /><dt>{t("Actual target DQS")}</dt><dd>{val(s.actual)}</dd></div>
            </dl>
            <PairTrend id={p.id} />
            {partial ? <p className="nx-ld-partial" data-testid="trio-partial">{t("Some scores are not known yet. The target has not been read back, or the projection has not run.")}</p> : null}
            {s.projected_reason || s.actual_reason || s.reasons.length ? (
              <div className="nx-ld-why">
                <h4>{t("Why they differ")}</h4>
                {s.projected_reason ? <p className="nx-ld-meta">{s.projected_reason}</p> : null}
                {s.actual_reason ? <p className="nx-ld-meta">{s.actual_reason}</p> : null}
                <ul>
                  {s.reasons.slice(0, 5).map((r) => (
                    <li key={r.check_id}>{r.description ?? gapText(r.check_id)} <span className="nx-num">({signed(r.change)})</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

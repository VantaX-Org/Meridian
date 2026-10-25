"use client";

import { useQuery } from "@tanstack/react-query";
import { Score } from "@/design";
import { getFindings, type FindingsAggregate } from "@/lib/api/findings";
import { getSettings } from "@/lib/api/settings";
import { DIMENSIONS } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/**
 * A DQS ring that opens the ScoreExplainer: dimension scores from the run, weights from tenant
 * settings (normalised over measured dimensions), and the five findings costing the most.
 * Falls back to the plain ring while the weights are unavailable, never to invented weights.
 */
export function DqsScore({ agg, versionId }: { agg: FindingsAggregate; versionId?: string }) {
  const settings = useQuery({ queryKey: queryKeys.scoringSettings(), queryFn: getSettings });
  const top = useQuery({
    queryKey: ["dqs-score-top", versionId ?? "current"],
    queryFn: () => getFindings({ version_id: versionId, sort: "impact", limit: 5 }),
  });
  const composite = agg.dqs.composite;
  const weights = settings.data?.dqs_weights as Record<string, number> | undefined;
  if (composite == null) return null;
  const raw = agg.dqs.raw ?? composite;
  const measured = Object.entries(agg.dqs.dimension_scores).filter(([d]) => weights?.[d] != null);
  const cap = agg.dqs.capped ? composite : undefined;
  if (!weights || measured.length === 0) return <Score value={raw} cap={cap} />;
  const total = measured.reduce((n, [d]) => n + weights[d], 0) || 1;
  const tier = agg.dqs.tier;
  return (
    <Score
      value={raw}
      cap={cap}
      explain={{
        band: { label: tier === "pass" ? "On target" : tier === "warn" ? "Needs attention" : tier === "fail" ? "Below floor" : "Scored", tone: tier === "pass" ? "go" : tier === "warn" ? "at-risk" : tier === "fail" ? "no-go" : "neutral" },
        dimensions: measured.map(([d, score]) => ({ name: DIMENSIONS.find((x) => x.id === d)?.label ?? d, weight: weights[d] / total, score })),
        capReason: cap != null ? "a critical finding is open" : undefined,
        // weight descends with rank so the explainer's recordsFailed * weight sort keeps the impact order
        rules: (top.data?.findings ?? []).map((f, i, all) => ({ ruleId: f.check_id, object: f.module, recordsFailed: f.affected_count, weight: (all.length - i) / all.length })),
        // "Score history" is the run-by-run trend of this run's system or upload, not the executive summary.
        historyHref: versionId ? `/insights/trends?run=${encodeURIComponent(versionId)}` : "/insights/trends",
        run: versionId,
      }}
    />
  );
}

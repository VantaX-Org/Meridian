"use client";

import { useQuery } from "@tanstack/react-query";
import { Score, statusLabel } from "@/design";
import { getFindings, type FindingsAggregate } from "@/lib/api/findings";
import { getSettings } from "@/lib/api/settings";
import { DIMENSIONS, shortCapReason } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/**
 * A DQS ring that opens the ScoreExplainer: dimension scores from the run, weights from tenant
 * settings (normalised over measured dimensions), and the five findings costing the most.
 * Falls back to the plain ring while the weights are unavailable, never to invented weights.
 * `capReason` is the run's own reason when the caller has it (the home and the executive summary); `cap` the cap value.
 */
export function DqsScore({ agg, versionId, cap: capValue, capReason }: { agg: FindingsAggregate; versionId?: string; cap?: number | null; capReason?: string | null }) {
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
  const cap = capValue ?? (agg.dqs.capped ? composite : undefined);
  if (!weights || measured.length === 0) return <Score value={raw} cap={cap} />;
  const total = measured.reduce((n, [d]) => n + weights[d], 0) || 1;
  const tier = agg.dqs.tier;
  return (
    <Score
      value={raw}
      cap={cap}
      explain={{
        band: { label: tier ? statusLabel("verdict", tier === "pass" ? "go" : tier === "warn" ? "at-risk" : "no-go") : "Scored", tone: tier === "pass" ? "go" : tier === "warn" ? "at-risk" : tier === "fail" ? "no-go" : "neutral" },
        dimensions: measured.map(([d, score]) => ({ name: DIMENSIONS.find((x) => x.id === d)?.label ?? d, weight: weights[d] / total, score })),
        capReason: cap != null ? (capReason ? shortCapReason(capReason) : "a critical finding is open") : undefined,
        // weight descends with rank so the explainer's recordsFailed * weight sort keeps the impact order
        rules: (top.data?.findings ?? []).map((f, i, all) => ({ ruleId: f.check_id, object: f.module, recordsFailed: f.affected_count, weight: (all.length - i) / all.length })),
        historyHref: versionId ? `/insights/trends?run=${versionId}` : "/insights/trends",
        run: versionId,
      }}
    />
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { ScoreExplainer, ScoreRing } from "@/design";
import { getFindings, type FindingsAggregate } from "@/lib/api/findings";
import { getSettings } from "@/lib/api/settings";
import { DIMENSIONS } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/**
 * A DQS ring that opens the ScoreExplainer: dimension scores from the run, weights from tenant
 * settings (normalised over measured dimensions), and the five findings costing the most.
 * Falls back to the plain ring while the weights are unavailable, never to invented weights.
 */
export function DqsScore({ agg, versionId, size = 48 }: { agg: FindingsAggregate; versionId?: string; size?: number }) {
  const settings = useQuery({ queryKey: queryKeys.scoringSettings(), queryFn: getSettings });
  const top = useQuery({
    queryKey: ["dqs-score-top", versionId ?? "current"],
    queryFn: () => getFindings({ version_id: versionId, sort: "impact", limit: 5 }),
  });
  const composite = agg.dqs.composite;
  const weights = settings.data?.dqs_weights as Record<string, number> | undefined;
  if (composite == null) return null;
  const measured = Object.entries(agg.dqs.dimension_scores).filter(([d]) => weights?.[d] != null);
  if (!weights || measured.length === 0) return <ScoreRing score={composite} size={size} />;
  const total = measured.reduce((n, [d]) => n + weights[d], 0) || 1;
  const tier = agg.dqs.tier;
  return (
    <ScoreExplainer
      score={composite}
      band={{ label: tier === "pass" ? "On target" : tier === "warn" ? "Needs attention" : tier === "fail" ? "Below floor" : "Scored", tone: tier === "pass" ? "go" : tier === "warn" ? "at-risk" : tier === "fail" ? "no-go" : "neutral" }}
      dimensions={measured.map(([d, score]) => ({ name: DIMENSIONS.find((x) => x.id === d)?.label ?? d, weight: weights[d] / total, score }))}
      cap={agg.dqs.capped ? { value: composite, reason: "a critical finding is open" } : undefined}
      rules={(top.data?.findings ?? []).map((f) => ({ ruleId: f.check_id, object: f.module, recordsFailed: f.affected_count, weight: 1 }))}
      historyHref="/insights/exec"
      run={versionId}
    />
  );
}

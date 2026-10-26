"use client";

import { useQuery } from "@tanstack/react-query";
import { Score, statusLabel, type ScoreExplanation } from "@/design";
import { getFindings, type FindingsAggregate } from "@/lib/api/findings";
import type { Finding } from "@/types/api";
import { getSettings } from "@/lib/api/settings";
import { DIMENSIONS, shortCapReason } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

interface DqsSource {
  /** The aggregate behind the score; undefined while it loads. */
  agg: FindingsAggregate | undefined;
  versionId?: string;
  /** The cap value when the caller has it (the home and the executive summary). */
  cap?: number | null;
  /** The run's own cap reason when the caller has it. */
  capReason?: string | null;
}

/**
 * The breakdown behind a DQS for `Score explain`: dimension scores from the run, weights from tenant settings
 * (normalised over measured dimensions), and the five findings costing the most. Undefined while the weights are
 * unavailable, never invented weights. A hero passes it to `Score size="hero" explain`, which opens it from the label.
 */
export function useDqsExplanation(source: DqsSource): DqsExplained | undefined {
  return dqsExplanation(source, useDqsInputs(source.versionId, source.agg?.dqs.composite != null));
}

export interface DqsInputs {
  weights?: Record<string, number>;
  top: Finding[];
}

export interface DqsExplained {
  /** The measured score before any cap. */
  raw: number;
  cap?: number;
  explain?: ScoreExplanation;
}

/** The tenant's weights and the run's five costliest findings: what `dqsExplanation` reads besides the aggregate. */
export function useDqsInputs(versionId: string | undefined, enabled = true): DqsInputs {
  const settings = useQuery({ queryKey: queryKeys.scoringSettings(), queryFn: getSettings });
  const top = useQuery({
    queryKey: ["dqs-score-top", versionId ?? "current"],
    queryFn: () => getFindings({ version_id: versionId, sort: "impact", limit: 5 }),
    enabled,
  });
  return { weights: settings.data?.dqs_weights as Record<string, number> | undefined, top: top.data?.findings ?? [] };
}

/** The breakdown from an aggregate and its inputs; for a page that learns the cap after its early returns. */
export function dqsExplanation({ agg, versionId, cap: capValue, capReason }: DqsSource, { weights, top }: DqsInputs): DqsExplained | undefined {
  const composite = agg?.dqs.composite;
  if (!agg || composite == null) return undefined;
  const raw = agg.dqs.raw ?? composite;
  const measured = Object.entries(agg.dqs.dimension_scores).filter(([d]) => weights?.[d] != null);
  const cap = capValue ?? (agg.dqs.capped ? composite : undefined);
  if (!weights || measured.length === 0) return { raw, cap };
  const total = measured.reduce((n, [d]) => n + weights[d], 0) || 1;
  const tier = agg.dqs.tier;
  const reason = capReason ?? agg.dqs.cap_reason;
  return {
    raw,
    cap,
    explain: {
      band: { label: tier ? statusLabel("verdict", tier) : "Scored", tone: tier === "pass" ? "go" : tier === "warn" ? "at-risk" : tier === "fail" ? "no-go" : "neutral" },
      dimensions: measured.map(([d, score]) => ({ name: DIMENSIONS.find((x) => x.id === d)?.label ?? d, weight: weights[d] / total, score })),
      capReason: cap != null ? (reason ? shortCapReason(reason) : "a critical finding is open") : undefined,
      // weight descends with rank so the explainer's recordsFailed * weight sort keeps the impact order
      rules: top.map((f, i, all) => ({ ruleId: f.check_id, object: f.module, recordsFailed: f.affected_count, weight: (all.length - i) / all.length })),
      // "Score history" is the run-by-run trend of this run's system or upload, not the executive summary.
      historyHref: versionId ? `/insights/trends?run=${encodeURIComponent(versionId)}` : "/insights/trends",
      run: versionId,
    },
  };
}

/**
 * A DQS ring that opens the ScoreExplainer, for a stat tile or a detail header with no hero score. Falls back to the
 * plain ring while the weights are unavailable. Never beside a hero of the same number: the hero takes `explain`.
 */
export function DqsScore({ agg, versionId, cap, capReason }: { agg: FindingsAggregate; versionId?: string; cap?: number | null; capReason?: string | null }) {
  const s = useDqsExplanation({ agg, versionId, cap, capReason });
  if (!s) return null;
  return <Score value={s.raw} cap={s.cap} explain={s.explain} />;
}

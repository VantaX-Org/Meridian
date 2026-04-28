/**
 * Typed aggregator for the Aurora Command Centre surface.
 *
 * Command Centre composes three live data sources:
 *
 *   • `/api/v1/mdm/dashboard` — headline health score + trend history.
 *   • `/api/v1/findings`      — inbox rows (critical + high only).
 *   • `/api/v1/metrics/llm-savings` — Tier-0 reduction strip (shown
 *     only when savings are non-trivial per `isSavingsNonTrivial`).
 *
 * `composeCommandCentre` shapes the raw responses into the exact prop
 * contract `<CommandCentre>` expects. The Command Centre page calls
 * this once per render so the surface never has to know about the
 * individual endpoint shapes.
 */

import {
  buildVerdict,
  type CommandCentreInboxItem,
  type CommandCentreIssueBucket,
  type CommandCentreKpi,
  type CommandCentreLlmSavings,
  type CommandCentreTrendPoint,
  type CommandCentreVerdict,
} from "@/components/aurora";
import type {
  Finding,
  FindingList,
  MdmDashboardResponse,
} from "@/types/api";
import type { LlmSavingsSummary } from "./llm-savings";

export interface CommandCentreViewModel {
  verdict: CommandCentreVerdict;
  kpis: CommandCentreKpi[];
  inbox: CommandCentreInboxItem[];
  trend: CommandCentreTrendPoint[];
  issues: CommandCentreIssueBucket[];
  llmSavings: CommandCentreLlmSavings | undefined;
  /** Raw counts — handy for narrative copy in the page wrapper. */
  counts: { critical: number; high: number; medium: number; low: number };
  topModule: string | null;
}

export interface ComposeCommandCentreInput {
  mdm: MdmDashboardResponse | undefined;
  findings: FindingList | undefined;
  savings: LlmSavingsSummary | undefined;
}

export function composeCommandCentre({
  mdm,
  findings,
  savings,
}: ComposeCommandCentreInput): CommandCentreViewModel {
  // Use `mdm_health_score` as the headline score until a dedicated
  // composite-DQS endpoint lands (tracked in PLAN_AURORA.md §10 · backend
  // asks). Matches the legacy sidebar score so the numbers line up
  // while Aurora stacks in.
  const latest = mdm?.latest ?? null;
  const trendRows = mdm?.trend ?? [];
  const dqs = latest?.mdm_health_score ?? 0;
  const previousDqs =
    trendRows.length >= 2 ? trendRows[trendRows.length - 2]!.mdm_health_score : null;

  const rows: Finding[] = findings?.findings ?? [];
  const critical = rows.filter((row) => row.severity === "critical").length;
  const high = rows.filter((row) => row.severity === "high").length;
  const medium = rows.filter((row) => row.severity === "medium").length;
  const low = rows.filter((row) => row.severity === "low").length;
  const topModule = rows[0]?.module ?? null;

  const verdict = buildVerdict({ dqs, previousDqs, critical, high, topModule });

  const kpis: CommandCentreKpi[] = [
    {
      id: "dqs",
      label: "DQS",
      value: dqs.toFixed(1),
      delta:
        previousDqs !== null
          ? (() => {
              const raw = Number((dqs - previousDqs).toFixed(1));
              const direction: "up" | "down" | "flat" =
                raw > 0 ? "up" : raw < 0 ? "down" : "flat";
              const semantic: "success" | "danger" | "neutral" =
                direction === "up"
                  ? "success"
                  : direction === "down"
                    ? "danger"
                    : "neutral";
              return { value: raw, direction, semantic };
            })()
          : undefined,
    },
    {
      id: "critical",
      label: "Critical",
      value: critical.toLocaleString(),
      tone: critical > 0 ? "danger" : "neutral",
    },
    {
      id: "high",
      label: "High",
      value: high.toLocaleString(),
      tone: high > 10 ? "warning" : "neutral",
    },
    {
      id: "records",
      label: "Golden records",
      value: (latest?.golden_record_count ?? 0).toLocaleString(),
    },
  ];

  const inbox: CommandCentreInboxItem[] = rows
    .filter((row) => row.severity === "critical" || row.severity === "high")
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      headline: row.check_id,
      module: row.module,
      severity: row.severity as CommandCentreInboxItem["severity"],
      age: formatAge(row.created_at),
      affected: row.affected_count ?? 0,
    }));

  const trend: CommandCentreTrendPoint[] = trendRows.map((point) => ({
    date: point.snapshot_date,
    dqs: point.mdm_health_score,
  }));

  const issues: CommandCentreIssueBucket[] = [
    { severity: "critical", count: critical },
    { severity: "high", count: high },
    { severity: "medium", count: medium },
    { severity: "low", count: low },
  ];

  const llmSavings: CommandCentreLlmSavings | undefined = savings
    ? {
        reductionPct: savings.reduction_pct,
        costSavedUsd: savings.cost_saved_usd,
        callsTotal: savings.calls_total,
        callsSaved: savings.calls_saved,
        windowDays: savings.window_days,
        series: Array.isArray(savings.series)
          ? savings.series.map((point) => ({
              date: point.date,
              reduction:
                point.calls_total === 0 ? 0 : point.calls_saved / point.calls_total,
            }))
          : [],
      }
    : undefined;

  return {
    verdict,
    kpis,
    inbox,
    trend,
    issues,
    llmSavings,
    counts: { critical, high, medium, low },
    topModule,
  };
}

function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const delta = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(delta) || delta < 0) return "—";
  const hours = Math.round(delta / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePathname, useSearchParams } from "next/navigation";
import { InsightHeader } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useDayOne } from "@/hooks/use-day-one";
import { getLlmHealth } from "@/lib/api/analytics";
import { getSystems } from "@/lib/api/connectivity";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getExec, submitInsightFeedback } from "@/lib/api/insights";
import { getWaves } from "@/lib/api/migration";
import { getMetrics } from "@/lib/api/stewardship";
import { compareVersions, getVersions } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { buildInsight, sectionOf, type InsightFacts } from "@/lib/route-insight";

const FINISHED = new Set(["complete", "agents_complete", "ai_enriched"]);

/** The insight header above every (app) page. Layout-level, so no page needs to opt in. */
export function RouteInsight() {
  const pathname = usePathname();
  const run = useSearchParams().get("run") ?? undefined;
  const section = sectionOf(pathname);
  const dayOne = useDayOne();
  const { isAdmin } = useRole();
  const versionsQ = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions(), enabled: !!section });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: !!section });
  const hasRun = (versionsQ.data?.versions ?? []).some((v) => FINISHED.has(v.status));
  const runId = run ?? (versionsQ.data?.versions ?? []).find((v) => FINISHED.has(v.status))?.id;
  const aggQ = useQuery({ queryKey: ["insight", "aggregate", runId], queryFn: () => getFindingsAggregate(runId), enabled: !!section && hasRun && !!runId });
  const finished = (versionsQ.data?.versions ?? []).filter((v) => FINISHED.has(v.status));
  // Changed cell: per-object movement between this run and the finished run before it (list is newest first); falls back to the score delta.
  const at = finished.findIndex((v) => v.id === runId);
  const prevId = at >= 0 ? finished[at + 1]?.id : undefined;
  const cmpQ = useQuery({
    queryKey: ["insight", "compare", prevId, runId],
    queryFn: () => compareVersions(prevId as string, runId as string),
    enabled: !!section && !!prevId && !!runId,
    retry: false,
  });
  const wavesQ = useQuery({ queryKey: queryKeys.migrationWaves(), queryFn: getWaves, enabled: section === "migration" });
  const backlogQ = useQuery({ queryKey: queryKeys.stewardshipMetrics(), queryFn: getMetrics, enabled: section === "inbox" || section === "mdm" });
  const llmQ = useQuery({ queryKey: ["health", "llm"], queryFn: getLlmHealth, enabled: !!section && hasRun, staleTime: 60_000 });
  const llmOn = llmQ.data?.llm_available === true;
  const execQ = useQuery({ queryKey: queryKeys.insights("exec", runId), queryFn: () => getExec({ version_id: runId }), enabled: !!section && hasRun && !!runId && llmOn });

  if (!section) return null;

  const agg = aggQ.data;
  const worst = [...(agg?.by_module ?? [])].sort((a, b) => b.critical - a.critical || b.findings - a.findings)[0];
  const cmp = cmpQ.data;
  const movers = Object.entries(cmp?.delta ?? {})
    .filter(([, d]) => d.dqs_change !== 0)
    .sort((a, b) => Math.abs(b[1].dqs_change) - Math.abs(a[1].dqs_change));
  const facts: InsightFacts = {
    hasRun,
    runId,
    dqs: agg?.dqs.composite ?? null,
    prevDqs: agg?.previous_dqs ?? null,
    critical: agg?.severity.critical ?? 0,
    total: agg?.total ?? 0,
    affected: agg?.affected_records ?? 0,
    costAtRisk: agg?.cost_at_risk,
    moved: cmp
      ? {
          count: movers.length,
          biggest: movers[0] ? { label: formatModuleName(movers[0][0]), change: Math.round(movers[0][1].dqs_change * 10) / 10 } : undefined,
          href: `/runs/${cmp.v2.id}/vs/${cmp.v1.id}`,
        }
      : undefined,
    worst: worst ? { module: worst.module, label: formatModuleName(worst.module), findings: worst.findings, critical: worst.critical } : undefined,
    systems: (systemsQ.data ?? []).length,
    waves: (wavesQ.data ?? []).length,
    backlog: backlogQ.data?.backlog_total ?? null,
    dayOne: dayOne.step ? { label: dayOne.step.label, href: dayOne.step.href } : undefined,
  };
  const cells = buildInsight(section, facts);
  const loading = versionsQ.isLoading || (hasRun && aggQ.isLoading);

  return (
    <div className="px-6 pt-4">
      <InsightHeader
        {...cells}
        loading={loading}
        aiSummary={hasRun ? {
          llmOk: llmQ.data?.llm_available,
          text: execQ.data?.narrative,
          fallback: `${cells.situation.sentence} ${cells.why.sentence}`,
          findingsCount: agg?.total,
          runId,
          loading: execQ.isLoading && llmOn,
          adminHref: isAdmin && llmQ.data?.llm_available === false ? "/admin/ai" : undefined,
          onFeedback: (vote) =>
            submitInsightFeedback({ surface: section, run_id: runId, vote }).then(
              () => toast.success("Thanks, feedback recorded."),
              () => toast.error("Could not record feedback."),
            ),
        } : undefined}
      />
    </div>
  );
}

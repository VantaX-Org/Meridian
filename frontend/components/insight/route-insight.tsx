"use client";

import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePathname, useSearchParams } from "next/navigation";
import { InsightHeader } from "@/design";
import { useDayOne } from "@/hooks/use-day-one";
import { getLlmHealth } from "@/lib/api/analytics";
import { getSystems } from "@/lib/api/connectivity";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getExec, submitInsightFeedback } from "@/lib/api/insights";
import { compareVersions } from "@/lib/api/versions";
import { useCostAtRisk } from "@/hooks/use-cost-at-risk";
import { doNext } from "@/lib/do-next";
import { useRunListWith } from "@/hooks/use-run-list";
import { formatModuleName } from "@/lib/format";
import { isFinished, lineageOf, overallDqs } from "@/lib/runs";
import { latestPerLineage, stateDqs, stateObjects } from "@/lib/current-state";
import { usePermissions } from "@/lib/permissions";
import { queryKeys } from "@/lib/query-keys";
import { buildInsight, sectionOf, showsRouteInsight, type InsightFacts } from "@/lib/route-insight";


/** The four sentences inside the persona home hero (situation, what changed, why it matters, do next). Every other page carries its own InsightHeader. */
export function RouteInsight() {
  const pathname = usePathname();
  const run = useSearchParams().get("run") ?? undefined;
  const section = showsRouteInsight(pathname) ? sectionOf(pathname) : null;
  const dayOne = useDayOne();
  const { scopeFilter } = usePermissions();
  // The shared run list, plus a ?run= older than it read by id, so the previous run of its lineage is found.
  const { list: versionsQ, versions: allVersions } = useRunListWith(section ? run : undefined);
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, enabled: !!section });
  const hasRun = allVersions.some(isFinished);
  // No ?run=: the current state, every object at the latest run of its lineage, as the home below it shows;
  // the "changed" cell is the newest run's change. ?run= pins one run.
  const stateRuns = run ? [] : latestPerLineage(allVersions);
  const runId = run ?? stateRuns[0]?.id ?? allVersions.find(isFinished)?.id;
  // The same cache entry Home's hero and useCostAtRisk read: one aggregate, one cost at risk.
  const aggQ = useQuery({ queryKey: queryKeys.findingsAggregate(run ?? "current"), queryFn: () => getFindingsAggregate(run), enabled: !!section && hasRun && !!runId });
  const finished = allVersions.filter(isFinished);
  // Changed cell: per-object movement between this run and the finished run before it in the same lineage
  // (same system, or the same uploaded objects; the list is newest first). Another object's run is never "previous".
  const current = finished.find((v) => v.id === runId);
  const lineage = current ? finished.filter((v) => lineageOf(v) === lineageOf(current)) : [];
  const at = lineage.findIndex((v) => v.id === runId);
  const prev = at >= 0 ? lineage[at + 1] : undefined;
  const prevId = prev?.id;
  const firstRun = !!current && !prev;
  const cmpQ = useQuery({
    queryKey: ["insight", "compare", prevId, runId],
    queryFn: () => compareVersions(prevId as string, runId as string),
    enabled: !!section && !!prevId && !!runId,
    retry: false,
  });
  const llmQ = useQuery({ queryKey: ["health", "llm"], queryFn: getLlmHealth, enabled: !!section && hasRun, staleTime: 60_000 });
  const llmOn = llmQ.data?.llm_available === true;
  // The model's narrative describes one run. It is shown only when the four cells describe the same scope: a pinned
  // run, or a current state made of one run; several lineages have no narrative that covers them all.
  const sameScope = !!run || stateRuns.length <= 1;
  const execQ = useQuery({ queryKey: queryKeys.insights("exec", runId), queryFn: () => getExec({ version_id: runId }), enabled: !!section && hasRun && !!runId && llmOn && sameScope });
  const cost = useCostAtRisk(run, !!section && hasRun && !!runId);

  if (!section) return null;

  const agg = aggQ.data;
  const loading = versionsQ.isLoading || (hasRun && aggQ.isLoading);
  // No sentences yet: show nothing rather than four empty cells.
  if (loading) return null;
  const worst = [...(agg?.by_module ?? [])].sort((a, b) => b.critical - a.critical || b.findings - a.findings)[0];
  const cmp = cmpQ.data;
  const movers = Object.entries(cmp?.delta ?? {})
    .filter(([, d]) => d.dqs_change !== 0)
    .sort((a, b) => Math.abs(b[1].dqs_change) - Math.abs(a[1].dqs_change));
  // The current state's score as the home's hero computes it, and the same state with the newest run swapped for
  // the one before it in its lineage.
  const state = stateRuns.length ? stateObjects(stateRuns, scopeFilter.modules) : null;
  // Do next: the one step of this scope (lib/do-next.ts), the same the Insights overview and the summary name.
  const next = doNext(state ?? stateObjects(current ? [current] : [], scopeFilter.modules), { pinned: !!run });
  const facts: InsightFacts = {
    hasRun,
    // Links follow the scope: a pinned run, or (current state) none.
    runId: run,
    dqs: state ? stateDqs(state) : agg?.dqs.composite ?? null,
    // The previous score comes from the lineage's own earlier run; the aggregate's previous_dqs may belong to another object.
    prevDqs: firstRun ? null
      : state ? (prev ? stateDqs(stateObjects(stateRuns.map((r) => (r.id === runId ? prev : r)), scopeFilter.modules)) : null)
      : prev ? overallDqs(prev) ?? agg?.previous_dqs ?? null : agg?.previous_dqs ?? null,
    firstRun,
    currency: cost.currency,
    critical: agg?.severity.critical ?? 0,
    total: agg?.total ?? 0,
    affected: agg?.affected_records ?? 0,
    costAtRisk: cost.amount ?? undefined,
    doNext: next ? { sentence: next.sentence, href: next.action.href, label: next.action.label } : undefined,
    moved: cmp
      ? {
          count: movers.length,
          biggest: movers[0] ? { label: formatModuleName(movers[0][0]), change: Math.round(movers[0][1].dqs_change * 10) / 10 } : undefined,
          href: `/runs/${cmp.v2.id}/vs/${cmp.v1.id}`,
        }
      : undefined,
    worst: worst ? { module: worst.module, label: formatModuleName(worst.module), findings: worst.findings, critical: worst.critical } : undefined,
    systems: (systemsQ.data ?? []).length,
    waves: 0,
    backlog: null,
    running: allVersions.filter((v) => !isFinished(v) && v.status !== "failed").length,
    dayOne: dayOne.step ? { label: dayOne.step.label, href: dayOne.step.href, status: dayOne.step.key === "running" } : undefined,
  };
  const cells = buildInsight(section, facts);
  // The four rule-built cells always. The model's summary, labelled in words, sits under them when it covers the same scope.
  const aiOn = hasRun && llmOn && sameScope && (execQ.isLoading || !!execQ.data?.narrative);

  return (
    <div className="min-w-0">
      <InsightHeader
        {...cells}
        aiSummary={aiOn ? {
          llmOk: true,
          text: execQ.data?.narrative,
          fallback: `${cells.situation.sentence} ${cells.why.sentence}`,
          findingsCount: agg?.total,
          runId,
          loading: execQ.isLoading,
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

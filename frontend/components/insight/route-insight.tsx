"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { InsightHeader } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useDayOne } from "@/hooks/use-day-one";
import { getLlmHealth } from "@/lib/api/analytics";
import { getSystems } from "@/lib/api/connectivity";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getExec } from "@/lib/api/insights";
import { getWaves } from "@/lib/api/migration";
import { getMetrics } from "@/lib/api/stewardship";
import { getVersions } from "@/lib/api/versions";
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
  const wavesQ = useQuery({ queryKey: queryKeys.migrationWaves(), queryFn: getWaves, enabled: section === "migration" });
  const backlogQ = useQuery({ queryKey: queryKeys.stewardshipMetrics(), queryFn: getMetrics, enabled: section === "inbox" || section === "mdm" });
  const llmQ = useQuery({ queryKey: ["health", "llm"], queryFn: getLlmHealth, enabled: !!section && hasRun, staleTime: 60_000 });
  const llmOn = llmQ.data?.llm_available === true;
  const execQ = useQuery({ queryKey: queryKeys.insights("exec", runId), queryFn: () => getExec({ version_id: runId }), enabled: !!section && hasRun && !!runId && llmOn });

  if (!section) return null;

  const agg = aggQ.data;
  const worst = [...(agg?.by_module ?? [])].sort((a, b) => b.critical - a.critical || b.findings - a.findings)[0];
  const facts: InsightFacts = {
    hasRun,
    runId,
    dqs: agg?.dqs.composite ?? null,
    prevDqs: agg?.previous_dqs ?? null,
    critical: agg?.severity.critical ?? 0,
    total: agg?.total ?? 0,
    affected: agg?.affected_records ?? 0,
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
        } : undefined}
      />
    </div>
  );
}

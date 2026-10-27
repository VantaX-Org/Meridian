"use client";

// The lead home's analyses that only the retired Insights overview had: the root causes, the S/4 migration chart and
// the cleansing funnel. They follow Home's scope: the current state (each object at the latest run of its lineage,
// the `scope=current` endpoints), or the run `?run=` pins.
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getCleansing, getCurrentCleansing, getCurrentRootCauses, getRootCauses, type CleansingStep, type RootCauseCluster } from "@/lib/api/insights";
import { getCurrentS4Readiness, getS4Readiness, type S4Area } from "@/lib/api/migration";
import { queryKeys } from "@/lib/query-keys";
import { CleansingFunnel, RootCauseList, S4Chart, s4Totals } from "@/app/(app)/insights/_components/RunAnalyses";
import { Section } from "@/app/(app)/insights/_components/Section";
import { useCurrentState } from "@/app/(app)/insights/_components/useCurrentState";

export function HomeAnalyses() {
  const run = useSearchParams()?.get("run") ?? undefined;
  const { newest, modules } = useCurrentState();
  const on = !!run || !!newest;
  const key = run ?? "current";
  // The same query keys as the insight views, so their caches are shared.
  const causesQ = useQuery<{ clusters: (RootCauseCluster & { version_id?: string })[] }>({ queryKey: queryKeys.insights("root-causes", key), queryFn: () => (run ? getRootCauses({ version_id: run }) : getCurrentRootCauses()), enabled: on });
  const cleanseQ = useQuery<{ steps: CleansingStep[] }>({ queryKey: queryKeys.insights("cleansing", key), queryFn: () => (run ? getCleansing({ version_id: run }) : getCurrentCleansing()), enabled: on });
  const s4Q = useQuery<{ areas: S4Area[] }>({ queryKey: queryKeys.insights("s4-readiness", key), queryFn: () => (run ? getS4Readiness(run) : getCurrentS4Readiness()), enabled: on });
  if (!on) return null;
  // A module-scoped user sees only in-scope objects, as everywhere on Home.
  const clusters = (causesQ.data?.clusters ?? []).filter((c) => !modules || modules.has(c.module));
  const s4 = s4Totals(s4Q.data?.areas ?? []);
  const scope = run ? "This run" : "Each object at its latest run";
  return (
    <div className="grid gap-4 @5xl:grid-cols-3" data-testid="home-analyses">
      <Section title="Root causes" height={200} query={causesQ} meta={causesQ.data ? `${Math.min(5, clusters.length)} of ${clusters.length}. ${scope}` : undefined}>
        <RootCauseList clusters={clusters} run={run} empty={run ? "No failing fields in this run." : "No failing fields in any object's latest run."} />
      </Section>
      <Section title="S/4 migration" height={200} query={s4Q} meta={s4Q.data ? `${s4.blocking.toLocaleString()} blocking, ${s4.warning.toLocaleString()} warning` : undefined}>
        <S4Chart areas={s4Q.data?.areas ?? []} run={run} />
      </Section>
      <Section title="Cleansing opportunity" height={200} query={cleanseQ} meta={scope}>
        <CleansingFunnel steps={cleanseQ.data?.steps ?? []} run={run} />
      </Section>
    </div>
  );
}

"use client";

// The Insights overview repeated Home (score, trend, dimensions, heatmap, Fix first) and was retired. /insights opens
// the viewer's own home; what only the overview had moved: root causes, S/4 migration and the cleansing funnel to the
// lead's Home (home/_analyses.tsx), the critical-and-high ledger to Fix work and one run's numbers to that run's page
// (overviewTarget.ts). Each insight view keeps its own page.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/design";
import { useRole } from "@/hooks/use-role";
import { homeHrefForRole } from "@/lib/persona";
import { insightsOverviewTarget } from "./_components/overviewTarget";

export default function InsightsOverviewRedirect() {
  const router = useRouter();
  const search = useSearchParams();
  const { homeRole, can, loading } = useRole();
  useEffect(() => {
    const target = insightsOverviewTarget(new URLSearchParams(search?.toString() ?? ""));
    if (target) router.replace(target);
    else if (!loading) router.replace(homeHrefForRole(homeRole, can));
  }, [search, homeRole, can, loading, router]);
  return <div aria-busy="true" className="flex flex-col gap-4"><Skeleton height={56} /><Skeleton height={240} /></div>;
}

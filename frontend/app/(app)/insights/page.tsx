// frontend/app/(app)/insights/page.tsx
"use client";

import Link from "next/link";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Button, EmptyState, Skeleton } from "@/design";
import { getExec, getImpact, getOwners, getReadiness } from "@/lib/api/insights";
import { queryKeys } from "@/lib/query-keys";

interface Tile {
  key: string;
  href: string;
  title: string;
  metric: string;
  query?: UseQueryResult<unknown>;
}

/** Loading -> skeleton, error -> inline message with a retry that does not
 * follow the tile's own Link, otherwise the computed metric text. */
function TileMetric({ query, metric }: { query?: UseQueryResult<unknown>; metric: string }) {
  if (!query) return <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{metric}</span>;
  if (query.isLoading) return <Skeleton width={120} height={14} />;
  if (query.isError) {
    return (
      <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--m-critical)" }}>
        Couldn&apos;t load.
        <Button
          variant="ghost"
          className="h-auto p-0 underline"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void query.refetch();
          }}
        >
          Retry
        </Button>
      </span>
    );
  }
  return <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{metric}</span>;
}

export default function InsightsIndexPage() {
  const readiness = useQuery({ queryKey: queryKeys.insights("readiness"), queryFn: () => getReadiness() });
  const impact = useQuery({ queryKey: queryKeys.insights("impact"), queryFn: () => getImpact() });
  const owners = useQuery({ queryKey: queryKeys.insights("owners"), queryFn: () => getOwners() });
  const exec = useQuery({ queryKey: queryKeys.insights("exec"), queryFn: () => getExec() });

  const noGoCount = readiness.data?.cells.filter((c) => c.verdict === "no_go").length;
  const totalValueAtRisk = impact.data?.rows.reduce((sum, r) => sum + r.value_at_risk, 0);
  const threshold = readiness.data?.threshold;
  const ownersBelowThreshold = threshold === undefined ? undefined : owners.data?.owners.filter((o) => o.score < threshold).length;

  const allLoaded = [readiness, impact, owners, exec].every((q) => !q.isLoading && !q.isError);
  const allEmpty =
    allLoaded &&
    (readiness.data?.cells.length ?? 0) === 0 &&
    (impact.data?.rows.length ?? 0) === 0 &&
    (owners.data?.owners.length ?? 0) === 0 &&
    !exec.data?.version_id;

  const tiles: Tile[] = [
    { key: "readiness", href: "/insights/readiness", title: "Readiness", metric: noGoCount === undefined ? "—" : `${noGoCount} no-go`, query: readiness },
    { key: "impact", href: "/insights/impact", title: "Impact", metric: totalValueAtRisk === undefined ? "—" : `${totalValueAtRisk.toLocaleString()} at risk`, query: impact },
    { key: "owners", href: "/insights/owners", title: "Owners", metric: ownersBelowThreshold === undefined ? "—" : `${ownersBelowThreshold} below threshold`, query: owners },
    { key: "duplicates", href: "/insights/duplicates", title: "Duplicates", metric: "Review clusters" },
    { key: "exec", href: "/insights/exec", title: "Executive summary", metric: exec.data?.version_id ? `Run ${exec.data.version_id}` : "—", query: exec },
  ];

  if (allEmpty) {
    return (
      <EmptyState
        title="No insights yet."
        detail="Insights build up once a run has finished analysing."
        action={<Button render={<Link href="/runs">Open runs</Link>} />}
      />
    );
  }

  return (
    <div className="grid gap-4 p-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
          className="flex flex-col gap-2 p-4 rounded border"
          style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
        >
          <span className="text-[14px] font-semibold">{tile.title}</span>
          <TileMetric query={tile.query} metric={tile.metric} />
        </Link>
      ))}
    </div>
  );
}

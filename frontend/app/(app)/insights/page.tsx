// frontend/app/(app)/insights/page.tsx
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getExec, getImpact, getOwners, getReadiness } from "@/lib/api/insights";
import { queryKeys } from "@/lib/query-keys";

interface Tile {
  key: string;
  href: string;
  title: string;
  metric: string;
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

  const tiles: Tile[] = [
    { key: "readiness", href: "/insights/readiness", title: "Readiness", metric: noGoCount === undefined ? "—" : `${noGoCount} no-go` },
    { key: "impact", href: "/insights/impact", title: "Impact", metric: totalValueAtRisk === undefined ? "—" : `${totalValueAtRisk.toLocaleString()} at risk` },
    { key: "owners", href: "/insights/owners", title: "Owners", metric: ownersBelowThreshold === undefined ? "—" : `${ownersBelowThreshold} below threshold` },
    { key: "duplicates", href: "/insights/duplicates", title: "Duplicates", metric: "Review clusters" },
    { key: "exec", href: "/insights/exec", title: "Executive summary", metric: exec.data?.version_id ? `Run ${exec.data.version_id}` : "—" },
  ];

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
          <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{tile.metric}</span>
        </Link>
      ))}
    </div>
  );
}

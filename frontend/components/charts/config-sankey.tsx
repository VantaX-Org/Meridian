"use client";

import dynamic from "next/dynamic";
import type { EChartsOption, SankeySeriesOption } from "echarts";
import type { ConfigImpactResult } from "@/types/api";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export interface ConfigSankeyProps {
  results: ReadonlyArray<ConfigImpactResult>;
  height?: number;
}

/**
 * Sankey: findings → features → systems.
 *
 * Aggregates flow by `affected_count` so the widest bands are the highest-
 * impact chains. Rendered with ECharts — lazy-loaded to avoid bloating
 * routes that don't need sankey.
 */
export function ConfigSankey({ results, height = 360 }: ConfigSankeyProps) {
  const nodes = new Map<string, { name: string; category: "finding" | "feature" | "system" }>();
  const links: Array<{ source: string; target: string; value: number }> = [];

  for (const r of results) {
    const featureKey = `feat:${r.feature}`;
    const systemKey = `sys:${r.system}`;
    nodes.set(featureKey, { name: r.feature, category: "feature" });
    nodes.set(systemKey, { name: r.system, category: "system" });

    const featureWeight = Math.max(1, r.total_affected_records);
    links.push({ source: featureKey, target: systemKey, value: featureWeight });

    for (const bf of r.blocking_findings) {
      const findingKey = `find:${bf.check_id}`;
      nodes.set(findingKey, { name: bf.check_id, category: "finding" });
      links.push({
        source: findingKey,
        target: featureKey,
        value: Math.max(1, bf.affected_count),
      });
    }
  }

  const colorFor: Record<"finding" | "feature" | "system", string> = {
    finding: "#BB0000",
    feature: "#E76500",
    system: "#0070F2",
  };

  const sankeySeries: SankeySeriesOption = {
    type: "sankey",
    emphasis: { focus: "adjacency" },
    data: Array.from(nodes.entries()).map(([id, n]) => ({
      name: id,
      value: 0,
      label: { formatter: n.name, fontSize: 11, color: "#4A5568" },
      itemStyle: { color: colorFor[n.category], borderWidth: 0 },
    })),
    links: links.map((l) => ({
      source: l.source,
      target: l.target,
      value: l.value,
      lineStyle: { opacity: 0.45, curveness: 0.5 },
    })),
    nodeGap: 8,
    nodeWidth: 10,
    lineStyle: { color: "gradient", curveness: 0.5 },
  };

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      textStyle: { fontSize: 12 },
    },
    series: [sankeySeries],
  };

  if (nodes.size === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-white/[0.50] text-sm text-muted-foreground"
        style={{ height }}
      >
        No findings → feature flows to render
      </div>
    );
  }

  return (
    <div className="vx-card p-3">
      <ReactECharts option={option} style={{ height }} opts={{ renderer: "canvas" }} />
    </div>
  );
}

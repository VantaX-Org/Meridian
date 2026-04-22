"use client";

import dynamic from "next/dynamic";
import type { EChartsOption, TreemapSeriesOption } from "echarts";
import type { MiningPattern } from "@/lib/api/mining";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

export interface PatternTreemapProps {
  patterns: ReadonlyArray<MiningPattern>;
  height?: number;
}

const SEVERITY_COLOR: Record<MiningPattern["severity"], string> = {
  critical: "#BB0000",
  high: "#E76500",
  medium: "#E76500",
  low: "#256F3A",
};

/**
 * Treemap of discovered patterns — area ∝ occurrences, colour by severity.
 * Lazy-loaded so routes that don't need ECharts don't pay for it.
 */
export function PatternTreemap({ patterns, height = 360 }: PatternTreemapProps) {
  if (patterns.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-black/[0.08] bg-white/[0.50] text-sm text-muted-foreground"
        style={{ height }}
      >
        No patterns discovered yet
      </div>
    );
  }

  // Group by module → pattern
  const byModule = new Map<string, MiningPattern[]>();
  for (const p of patterns) {
    const arr = byModule.get(p.module) ?? [];
    arr.push(p);
    byModule.set(p.module, arr);
  }

  const children = Array.from(byModule.entries()).map(([moduleName, items]) => ({
    name: moduleName,
    value: items.reduce((s, p) => s + p.occurrences, 0),
    children: items.map((p) => ({
      name: p.name,
      value: Math.max(1, p.occurrences),
      itemStyle: { color: SEVERITY_COLOR[p.severity] },
    })),
  }));

  const treemap: TreemapSeriesOption = {
    type: "treemap",
    breadcrumb: { show: false },
    roam: false,
    nodeClick: false,
    levels: [
      {
        itemStyle: { borderColor: "rgba(255,255,255,0.85)", borderWidth: 2, gapWidth: 2 },
      },
      {
        itemStyle: { borderColor: "rgba(255,255,255,0.85)", borderWidth: 1, gapWidth: 1 },
        label: { show: true, fontSize: 11, color: "#fff" },
      },
    ],
    data: children,
  };

  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      textStyle: { fontSize: 12 },
      formatter: (info) => {
        const v = info as { name: string; value: number };
        return `${v.name}<br/>Occurrences: ${v.value.toLocaleString()}`;
      },
    },
    series: [treemap],
  };

  return (
    <div className="vx-card p-3">
      <ReactECharts option={option} style={{ height }} opts={{ renderer: "canvas" }} />
    </div>
  );
}

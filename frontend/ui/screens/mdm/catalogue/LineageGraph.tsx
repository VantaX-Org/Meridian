"use client";

import type { LineageGraph as Lineage } from "@/lib/api/v2/lineage";
import { t } from "@/lib/v2/i18n";
import { Graph } from "@/ui/kit";

/** One column per depth (upstream left, start centre, downstream right), edges left to right, on the shared kit Graph. */
export function LineageGraph({ graph }: { graph: Lineage }) {
  return (
    <Graph
      layout="columns"
      label={t("Lineage graph")}
      nodes={graph.nodes.map((n) => ({ id: n.id, label: n.label, title: n.description ?? n.label, emphasis: n.id === graph.start, column: n.depth }))}
      edges={graph.edges.map((e, i) => ({ id: String(i), source: e.source, target: e.target }))}
    />
  );
}

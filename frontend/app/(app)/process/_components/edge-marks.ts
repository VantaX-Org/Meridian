import type { Dfg } from "@/lib/api/process-discovery";

type Edge = Dfg["edges"][number];

/** Keys (`source>target`) of the edges whose median wait is in the top decile of the edges that have one. No wait data, no marks. */
export function bottleneckKeys(edges: Edge[]): Set<string> {
  const waits = edges.filter((e) => e.median_seconds != null && e.median_seconds > 0);
  const n = Math.ceil(waits.length / 10);
  const top = [...waits].sort((a, b) => b.median_seconds! - a.median_seconds!).slice(0, n);
  return new Set(top.map((e) => `${e.source}>${e.target}`));
}

/**
 * Rework: a self-loop, or a target whose model order is earlier than its source's.
 * `order` is the model's own `order` field; pseudo nodes and unknown ids have none and never count.
 */
export function isRework(e: Edge, order: (id: string) => number | undefined): boolean {
  if (e.source === e.target) return e.source !== "START" && e.source !== "END";
  const a = order(e.source);
  const b = order(e.target);
  return a != null && b != null && b < a;
}

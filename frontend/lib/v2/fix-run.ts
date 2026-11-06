import type { Landscape } from "@/lib/api/v2/types";
import type { TimelineRun } from "@/lib/api/v2/runs";

/** The run an object stands at now: its cell in the Current landscape, matched to the run list. Null when either is missing. */
export function currentRunFor(
  landscape: Pick<Landscape, "cells"> | undefined,
  runs: TimelineRun[] | undefined,
  module: string | null | undefined,
  systemId?: string | null,
): { systemId: string; run: TimelineRun } | null {
  if (!landscape || !runs || !module) return null;
  const cell = landscape.cells.find((c) => c.module === module && (!systemId || c.system_id === systemId));
  const run = cell ? runs.find((r) => r.id === cell.run_id) : undefined;
  return cell && run ? { systemId: cell.system_id, run } : null;
}
